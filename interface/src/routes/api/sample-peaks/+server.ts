/**
 * `/api/sample-peaks?path=<abs>&bins=<64..2048>` — decodes a sample
 * file, returns per-bin [min, max] peaks for the waveform render and
 * a first-transient frame index for the auto-trim flow (see ADR-354).
 *
 * **No worker pool.** A previous iteration spawned `decodeWorker.js`
 * via `new Worker(new URL('./decodeWorker.js', import.meta.url))`.
 * That works in `vite dev` (resolves URL against source paths) but
 * breaks in production: SvelteKit's adapter doesn't copy the worker
 * file alongside the bundled `_server.ts.js`, so `new Worker(...)`
 * fails at runtime and every request 500s. The iPad serves through
 * `vite preview`, which is why the bug only ever manifested on the
 * iPad URL. Inlining decode is fine for the single-user iPad
 * concurrency profile (1-2 in flight max). If concurrency ever
 * grows, prefer a `?worker` import pattern over the
 * `import.meta.url` URL form so the bundler tracks the file.
 *
 * **`&transients=1`** answers `{ transients: seconds[], source }` instead:
 * Live's own onsets from the `.asd` beside the file (`source: 'live'`,
 * asdOnsets.ts) or, without them, onsetDetector.js over a fine envelope
 * (`'detected'`); `'none'` when neither can be had. The clip editor snaps
 * a new warp marker to them.
 *
 * **Only the sample library and Live projects.** A path outside the roots in
 * `$lib/server/sampleRoots` is a 403 before the file is opened; this
 * route used to decode whatever absolute path a LAN host named (general-release
 * audit §5.3). What passes is the *normalized* path, and everything below opens
 * that string, never `rawPath` — see sampleRoots.ts for why the difference is
 * a way out of the root.
 */
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { realpath, stat, readFile, open } from 'node:fs/promises';
import { findFirstTransient } from './transientDetector.js';
import { probeFormat, probeSampleRate } from './formatProbe.js';
import { streamPcmPeaks } from './streamingPcmPeaks.js';
import { readAsdOverview } from './asdOverview.js';
import { readAsdOnsets } from './asdOnsets.js';
import { detectOnsets, HOP_FRAMES } from './onsetDetector.js';
import { isAlc, resolveAlc } from './alcResolver.js';
import { isAllowedSamplePath, normalizeSamplePath } from '$lib/server/sampleRoots';
import { logger } from '$lib/utils/logger';
import { runtimeConstants } from '$lib/server/runtimeConfig';

/** Installed Packs folders a pack clip copied out of its pack resolves against. */
function packRoots(): string[] {
	return [(runtimeConstants() as { paths?: { abletonPacksBase?: unknown } }).paths?.abletonPacksBase].filter(
		(r): r is string => typeof r === 'string' && r.length > 0
	);
}

// Bake the file-size cap in at build time via Vite's JSON import —
// the prior `fs.readFile(constants.json)` approach used `import.meta.url`
// path math calibrated for the source-tree layout, which broke in
// production builds because the bundled `_server.ts.js` lives several
// levels deeper. Direct JSON import is the established pattern across
// `devicePresets.ts`, `UnifiedGestureBrowser`, etc., and Vite resolves
// it at build time so production needs no runtime fs read.
//
// `waveformMaxBytes()` is now Path-B-only (full-decode for compressed
// audio). Path A (streaming PCM for WAV/AIFF) ignores it because cost
// decouples from file size.
// Read from disk when the server runs (`$lib/server/runtimeConfig`, since
// 2026-09-26): the build holds code only, and a missing value is the
// mixer's default rather than a build that dies (plan.md §2).
function waveformMaxBytes(): number {
	const v = (runtimeConstants() as { paths?: { waveformMaxBytes?: number } })?.paths?.waveformMaxBytes;
	return typeof v === 'number' && v > 0 ? v : 78643200;
}

function streamingEnabled(): boolean {
	const v = (runtimeConstants() as { paths?: { waveformStreamingEnabled?: boolean } })
		?.paths?.waveformStreamingEnabled;
	// Default-true if missing — the streaming path is the new normal.
	// Roll back by setting to `false` in constants.json (no code change).
	return v !== false;
}

// Leading window of audio fed to `findFirstTransient`. Must be wide
// enough to contain the actual first hit, or detection returns 0 and
// auto-trim silently skips. Live-looping captures routinely carry
// 0.3–1.9s of pre-roll (count-in latency, a breath before the first
// note), so 0.2s dropped the majority of real captures. 3s covers
// every observed capture with margin and matches AUTO_TRIM_TIMEOUT_MS
// (clipOperations.ts) — no point detecting past the window the watcher
// waits on. Stream-side, so we still release buffers early.
const TRANSIENT_WINDOW_SECONDS = 3.0;

