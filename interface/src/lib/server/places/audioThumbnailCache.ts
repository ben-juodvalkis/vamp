/**
 * Audio waveform thumbnail baking + incremental cache (ADR-401).
 *
 * Called by `generate-places-catalog.ts` while it builds each Place's
 * `<id>-samples.json` (before the browser-places cutover, 2026-09-24, by the
 * type-catalog builder for its `audio-clips-*.json`). For each audio sample it
 * stamps a
 * low-resolution `peaks` thumbnail (base64, see `waveformThumbnail.ts`)
 * onto the preset so the browser tile can paint a waveform with no
 * network round trip.
 *
 * **The catalog build is the reconciliation moment, not a full
 * recompute.** A JSON sidecar cache (`scripts/.cache/…`) records, per
 * absolute file path, the `(mtimeMs, size, version)` the thumbnail was
 * computed at. On each build we walk every sample (the scan already
 * visits them all), `stat` it — microseconds, no decode — and:
 *   - unchanged + same format version  → reuse the cached thumbnail
 *   - new / changed / version bump      → decode now, store the result
 *   - deleted                           → drops out (only scanned files
 *                                          are written back)
 * So a warm build decodes only the handful of samples that actually
 * changed; the first (cold) build pays the full decode once.
 *
 * Decode reuses the endpoint's own modules verbatim, so a baked
 * thumbnail and the live `/api/sample-peaks` render come from identical
 * math. The bake privileges **Path C first** — Live's `.asd` overview
 * (`readAsdOverview`, ADR-398) — then falls back to **Path A** streaming
 * PCM (`streamingPcmPeaks` + `formatProbe`), then **Path B** full-decode
 * of compressed audio (`audio-decode`: mp3/flac/ogg/m4a/opus), then
 * tombstones. C→A is inverted from the endpoint's A→C order on purpose
 * (see `computeThumbnail`): a coarse 64-bin thumbnail over tens of
 * thousands of read-only pack samples is better served by the cheap ~20 KB
 * `.asd` sidecar than by streaming/decoding multi-MB files, and it's the
 * only way to get a waveform for protected pack AIFC that nothing can
 * decode. Path B mirrors the endpoint's compressed-decode fallback (bounded
 * by `paths.waveformMaxBytes`) so mp3/flac/ogg samples bake a real waveform
 * instead of tombstoning. Only files that C, A, and B all refuse — an
 * unresolvable `.alc`, a codec `audio-decode` won't touch, or an oversized
 * file — get a **tombstone** (cached "no thumbnail" so we don't re-attempt
 * every build) and fall back to a live fetch in the tile.
 *
 * Every tombstone is recorded with a concrete `FailureReason` and written
 * to a persistent, human-auditable failure log
 * (`scripts/.cache/audio-peaks-failures.json`) so a missing tile can be
 * traced to *why* (unresolvable clip vs. refused codec vs. oversized),
 * not just counted. The modules are `import()`-ed lazily and the whole
 * pass is wrapped so any failure degrades to "no baked thumbnails"
 * rather than breaking the catalog.
 */

import * as fs from 'fs';
import { open, readFile, stat } from 'fs/promises';
import * as path from 'path';

import { configPath, runtimeConstants } from '../runtimeConfig';
import {
	THUMB_BINS,
	THUMB_VERSION,
	encodeThumbnailPeaks
} from '$lib/utils/waveformThumbnail';

/**
 * Path B (compressed full-decode) skips files larger than this to bound
 * peak memory — `audio-decode` inflates the whole file to Float32 PCM.
 * Mirrors the endpoint's `paths.waveformMaxBytes` gate so a file too big
 * to render live is also too big to bake (same tombstone either way).
 */
function waveformMaxBytes(): number {
	const v = (runtimeConstants() as { paths?: { waveformMaxBytes?: number } })?.paths?.waveformMaxBytes;
	return typeof v === 'number' && v > 0 ? v : 78643200;
}

