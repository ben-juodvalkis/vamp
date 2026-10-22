/**
 * The shape of each Wavetable factory table, so the Wavetable central view
 * can draw the table an oscillator plays.
 *
 * Live's API names an oscillator's table (category and index, and the names
 * of the tables in that category) but never hands over its samples, and the
 * factory tables live in Live's encrypted resources. So they were rendered
 * off Live itself: `owner/probes/wavetable_render_run.js` plays every table
 * with nothing colouring the sound, stepping Wave Position across 25 frames,
 * and `owner/probes/wavetable_render_audio.py` cuts one cycle per frame and
 * bundles them into `static/wavetables/factory.json` (2026-10-22, Live 12.4
 * beta). A table's frames share one phase; the first frame's fundamental
 * starts like a sine, and the loudest frame peaks at 1.
 *
 * The file is fetched once, the first time a view asks, and decoded table
 * by table as asked. User tables (the User category) are not in it.
 */
import { logger } from '$lib/utils/logger';

export interface WavetableBundle {
	format: 1;
	/** MIDI note the tables were rendered at. */
	note: number;
	/** Frames per table: Wave Position 0, 1/(frames-1) … 1. */
	frames: number;
	/** Samples per frame. */
	points: number;
	/** base64 of `frames × points` signed bytes (sample × 127), by category and table name. */
	tables: Record<string, Record<string, string>>;
}

/** One table, decoded: `frames` cycles of `points` samples, -1..1. */
export type WavetableFrames = Float32Array[];

export const FACTORY_URL = '/wavetables/factory.json';

export function decodeTable(bundle: WavetableBundle, encoded: string): WavetableFrames {
	const bin = atob(encoded);
	const { frames, points } = bundle;
	if (bin.length !== frames * points) return [];
	const out: WavetableFrames = [];
	for (let f = 0; f < frames; f++) {
		const cycle = new Float32Array(points);
		for (let i = 0; i < points; i++) {
			const byte = bin.charCodeAt(f * points + i);
			cycle[i] = (byte > 127 ? byte - 256 : byte) / 127;
		}
		out.push(cycle);
	}
	return out;
}

/**
 * The cycle at a Wave Position (0..1), blending the two rendered frames
 * either side of it. Live morphs between a table's frames as the position
 * moves, so a blend is the honest picture between two renders.
 */
export function cycleAt(frames: WavetableFrames, position: number): Float32Array | null {
	if (frames.length === 0) return null;
	const p = Math.max(0, Math.min(1, position)) * (frames.length - 1);
	const i = Math.min(frames.length - 2, Math.floor(p));
	if (i < 0) return frames[0];
	const t = p - i;
	const a = frames[i];
	const b = frames[i + 1];
	const out = new Float32Array(a.length);
	for (let k = 0; k < a.length; k++) out[k] = a[k] + (b[k] - a[k]) * t;
	return out;
}

let bundlePromise: Promise<WavetableBundle | null> | null = null;
const decoded = new Map<string, WavetableFrames>();

/** The bundle, fetched once. `null` when it can't be had (the view draws no wave). */
export function loadFactoryWavetables(fetchFn: typeof fetch = fetch): Promise<WavetableBundle | null> {
	bundlePromise ??= fetchFn(FACTORY_URL)
		.then((r) => (r.ok ? (r.json() as Promise<WavetableBundle>) : Promise.reject(new Error(`HTTP ${r.status}`))))
		.catch((err) => {
			logger.warn('wavetableShapes: factory tables unavailable', err);
			bundlePromise = null;
			return null;
		});
	return bundlePromise;
}

/** A table's frames, or `[]` when the bundle has no such table (a user table). */
export function tableFrames(bundle: WavetableBundle, category: string, table: string): WavetableFrames {
	const key = `${category}\u0000${table}`;
	let frames = decoded.get(key);
	if (!frames) {
		const encoded = bundle.tables[category]?.[table];
		frames = encoded ? decodeTable(bundle, encoded) : [];
		decoded.set(key, frames);
	}
	return frames;
}

/** For tests: forget the fetched bundle and the decoded tables. */
export function resetWavetableCache(): void {
	bundlePromise = null;
	decoded.clear();
}