const BIN_MIN = 64;
const BIN_MAX = 2048;
const BIN_DEFAULT = 1024;

type PeakResponse = {
	path: string;
	sampleRate: number;
	frames: number;
	channels: number;
	bins: number;
	peaks: [number, number][];
	// Frame index of the first detected transient. Populated by the
	// transient detector pass alongside the peaks reduction so auto-trim
	// consumers (clipOperations.ts) don't need a second decode. Returns
	// 0 when the sample is silent, too short, or noise-dominated — see
	// transientDetector.js for the heuristic.
	firstTransientFrame: number;
};

// Bounded LRU keyed by `${realpath}:${mtimeMs}:${bins}`. Map iteration order
// is insertion order, so we delete+set on hit to mark recent.
const CACHE_MAX = 32;
const cache = new Map<string, PeakResponse>();
function cacheGet(key: string): PeakResponse | undefined {
	const v = cache.get(key);
	if (v !== undefined) {
		cache.delete(key);
		cache.set(key, v);
	}
	return v;
}
function cacheSet(key: string, v: PeakResponse): void {
	if (cache.has(key)) cache.delete(key);
	cache.set(key, v);
	while (cache.size > CACHE_MAX) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
}

// Lazy-loaded decoder. `audio-decode` v3 pulls in WASM sub-decoders
// on first use, so the first decode pays a setup cost (~50-100ms) and
// subsequent ones are fast. Keep the module-level promise so the
// import resolves at most once per process lifetime.
type DecodedAudio = { channelData: Float32Array[]; sampleRate: number };
type DecodeFn = (buf: ArrayBuffer | Buffer) => Promise<DecodedAudio>;
let decodePromise: Promise<DecodeFn> | null = null;
function getDecode(): Promise<DecodeFn> {
	if (!decodePromise) {
		decodePromise = import('audio-decode').then(
			(m) => (m as unknown as { default: DecodeFn }).default
		);
	}
	return decodePromise;
}

/**
 * Reduce decoded channel data to per-bin [min, max] peaks. Mono-sums
 * channels per frame so a stereo file collapses to one envelope; the
 * UI's waveform render is single-color per bin.
 */
function reduceToPeaks(
	audioData: DecodedAudio,
	bins: number
): { peaks: [number, number][]; bins: number } {
	const channelData = audioData.channelData;
	const channels = channelData.length;
	const frames = channels > 0 ? channelData[0].length : 0;

	// Defensive guard: route clamps `bins` to [BIN_MIN, BIN_MAX] before
	// calling, so this can't fire in production. But guarding here keeps
	// the function safe for future direct callers (test harnesses) — a
	// `bins=0` would otherwise produce framesPerBin=Infinity and emit
	// NaN peaks (silent corruption).
	const safeBins = Math.max(1, Math.floor(Number(bins) || 1));

	const peaks: [number, number][] = new Array(safeBins);
	const framesPerBin = frames / safeBins;

	for (let i = 0; i < safeBins; i++) {
		const start = Math.floor(i * framesPerBin);
		const end = Math.min(frames, Math.floor((i + 1) * framesPerBin));
		let min = Infinity;
		let max = -Infinity;
		for (let f = start; f < end; f++) {
			let sum = 0;
			for (let c = 0; c < channels; c++) sum += channelData[c][f];
			const v = sum / channels;
			if (v < min) min = v;
			if (v > max) max = v;
		}
		// Empty bin (frames < bins) — pad with zeros.
		if (min === Infinity) {
			min = 0;
			max = 0;
		}
		peaks[i] = [min, max];
	}
	return { peaks, bins: safeBins };
}

type TransientResponse = { transients: number[]; source: 'live' | 'detected' | 'none' };
const transientCache = new Map<string, TransientResponse>();