/**
 * Installed Packs folders a pack clip copied out of its pack resolves against
 * (`alcResolver`'s third step) — the browser's Places are clones, and 908 of
 * their clips resolve no other way.
 */
function packRoots(): string[] {
	return [configPath('abletonPacksBase')].filter((r): r is string => typeof r === 'string' && r.length > 0);
}

/** Minimal shape we read/write on a preset — the generator's `Preset` satisfies it. */
export interface ThumbnailablePreset {
	fullPath: string;
	peaks?: string;
}

/**
 * Why a file produced no thumbnail. Persisted per-file in the failure log
 * so `scripts/.cache/audio-peaks-failures.json` is an auditable record of
 * exactly which samples tombstoned and for what reason — not just an
 * aggregate count. `null` reason means "success" (never logged as a
 * failure). Each value maps to one concrete branch in `computeThumbnail`.
 */
export type FailureReason =
	| 'alc-unresolvable' // .alc wrapper referenced a sample we couldn't locate
	| 'alc-read-error' // .alc itself couldn't be read/parsed
	| 'decode-failed' // audio-decode (Path B) refused the codec / malformed
	| 'too-large' // exceeds waveformMaxBytes — Path B skipped to bound memory
	| 'empty-peaks' // decoded but produced zero renderable peaks
	| 'unknown-error'; // unexpected throw not attributable to the above

/** Result of one thumbnail attempt: base64 peaks, or a tombstone with its reason. */
interface ThumbnailResult {
	peaks: string | null;
	reason: FailureReason | null;
}

/** One reconciliation record. `peaks === null` is a tombstone (tried, not renderable). */
interface CacheEntry {
	mtimeMs: number;
	size: number;
	v: number;
	peaks: string | null;
	/** Failure reason for a tombstone (`peaks === null`); absent/undefined for a hit. */
	reason?: FailureReason;
}

type CacheMap = Map<string, CacheEntry>;

/** One entry in the persistent failure log (`audio-peaks-failures.json`). */
export interface FailureRecord {
	path: string;
	reason: FailureReason;
	size: number;
}

export interface BakeStats {
	total: number;
	decoded: number;
	reused: number;
	tombstoned: number;
	missing: number;
	/** Per-reason tombstone counts this run (reused tombstones included). */
	failuresByReason: Record<FailureReason, number>;
	/** Every tombstoned file this run, with its reason — written to the failure log. */
	failures: FailureRecord[];
	/** True when the Path A reducer couldn't be loaded — no thumbnails baked. */
	unavailable: boolean;
}

// How many files to decode concurrently on a cold build. I/O-bound
// (bounded 1 MB reads), so a small pool speeds the first run without
// thrashing. Reused entries never hit this path.
const DECODE_CONCURRENCY = 8;

// A first cold build over a full pack library is tens of thousands of files
// and minutes long. Log a progress line every PROGRESS_EVERY files, and flush
// the cache to disk every FLUSH_EVERY so an interrupted build RESUMES from the
// last flush instead of re-decoding everything.
const PROGRESS_EVERY = 100;
const FLUSH_EVERY = 2000;

