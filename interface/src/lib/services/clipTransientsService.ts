/**
 * The transients of an audio file, in seconds, for snapping a new warp
 * marker (`/api/sample-peaks?transients=1`): Live's own from the file's
 * `.asd` when it has them, else the server's detector. Cached per path;
 * a failed fetch answers [] and is not cached, so the next focus retries.
 */
import { logger } from '$lib/utils/logger';

const cache = new Map<string, number[]>();

export async function getTransients(filePath: string): Promise<number[]> {
	if (!filePath) return [];
	const hit = cache.get(filePath);
	if (hit) return hit;
	try {
		const response = await fetch(
			`/api/sample-peaks?path=${encodeURIComponent(filePath)}&transients=1`
		);
		if (!response.ok) return [];
		const data = (await response.json()) as { transients?: number[] };
		const transients = Array.isArray(data.transients) ? data.transients : [];
		cache.set(filePath, transients);
		if (cache.size > 64) cache.delete(cache.keys().next().value!);
		return transients;
	} catch (err) {
		logger.debug('clipTransientsService: fetch failed', { filePath, error: (err as Error).message });
		return [];
	}
}