async function transientsFor(paths: string[], real: string, size: number): Promise<TransientResponse> {
	let sampleRate = 0;
	let frames = 0;
	let envelope: [number, number][] | null = null;
	if (streamingEnabled()) {
		let fd: Awaited<ReturnType<typeof open>> | null = null;
		try {
			fd = await open(real, 'r');
			const info = await probeFormat(fd, size);
			if (info) {
				sampleRate = info.sampleRate;
				frames = info.totalFrames;
				const live = await readAsdOnsets(paths, frames);
				if (live) return { transients: live.map((f) => f / sampleRate), source: 'live' };
				const hops = Math.max(1, Math.ceil(frames / HOP_FRAMES));
				envelope = (await streamPcmPeaks(fd, info, hops, 0)).peaks;
			}
		} catch (e) {
			logger.warn('sample-transients-streaming', { path: real, reason: (e as Error).message });
		} finally {
			if (fd) await fd.close().catch(() => {});
		}
	}
	if (!envelope && !(sampleRate > 0)) {
		// Audio we cannot stream (compressed, or Ableton's protected
		// AIFC): Live's onsets need only the rate its header declares.
		let fd: Awaited<ReturnType<typeof open>> | null = null;
		try {
			fd = await open(real, 'r');
			const header = await probeSampleRate(fd, size);
			if (header) {
				const live = await readAsdOnsets(paths, header.frames);
				if (live) return { transients: live.map((f) => f / header.sampleRate), source: 'live' };
			}
		} catch {
			// fall through to a decode
		} finally {
			if (fd) await fd.close().catch(() => {});
		}
	}
	if (!envelope && size <= waveformMaxBytes()) {
		try {
			const audio = await (await getDecode())(await readFile(real));
			sampleRate = audio.sampleRate;
			frames = audio.channelData[0]?.length ?? 0;
			const live = await readAsdOnsets(paths, frames);
			if (live) return { transients: live.map((f) => f / sampleRate), source: 'live' };
			envelope = reduceToPeaks(audio, Math.max(1, Math.ceil(frames / HOP_FRAMES))).peaks;
		} catch {
			// Undecodable (Ableton's protected pack audio): nothing to detect on.
		}
	}
	if (!envelope || !(sampleRate > 0)) return { transients: [], source: 'none' };
	const hopSeconds = frames / envelope.length / sampleRate;
	return { transients: detectOnsets(envelope, hopSeconds), source: 'detected' };
}

