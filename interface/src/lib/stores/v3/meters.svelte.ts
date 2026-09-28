/**
 * PR-5c — v3 output meter store.
 *
 * Meters land on their own module, separate from `normalized.svelte.ts`,
 * because they fire at ~30 Hz (design §3.1/§3.6). Putting them on
 * `TrackRecord` would mean every consumer reading any scalar on a
 * TrackRecord (name, color, devices, slots) re-derives at audio rates.
 * The per-PR rule from PR-5b — one primitive per trackRef family —
 * applies here as `applyMeterUpdate`.
 *
 * Wire:
 *   /looping/v3/track/meter  [trackPath:string, left:float, right:float]
 *   /looping/v3/master/meter [left:float, right:float]
 *
 * Store shape: one SvelteMap keyed by path (`"tracks/<N>"` or
 * `"master"`), values `{ left, right }`. SvelteMap so `.set()` is
 * fine-grained-reactive — only consumers of the specific path re-run.
 *
 * No cold-read path. Per design §3.4, meters are implicitly continuous
 * and the first listener fire after init serves as the cold-read.
 * Idle tracks report 0 until MetersComponent's `_emit_initial_values`
 * lands at startup, which is the single seed emit.
 */

import { SvelteMap } from 'svelte/reactivity';

export interface MeterRecord {
	/** ``output_meter_left`` — 0.0…1.0. */
	left: number;
	/** ``output_meter_right`` — 0.0…1.0. */
	right: number;
}

/** Module-local reactive state. Keyed by `tracks/<N>` or the literal
 *  `master`. No entry until the first meter fire lands. */
const meters = new SvelteMap<string, MeterRecord>();

/** Public read-only accessor. Consumers derive via
 *  `$derived(meterStore.get('tracks/0')?.left ?? 0)`. */
export const meterStore = {
	get(path: string): MeterRecord | undefined {
		return meters.get(path);
	},
	/** Exposed for test observability. Do not mutate from app code. */
	size(): number {
		return meters.size;
	}
};

/** Write a single track's L/R into the store. Use for
 *  `/looping/v3/track/meter` — `trackPath` must start with `tracks/`.
 *  Silently drops master / returns paths. */
export function applyTrackMeter(
	trackPath: string,
	left: number,
	right: number
): boolean {
	if (!trackPath.startsWith('tracks/')) return false;
	meters.set(trackPath, { left, right });
	return true;
}

/** Write the master L/R into the store under the literal key `master`.
 *  Use for `/looping/v3/master/meter`. */
export function applyMasterMeter(left: number, right: number): void {
	meters.set('master', { left, right });
}

/** Test-only reset. Clears the meter map back to empty. */
export function __resetMeterStoreForTests(): void {
	meters.clear();
}
