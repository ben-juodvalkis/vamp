/**
 * clipWaveformService — ADR-360.
 *
 * Single entry point for `/api/sample-peaks` waveform fetches. Used
 * by both `TrackClipView` (track-strip render, bins=256) and
 * `SimplerLoopControl` (Simpler view, bins=1024) so the Vite prod
 * path trap (memory note: `decodeWorker.js` URL form breaks under
 * `vite preview`) is a single audit point rather than a cross-cutting
 * cluster.
 *
 * Caches an in-memory LRU keyed by `(filePath, bins)` — different
 * bin counts are different cache entries because the server returns
 * differently-binned arrays. Concurrent requests for the same key
 * dedupe via a shared promise; a rapid path change cancels the
 * inflight fetch via AbortController.
 *
 * Degrades silently on fetch failure (returns `null`), matching
 * `SimplerLoopControl`'s existing behaviour.
 */

import { logger } from '$lib/utils/logger';

export interface PeakData {
	peaks: [number, number][];
	bins: number;
	/**
	 * The file's length in seconds, when the server could decode it
	 * (`frames / sampleRate`); absent for an `.asd`-overview answer, which
	 * carries neither. The Reverb view's IR display spans its axis by it.
	 */
	seconds?: number;
}

type CacheEntry = PeakData;

interface InflightEntry {
	promise: Promise<PeakData | null>;
	controller: AbortController;
}

/**
 * Sized for the session clip grid's working set, not one waveform per
 * strip.
 *
 * The grid mounts `visibleTracks × (visibleRows + 1)` cells at once and
 * each asks for its own `(filePath, bins)` entry — and because the key
 * includes `bins`, a cell (64) and the strip above it (256) are two
 * entries for the same file, not one. At the old 16 the grid evicted
 * its own cells faster than it could paint them AND evicted the strips'
 * peaks on the way past, so every scene scroll re-hit `/api/sample-peaks`
 * — which for compressed formats means a full server-side decode per
 * miss (ADR-362 Path B). 128 covers ~12 tracks × 5 rows at both bin
 * counts with headroom; entries are small (two floats per bin).
 */
const CACHE_MAX = 128;

/** LRU cache keyed by `${filePath}:${bins}`. Insertion order = recency. */
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, InflightEntry>();

function cacheKey(filePath: string, bins: number): string {
	return `${filePath}:${bins}`;
}

function recordHit(key: string, value: CacheEntry): void {
	// Move-to-end on hit so the LRU eviction picks the genuinely
	// least-recently-used entry, not the oldest insertion.
	cache.delete(key);
	cache.set(key, value);
}

function evictLRU(): void {
	if (cache.size <= CACHE_MAX) return;
	const oldestKey = cache.keys().next().value;
	if (oldestKey !== undefined) cache.delete(oldestKey);
}

/**
 * Fetch waveform peaks for `filePath` at `bins` resolution.
 *
 * Returns `null` on any error path (404, decode failure, abort) —
 * the UI's existing degrade-silently behaviour stays intact.
 *
 * Concurrent calls for the same `(filePath, bins)` share one fetch.
 * A rapid path change against the same key aborts the prior fetch
 * before kicking off the new one — out-of-order resolution can't
 * overwrite a newer pending one.
 *
 * Pass ``force: true`` to bypass the cache (used by callers that know
 * the underlying file just changed shape — e.g. an in-progress audio
 * recording finalized into a longer file).
 */
export async function getPeaks(
	filePath: string,
	bins: number,
	options: { force?: boolean } = {}
): Promise<PeakData | null> {
	if (!filePath) return null;
	const key = cacheKey(filePath, bins);

	if (options.force) {
		cache.delete(key);
		const existing = inflight.get(key);
		if (existing) {
			existing.controller.abort();
			inflight.delete(key);
		}
	} else {
		const cached = cache.get(key);
		if (cached !== undefined) {
			recordHit(key, cached);
			return { ...cached };
		}

		const existing = inflight.get(key);
		if (existing) return existing.promise;
	}

	const controller = new AbortController();
	const promise = fetchPeaks(filePath, bins, controller).finally(() => {
		inflight.delete(key);
	});
	inflight.set(key, { promise, controller });
	return promise;
}

/**
 * Cancel an inflight fetch for `(filePath, bins)`. No-op if there's
 * no pending request. Used by callers whose key changed faster than
 * the fetch resolves.
 */
export function cancelPeaks(filePath: string, bins: number): void {
	const key = cacheKey(filePath, bins);
	const existing = inflight.get(key);
	if (existing) {
		existing.controller.abort();
		inflight.delete(key);
	}
}

/** Test helper — clear cache + inflight state. */
export function __resetClipWaveformServiceForTests(): void {
	for (const [, entry] of inflight) entry.controller.abort();
	inflight.clear();
	cache.clear();
}

async function fetchPeaks(
	filePath: string,
	bins: number,
	controller: AbortController
): Promise<PeakData | null> {
	const url = `/api/sample-peaks?path=${encodeURIComponent(filePath)}&bins=${bins}`;
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) {
			logger.debug('clipWaveformService: non-OK response', {
				filePath,
				bins,
				status: response.status
			});
			return null;
		}
		const data = (await response.json()) as {
			peaks: [number, number][];
			bins: number;
			frames?: number;
			sampleRate?: number;
		};
		const entry: CacheEntry = { peaks: data.peaks, bins: data.bins };
		if (data.frames && data.sampleRate) entry.seconds = data.frames / data.sampleRate;
		cache.set(cacheKey(filePath, bins), entry);
		evictLRU();
		return { ...entry };
	} catch (err) {
		if ((err as { name?: string })?.name === 'AbortError') {
			return null;
		}
		logger.debug('clipWaveformService: fetch failed', {
			filePath,
			bins,
			error: (err as Error).message
		});
		return null;
	}
}