export const GET: RequestHandler = async ({ url }) => {
	const rawPath = url.searchParams.get('path');
	if (!rawPath) throw error(400, 'missing path param');

	const requestedPath = normalizeSamplePath(rawPath);
	if (!requestedPath || !isAllowedSamplePath(requestedPath)) {
		logger.warn('sample-peaks: refused a path outside the sample roots', { path: rawPath });
		throw error(403, 'path is outside the sample library and Live projects');
	}

	const binsParam = url.searchParams.get('bins');
	let bins = BIN_DEFAULT;
	if (binsParam !== null) {
		const parsed = Number.parseInt(binsParam, 10);
		if (!Number.isFinite(parsed)) throw error(400, 'bins must be an integer');
		bins = Math.max(BIN_MIN, Math.min(BIN_MAX, parsed));
	}

	// An .alc (Ableton Live Clip) is a gzipped XML wrapper, not audio.
	// Resolve it to the underlying sample it references, then render that
	// file's waveform. Mirrors the Python surface's load-side resolver.
	let sourcePath = requestedPath;
	if (isAlc(requestedPath)) {
		let alcReal: string;
		try {
			alcReal = await realpath(requestedPath);
		} catch (e) {
			const code = (e as NodeJS.ErrnoException).code;
			if (code === 'ENOENT') throw error(404, 'file not found');
			throw error(400, `cannot resolve path: ${(e as Error).message}`);
		}
		let resolved: string | null = null;
		try {
			resolved = await resolveAlc(alcReal, await readFile(alcReal), packRoots());
		} catch (e) {
			logger.warn('alc-resolve-failed', { path: alcReal, reason: (e as Error).message });
		}
		if (!resolved) throw error(404, 'could not resolve .alc to an audio file');
		sourcePath = resolved;
	}

	let real: string;
	try {
		real = await realpath(sourcePath);
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') throw error(404, 'file not found');
		throw error(400, `cannot resolve path: ${(e as Error).message}`);
	}

	let st;
	try {
		st = await stat(real);
	} catch {
		throw error(404, 'file not found');
	}
	if (!st.isFile()) throw error(400, 'path is not a regular file');

	if (url.searchParams.get('transients') === '1') {
		const key = `${real}:${st.mtimeMs}`;
		let answer = transientCache.get(key);
		if (!answer) {
			answer = await transientsFor([...new Set([sourcePath, real])], real, st.size);
			transientCache.set(key, answer);
			if (transientCache.size > CACHE_MAX) transientCache.delete(transientCache.keys().next().value!);
		}
		return json(answer);
	}

	const cacheKey = `${real}:${st.mtimeMs}:${bins}`;
	const cached = cacheGet(cacheKey);
	if (cached) return json(cached);

	// --- Path A: streaming PCM (WAV/AIFF/AIFC) ---
	// Probe BEFORE the size cap. Path A's cost decouples from file size,
	// so the cap shouldn't apply. For compressed (probe → null), we fall
	// through to Path B below where the cap still gates 413s.
	if (streamingEnabled()) {
		let fd: Awaited<ReturnType<typeof open>> | null = null;
		try {
			fd = await open(real, 'r');
			const info = await probeFormat(fd, st.size);
			if (info) {
				const t0 = performance.now();
				const transientWindowFrames = Math.round(
					TRANSIENT_WINDOW_SECONDS * info.sampleRate
				);
				const { peaks, firstTransientFrame, frames } = await streamPcmPeaks(
					fd,
					info,
					bins,
					transientWindowFrames
				);
				const result: PeakResponse = {
					path: real,
					sampleRate: info.sampleRate,
					frames,
					channels: info.channels,
					bins: peaks.length,
					peaks,
					firstTransientFrame
				};
				cacheSet(cacheKey, result);
				logger.debug('peaks-streaming', {
					path: 'A',
					kind: info.kind,
					sizeBytes: st.size,
					durationMs: Math.round(performance.now() - t0),
					bins,
					frames,
					sampleRate: info.sampleRate,
					firstTransientFrame
				});
				return json(result);
			}
		} catch (e) {
			// If the probe-or-stream path itself blew up (e.g. malformed
			// WAV header that probe accepted but stream choked on),
			// don't 500 — fall through to Path B and let audio-decode
			// have a try. Worst case the file is genuinely broken and
			// Path B 415s.
			logger.warn('peaks-streaming-fallback', {
				path: real,
				reason: (e as Error).message
			});
		} finally {
			if (fd) await fd.close().catch(() => {});
		}
	}

	// --- Path C: Live's `.asd` overview (proprietary/undecodable audio) ---
	// Before we hand off to audio-decode (which will 415 on Ableton's
	// `able`-tagged pack AIFC and other codecs it can't read), try the
	// waveform overview Live already stored in `<sample>.asd`. That gives
	// a real min/max envelope for protected pack samples with no decode.
	// firstTransientFrame stays 0 here: the `.asd` overview carries no
	// per-frame data, so auto-trim degrades to its existing silent-skip
	// (same as any undecodable file) rather than getting a bogus value.
	{
		const t0 = performance.now();
		const overview = await readAsdOverview(real, bins);
		if (overview) {
			const result: PeakResponse = {
				path: real,
				// The `.asd` overview is amplitude-only; we don't parse the
				// COMM/format fields from it. Report 0 for sampleRate/frames
				// (unknown from this path) — consumers use `peaks` for the
				// strip render and don't rely on these for `.asd`-sourced
				// clips.
				sampleRate: 0,
				frames: 0,
				channels: 0,
				bins: overview.peaks.length,
				peaks: overview.peaks,
				firstTransientFrame: 0
			};
			cacheSet(cacheKey, result);
			logger.debug('peaks-asd', {
				path: 'C',
				sizeBytes: st.size,
				durationMs: Math.round(performance.now() - t0),
				bins,
				sourceBins: overview.sourceBins
			});
			return json(result);
		}
	}

	// --- Path B: full-decode (compressed: mp3/flac/ogg/m4a/opus,
	// or PCM when the streaming path is disabled / probe returns null) ---
	if (st.size > waveformMaxBytes()) {
		throw error(413, `file exceeds ${waveformMaxBytes()} bytes`);
	}

	let buf: Buffer;
	try {
		buf = await readFile(real);
	} catch (e) {
		throw error(500, `read failed: ${(e as Error).message}`);
	}

	const t0 = performance.now();
	let audioData: DecodedAudio;
	try {
		const decode = await getDecode();
		// Pass a Uint8Array view of the buffer; audio-decode accepts both
		// Buffer and ArrayBuffer. Decode is CPU-bound and blocks the event
		// loop, but we serve a single-user iPad — concurrency is 1-2
		// in flight at most, and the LRU cache absorbs repeats.
		audioData = await decode(buf);
	} catch (e) {
		// audio-decode throws synchronously on truly unrecognized formats
		// (no codec match) and asynchronously on malformed files. Either
		// way we map to 415 so the UI's existing decode-fail branch
		// (silent skip in clipOperations.fetchTransientFrame, "no peaks"
		// fallback in SimplerLoopControl) takes over.
		throw error(415, `decode failed: ${(e as Error).message}`);
	}

	const channels = audioData.channelData.length;
	const frames = channels > 0 ? audioData.channelData[0].length : 0;
	const { peaks, bins: actualBins } = reduceToPeaks(audioData, bins);
	const firstTransientFrame = findFirstTransient(
		audioData.channelData,
		audioData.sampleRate
	);
	const result: PeakResponse = {
		path: real,
		sampleRate: audioData.sampleRate,
		frames,
		channels,
		bins: actualBins,
		peaks,
		firstTransientFrame
	};

	cacheSet(cacheKey, result);
	logger.debug('peaks-decode', {
		path: 'B',
		sizeBytes: st.size,
		durationMs: Math.round(performance.now() - t0),
		bins,
		frames,
		sampleRate: audioData.sampleRate,
		firstTransientFrame
	});
	return json(result);
};