function formatEta(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '—';
	const s = Math.round(seconds);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m${(s % 60).toString().padStart(2, '0')}s`;
	const h = Math.floor(m / 60);
	return `${h}h${(m % 60).toString().padStart(2, '0')}m`;
}

/**
 * Load the sidecar cache. Missing / unparseable / wrong-shape → empty
 * map (cold build). Never throws.
 */
export function loadPeakCache(cacheFile: string): CacheMap {
	const map: CacheMap = new Map();
	try {
		if (!fs.existsSync(cacheFile)) return map;
		const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
		if (!raw || typeof raw !== 'object' || !raw.entries) return map;
		for (const [key, val] of Object.entries(raw.entries as Record<string, unknown>)) {
			const e = val as Partial<CacheEntry>;
			if (
				e &&
				typeof e.mtimeMs === 'number' &&
				typeof e.size === 'number' &&
				typeof e.v === 'number' &&
				(typeof e.peaks === 'string' || e.peaks === null)
			) {
				map.set(key, { mtimeMs: e.mtimeMs, size: e.size, v: e.v, peaks: e.peaks });
			}
		}
	} catch {
		// Corrupt cache is not fatal — rebuild it from scratch this run.
		return new Map();
	}
	return map;
}

/** Persist the cache (only entries for files seen this build). Never throws. */
export function savePeakCache(cacheFile: string, map: CacheMap): void {
	try {
		fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
		const entries: Record<string, CacheEntry> = {};
		for (const [key, val] of map) entries[key] = val;
		// Atomic write (temp + rename): we flush repeatedly during a long cold
		// build, so a kill mid-write must not leave a truncated/corrupt cache.
		const tmp = `${cacheFile}.tmp`;
		fs.writeFileSync(
			tmp,
			JSON.stringify({ version: THUMB_VERSION, bins: THUMB_BINS, entries }, null, 0)
		);
		fs.renameSync(tmp, cacheFile);
	} catch (err) {
		console.warn(`   [thumbnails] could not write cache ${cacheFile}:`, (err as Error).message);
	}
}

/**
 * Persist the human-auditable failure log next to the peak cache. Unlike
 * the cache (a machine-keyed stat map), this is a sorted, categorized list
 * of every sample that produced no thumbnail this run and why — so a
 * missing tile can be traced to a concrete reason (unresolvable clip,
 * refused codec, oversized file). Overwritten each run (full snapshot, not
 * a delta). Never throws — a log-write failure must not fail the build.
 */
export function saveFailureLog(logFile: string, failures: FailureRecord[]): void {
	try {
		fs.mkdirSync(path.dirname(logFile), { recursive: true });
		const byReason: Record<string, number> = {};
		for (const f of failures) byReason[f.reason] = (byReason[f.reason] ?? 0) + 1;
		// Group by reason, then sort paths within each group for a stable,
		// diff-friendly file (the scan order is concurrency-dependent).
		const sorted = [...failures].sort(
			(a, b) => a.reason.localeCompare(b.reason) || a.path.localeCompare(b.path)
		);
		const tmp = `${logFile}.tmp`;
		fs.writeFileSync(
			tmp,
			JSON.stringify(
				{ version: THUMB_VERSION, total: failures.length, byReason, failures: sorted },
				null,
				2
			)
		);
		fs.renameSync(tmp, logFile);
	} catch (err) {
		console.warn(`   [thumbnails] could not write failure log ${logFile}:`, (err as Error).message);
	}
}

// Lazily-loaded decode modules. Typed loosely — these live in the
// SvelteKit route tree and are pulled in by dynamic import so a
// resolution failure is catchable rather than a hard module-load crash.
type ProbeFormat = (fd: unknown, sizeBytes: number) => Promise<unknown | null>;
type StreamPcmPeaks = (
	fd: unknown,
	info: unknown,
	bins: number,
	transientWindowFrames: number
) => Promise<{ peaks: [number, number][] }>;
type ReadAsdOverview = (
	samplePath: string,
	bins: number
) => Promise<{ peaks: [number, number][]; sourceBins: number } | null>;
type IsAlc = (p: string) => boolean;
type ResolveAlc = (alcPath: string, raw: Buffer, packRoots?: readonly string[]) => Promise<string | null>;
type DecodedAudio = { channelData: Float32Array[]; sampleRate: number };
type DecodeFn = (buf: ArrayBuffer | Buffer | Uint8Array) => Promise<DecodedAudio>;

interface Reducer {
	probeFormat: ProbeFormat;
	streamPcmPeaks: StreamPcmPeaks;
	readAsdOverview: ReadAsdOverview;
	isAlc: IsAlc;
	resolveAlc: ResolveAlc;
	/** Path B full-decode (compressed mp3/flac/ogg/m4a/opus). `null` if `audio-decode` won't load. */
	decode: DecodeFn | null;
}

async function loadReducer(): Promise<Reducer | null> {
	try {
		const probeMod = await import('../../../routes/api/sample-peaks/formatProbe');
		const streamMod = await import('../../../routes/api/sample-peaks/streamingPcmPeaks');
		const asdMod = await import('../../../routes/api/sample-peaks/asdOverview');
		const alcMod = await import('../../../routes/api/sample-peaks/alcResolver');
		if (
			typeof probeMod.probeFormat !== 'function' ||
			typeof streamMod.streamPcmPeaks !== 'function' ||
			typeof asdMod.readAsdOverview !== 'function' ||
			typeof alcMod.isAlc !== 'function' ||
			typeof alcMod.resolveAlc !== 'function'
		) {
			return null;
		}
		// Path B decoder is optional: if `audio-decode` (WASM sub-decoders)
		// fails to load, compressed files simply tombstone as before — the
		// PCM/`.asd` paths still bake. So load it best-effort, not fatally.
		let decode: DecodeFn | null = null;
		try {
			const decodeMod = await import('audio-decode');
			const fn = (decodeMod as unknown as { default?: DecodeFn }).default;
			if (typeof fn === 'function') decode = fn;
		} catch (err) {
			console.warn(
				'   [thumbnails] audio-decode unavailable — compressed (mp3/flac/ogg) will tombstone:',
				(err as Error).message
			);
		}
		return {
			probeFormat: probeMod.probeFormat as ProbeFormat,
			streamPcmPeaks: streamMod.streamPcmPeaks as StreamPcmPeaks,
			readAsdOverview: asdMod.readAsdOverview as ReadAsdOverview,
			isAlc: alcMod.isAlc as IsAlc,
			resolveAlc: alcMod.resolveAlc as ResolveAlc,
			decode
		};
	} catch (err) {
		console.warn('   [thumbnails] decode modules unavailable, skipping bake:', (err as Error).message);
		return null;
	}
}

/**
 * Reduce decoded channel data to per-bin **RMS** pairs `[-rms, +rms]`.
 * Mono-sums channels per frame so a stereo file collapses to one envelope
 * (the tile paints a single-color waveform). Unlike a min/max peak reducer,
 * RMS captures a bin's *energy density* rather than its single loudest
 * instant, so busy loops read as a smooth envelope instead of a picket fence
 * of stray transients. Stored symmetrically as `[-rms, +rms]` to keep the
 * `[lo, hi]` pair layout (`waveformThumbnail.ts` v2) that the tile and codec
 * share; the tile collapses it to `max(|lo|,|hi|) = rms` all the same.
 *
 * This is bake-only (browser thumbnails). The live `/api/sample-peaks`
 * endpoint keeps its own min/max reducer — the strip/editor want true peaks.
 */
function reduceToRmsPairs(audioData: DecodedAudio, bins: number): [number, number][] {
	const channelData = audioData.channelData;
	const channels = channelData.length;
	const frames = channels > 0 ? channelData[0].length : 0;
	const safeBins = Math.max(1, Math.floor(bins) || 1);
	const peaks: [number, number][] = new Array(safeBins);
	const framesPerBin = frames / safeBins;
	for (let i = 0; i < safeBins; i++) {
		const start = Math.floor(i * framesPerBin);
		const end = Math.min(frames, Math.floor((i + 1) * framesPerBin));
		let sumSq = 0;
		let count = 0;
		for (let f = start; f < end; f++) {
			let sum = 0;
			for (let c = 0; c < channels; c++) sum += channelData[c][f];
			const v = sum / channels;
			sumSq += v * v;
			count++;
		}
		const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
		peaks[i] = [-rms, rms];
	}
	return peaks;
}

/**
 * Compute a base64 thumbnail for one file, returning `{ peaks, reason }`:
 * `peaks` is the base64 thumbnail, or `null` with a `FailureReason` when
 * Live's `.asd` overview, PCM streaming, AND compressed full-decode all
 * fail (→ tombstone).
 *
 * Ordering is `.asd` (Path C) → PCM (Path A) → compressed full-decode
 * (Path B). C→A is the INVERSE of the `/api/sample-peaks` endpoint's A→C;
 * Path B (compressed) is the shared last resort. Intentional and
 * surface-specific (ADR-398/401): the browser bakes coarse 64-bin
 * thumbnails over tens of thousands of read-only pack samples with no
 * auto-trim dependency, so the cheap ~20 KB `.asd` sidecar read beats
 * streaming/decoding a multi-MB file — and it's the only way to render
 * protected pack AIFC that nothing can decode. Path B (`audio-decode`)
 * inflates the whole file to Float32 PCM, so it runs last and is gated by
 * the `waveformMaxBytes` size cap; it's what lets mp3/flac/ogg samples
 * bake a real waveform. The endpoint keeps decode-first because its
 * consumers (Simpler/editor @1024 bins, auto-trim's `firstTransientFrame`)
 * need real-audio precision when the file is decodable; the `.asd`
 * overview is coarser and carries no transient data.
 *
 * Reduction differs by path: Paths C (`.asd` overview) and A (streaming PCM)
 * store true `[min, max]` peaks — those sources only expose min/max, and the
 * shared endpoint reducer must stay peak-based for the strip/editor. Path B
 * (full-decode) instead stores symmetric **RMS** pairs `[-rms, +rms]` via
 * `reduceToRmsPairs`, since it has the raw Float32 PCM to compute energy from
 * — that's the path compressed loops/samples take, exactly where per-bin
 * energy reads better than spiky peaks. The tile collapses either shape to
 * `max(|lo|,|hi|)`, so the split is invisible downstream (see
 * `waveformThumbnail.ts` v2).
 *
 * `.alc` (Ableton Live Clip) is a gzipped-XML wrapper — not audio, with no
 * `.asd` of its own — so it's resolved to the underlying sample it references
 * first (mirroring the endpoint's `isAlc`/`resolveAlc`), then C→A run against
 * that. The cache stays keyed on the original `.alc` path + its own mtime/size
 * (that's what the generator scans), so an edited clip re-resolves. Known
 * tradeoff: if the *referenced* sample is swapped in place without touching the
 * `.alc`, the stale thumbnail is served until the `.alc` itself changes —
 * accepted (packs are read-only; not worth re-resolving every clip every build).
 */
async function computeThumbnail(
	fullPath: string,
	sizeBytes: number,
	reducer: Reducer
): Promise<ThumbnailResult> {
	const ok = (peaks: string): ThumbnailResult => ({ peaks, reason: null });
	const fail = (reason: FailureReason): ThumbnailResult => ({ peaks: null, reason });

	// Resolve `.alc` → underlying sample before any decode. Without this every
	// `.alc` tile tombstones forever (no `<alc>.asd`, gzip bytes aren't PCM).
	let decodePath = fullPath;
	let decodeSize = sizeBytes;
	if (reducer.isAlc(fullPath)) {
		try {
			const resolved = await reducer.resolveAlc(fullPath, await readFile(fullPath), packRoots());
			if (!resolved) return fail('alc-unresolvable'); // endpoint 404s too
			decodePath = resolved;
			decodeSize = (await stat(decodePath)).size;
		} catch {
			return fail('alc-read-error');
		}
	}

	// Path C first: Live's `.asd` overview (reads `<decodePath>.asd`; null if absent).
	try {
		const overview = await reducer.readAsdOverview(decodePath, THUMB_BINS);
		if (overview && overview.peaks.length > 0) {
			return ok(encodeThumbnailPeaks(overview.peaks));
		}
	} catch {
		// fall through to Path A
	}

	// Path A: streaming PCM (WAV/AIFF/AIFC uniform PCM). `probeFormat` → null
	// for anything non-PCM (compressed / unknown / malformed); those drop to
	// Path B below rather than tombstoning here.
	let fd: Awaited<ReturnType<typeof open>> | null = null;
	try {
		fd = await open(decodePath, 'r');
		const info = await reducer.probeFormat(fd, decodeSize);
		if (info) {
			// transientWindowFrames=0 — the tile never needs the auto-trim marker.
			const { peaks } = await reducer.streamPcmPeaks(fd, info, THUMB_BINS, 0);
			if (peaks && peaks.length > 0) return ok(encodeThumbnailPeaks(peaks));
			return fail('empty-peaks');
		}
	} catch {
		// PCM path threw (rare — malformed header past the probe) → try Path B.
	} finally {
		if (fd) await fd.close().catch(() => {});
	}

	// Path B: full-decode compressed audio (mp3/flac/ogg/m4a/opus) via
	// `audio-decode`, mirroring the /api/sample-peaks endpoint. Gated on the
	// size cap because Path B inflates the entire file to Float32 PCM in
	// memory; a file too large to render live is tombstoned here too.
	if (!reducer.decode) return fail('decode-failed');
	if (decodeSize > waveformMaxBytes()) return fail('too-large');
	try {
		const buf = await readFile(decodePath);
		const audioData = await reducer.decode(buf);
		const peaks = reduceToRmsPairs(audioData, THUMB_BINS);
		if (!peaks || peaks.length === 0) return fail('empty-peaks');
		return ok(encodeThumbnailPeaks(peaks));
	} catch {
		// audio-decode throws on truly unrecognized codecs / malformed files.
		return fail('decode-failed');
	}
}

/** Run `fn` over `items` with a bounded number of concurrent workers. */
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
	let cursor = 0;
	const workers: Promise<void>[] = [];
	const worker = async () => {
		while (cursor < items.length) {
			const idx = cursor++;
			await fn(items[idx]);
		}
	};
	for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
	await Promise.all(workers);
}

/**
 * Bake thumbnails onto `presets` (mutating `preset.peaks`) using the
 * incremental cache at `cacheFile`. A preset gets a thumbnail when its
 * `.asd` overview (Path C), PCM decode (Path A), or compressed full-decode
 * (Path B) succeeds; only files all three refuse — unresolvable `.alc`,
 * codecs `audio-decode` won't touch, oversized files — are tombstoned and
 * left for the tile's live-fetch fallback. Eligibility is decided by decode
 * success, not by file extension. Each tombstone is recorded with a reason;
 * when `failureLogFile` is given, the full per-file list is written there.
 * Returns per-run stats; progress is logged every PROGRESS_EVERY files and
 * the cache is flushed every FLUSH_EVERY so a long cold build is observable
 * and resumable.
 */
export async function bakeThumbnails(
	presets: ThumbnailablePreset[],
	cacheFile: string,
	failureLogFile?: string,
	opts: {
		log?: (line: string) => void;
		/** Keep the cache's entries for files this call does not cover. The Places
		 * service bakes one Place per call into one shared cache; without this each
		 * Place's save dropped every other Place's thumbnails, and the next start
		 * decoded them all again. */
		keepUnseen?: boolean;
	} = {}
): Promise<BakeStats> {
	const log = opts.log ?? ((line: string) => console.log(line));
	const stats: BakeStats = {
		total: presets.length,
		decoded: 0,
		reused: 0,
		tombstoned: 0,
		missing: 0,
		failuresByReason: {
			'alc-unresolvable': 0,
			'alc-read-error': 0,
			'decode-failed': 0,
			'too-large': 0,
			'empty-peaks': 0,
			'unknown-error': 0
		},
		failures: [],
		unavailable: false
	};

	// Record a tombstone: bump per-reason count and append to the failure log.
	// Called for both freshly-computed tombstones and reused ones so the log
	// is a complete picture every run, not just of the files that changed.
	const recordFailure = (path: string, reason: FailureReason, size: number) => {
		stats.tombstoned++;
		stats.failuresByReason[reason]++;
		stats.failures.push({ path, reason, size });
	};

	// Dedupe by absolute path — the same sample can appear under multiple
	// folders (variants, cross-listed families); decode it once and share.
	const byPath = new Map<string, ThumbnailablePreset[]>();
	for (const p of presets) {
		if (!p.fullPath) continue;
		const list = byPath.get(p.fullPath);
		if (list) list.push(p);
		else byPath.set(p.fullPath, [p]);
	}

	const reducer = await loadReducer();
	if (!reducer) {
		stats.unavailable = true;
		return stats;
	}

	const oldCache = loadPeakCache(cacheFile);
	const newCache: CacheMap = new Map();
	if (opts.keepUnseen) for (const [path, entry] of oldCache) if (!byPath.has(path)) newCache.set(path, entry);
	const uniquePaths = [...byPath.keys()];
	const total = uniquePaths.length;
	const startMs = Date.now();
	let processed = 0;

	// After each file: log progress every PROGRESS_EVERY, and flush the cache
	// every FLUSH_EVERY so an interrupted cold build resumes from the last flush.
	// `processed` is only touched between awaits (single-threaded), so each value
	// 1..total is produced exactly once and each milestone fires exactly once.
	const checkpoint = () => {
		processed++;
		if (processed % PROGRESS_EVERY === 0 || processed === total) {
			const elapsed = (Date.now() - startMs) / 1000;
			const rate = elapsed > 0 ? processed / elapsed : 0;
			const eta = rate > 0 ? (total - processed) / rate : Infinity;
			log(
				`   … ${processed}/${total} thumbnails ` +
					`(decoded ${stats.decoded}, cached ${stats.reused}, other ${stats.tombstoned + stats.missing}) ` +
					`· ${rate.toFixed(0)}/s · ETA ${formatEta(eta)}`
			);
		}
		if (processed % FLUSH_EVERY === 0 && processed !== total) {
			savePeakCache(cacheFile, newCache);
		}
	};

	await mapWithConcurrency(uniquePaths, DECODE_CONCURRENCY, async (fullPath) => {
		try {
			const targets = byPath.get(fullPath)!;

			let st: { mtimeMs: number; size: number };
			try {
				const s = await stat(fullPath);
				st = { mtimeMs: s.mtimeMs, size: s.size };
			} catch {
				stats.missing++;
				return; // vanished between scan and bake — leave peaks unset
			}

			const cached = oldCache.get(fullPath);
			if (cached && cached.v === THUMB_VERSION && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
				newCache.set(fullPath, cached);
				if (cached.peaks) {
					for (const t of targets) t.peaks = cached.peaks;
					stats.reused++;
				} else {
					// Reused tombstone. Older caches predate the `reason` field —
					// fall back to 'unknown-error' so the log still lists the file.
					recordFailure(fullPath, cached.reason ?? 'unknown-error', st.size);
				}
				return;
			}

			const { peaks: b64, reason } = await computeThumbnail(fullPath, st.size, reducer);
			newCache.set(fullPath, {
				mtimeMs: st.mtimeMs,
				size: st.size,
				v: THUMB_VERSION,
				peaks: b64,
				...(b64 ? {} : { reason: reason ?? 'unknown-error' })
			});
			if (b64) {
				for (const t of targets) t.peaks = b64;
				stats.decoded++;
			} else {
				recordFailure(fullPath, reason ?? 'unknown-error', st.size);
			}
		} finally {
			checkpoint();
		}
	});

	savePeakCache(cacheFile, newCache);
	if (failureLogFile) saveFailureLog(failureLogFile, stats.failures);
	return stats;
}
