/**
 * A preset's saved values from the Mac (`/api/places/preset-params`), cached
 * per file for the session and asked once however many tiles want it.
 * `null` when the Mac has none to give (not an `.adv`, outside the Places).
 */
import { logger } from '$lib/utils/logger';

export interface PresetParams {
	className: string;
	params: Record<string, number>;
}

const cache = new Map<string, Promise<PresetParams | null>>();

export function presetParams(fullPath: string): Promise<PresetParams | null> {
	let hit = cache.get(fullPath);
	if (!hit) {
		hit = fetch(`/api/places/preset-params?path=${encodeURIComponent(fullPath)}`)
			.then((r) => (r.ok ? (r.json() as Promise<PresetParams>) : null))
			.catch((err) => {
				logger.debug('Preset params: fetch failed', { component: 'presetParams', fullPath, err: String(err) });
				return null;
			});
		cache.set(fullPath, hit);
	}
	return hit;
}
