/**
 * v3 Permute step-position telemetry store.
 *
 * Wire:
 *   /looping/v3/permute/step [devicePath:string, kind:"mute"|"pitch", step:int]
 *
 * Lives on its own module next to `meters.svelte.ts`, for the same reason
 * meters do: this is high-rate ephemeral telemetry (~10 Hz per sequencer,
 * per device) and it must not sit on a `DeviceRecord`, or every consumer
 * reading any device scalar would re-derive at step rate.
 *
 * Why not `paramByPath`
 * --------------------
 *
 * Permute exposes step position as two `live.numbox` parameters ("Mute
 * Current"/"Pitch Current", indices 23/24) purely so external tools can
 * read it. Live never fires value-changed notifications for them (they use
 * 12.3's "Visible (Not Stored)" mode), so they arrive frozen via the normal
 * parameter path — that's the bug this wire exists to route around.
 *
 * Reading them back off `paramByPath` anyway would re-import every
 * fragility of Permute's parameter layout: a verified off-by-two index
 * shift, a name collision (Permute reports *both* current-step params as
 * "Mute Current", so name-matching collapses mute and pitch onto one
 * index), and a 1-indexing offset inherited from a `+1` box in the Max
 * display chain. Step position is telemetry — read-only, ephemeral,
 * meaningless when stopped, never persisted or automated — so it follows
 * the playhead/meter lane instead. Permute's parameter layout is now
 * irrelevant to it.
 *
 * Permute's *real* parameters (`Mute 1..8`, `Pitch 1..8`, Lengths, Rates,
 * Chance, Temperature) are user-settable, automatable and persisted, Live
 * notifies on them correctly, and they keep riding `paramByPath` via the
 * generic listener. This store is only for the two step positions.
 *
 * Step domain: `0..7` while running, `-1` when idle/stopped. Carried raw
 * off the wire — no offset applied here or on the surface.
 *
 * No cold-read path: like meters, the next step change (~100 ms) is the
 * seed. A device with no entry yet reads as idle.
 */

import { SvelteMap } from 'svelte/reactivity';

export type PermuteStepKind = 'mute' | 'pitch';

export interface PermuteStepRecord {
	/** Current mute-sequencer step, 0..7; -1 when idle/stopped. */
	mute: number;
	/** Current pitch-sequencer step, 0..7; -1 when idle/stopped. */
	pitch: number;
}

const IDLE: PermuteStepRecord = { mute: -1, pitch: -1 };

/** Module-local reactive state, keyed by `tracks/<N>/devices/<M>`. No
 *  entry until the first step fire lands for that device. SvelteMap so
 *  `.set()` is fine-grained — only consumers of that devicePath re-run. */
const steps = new SvelteMap<string, PermuteStepRecord>();

export const permuteStepStore = {
	/** Current steps for a device. Returns an idle record for a device
	 *  we've heard nothing from, so consumers never branch on undefined. */
	get(devicePath: string): PermuteStepRecord {
		return steps.get(devicePath) ?? IDLE;
	},
	/** Exposed for test observability. Do not mutate from app code. */
	size(): number {
		return steps.size;
	}
};

/** Write one sequencer's step for one device. Other kind is preserved. */
export function applyPermuteStep(
	devicePath: string,
	kind: PermuteStepKind,
	step: number
): boolean {
	if (!devicePath) return false;
	if (kind !== 'mute' && kind !== 'pitch') return false;
	const prev = steps.get(devicePath) ?? IDLE;
	steps.set(devicePath, { ...prev, [kind]: step });
	return true;
}

/** Drop all telemetry. Fired on `bridge-resync`: after a reconnect the
 *  held values are stale by an unknown margin, and reading idle for one
 *  step beats painting a wrong step — the next fire re-seeds within
 *  ~100 ms of playback. */
export function clearPermuteSteps(): void {
	steps.clear();
}

// Bridge-resync clears entries so a reconnect doesn't leave a frozen step
// lit until the next fire. Same shape playingClipsStore/meters use (idle
// until first fire). Guarded for SSR.
if (typeof window !== 'undefined') {
	window.addEventListener('bridge-resync', () => {
		steps.clear();
	});
}

/** Test-only reset. */
export function __resetPermuteStepStoreForTests(): void {
	steps.clear();
}
