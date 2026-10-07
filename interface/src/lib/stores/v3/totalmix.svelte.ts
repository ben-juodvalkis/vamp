/**
 * TotalMix monitor-level store.
 *
 * Mirrors the meter store pattern (see `meters.svelte.ts`): a single
 * SvelteMap keyed by channel name, values are levels in **dB**.
 * SvelteMap so `.set()` is fine-grained-reactive — only consumers of the
 * specific channel re-run.
 *
 * These values ORIGINATE in the RME mixer and reach us via the bridge,
 * which owns the UDP conversation with TotalMix and filters its state
 * dump down to these five channels (ADR-423). dB is the unit the whole
 * path speaks — mixer, bridge, `live.gain~` in the Max for Live device,
 * and this store — so nothing converts on the way. The 0..1 a drawn
 * fader needs is a rendering concern and lives in `totalmixScale.ts`.
 *
 * Wire:
 *   /looping/v3/totalmix/<channel>  [db:float]
 * where <channel> ∈ { room, playback, click, phones, main }. Writes go
 * back out on `/totalmix/<channel>` with the same unit; `main` is
 * read-only.
 *
 * Superseded ADR-388, which had these values coming from the standalone
 * Max Utility patch as 0..1 with no write-back path.
 */

import { SvelteMap } from 'svelte/reactivity';

/** Channels the bridge reports. Keep in sync with
 *  `osc.totalmix.channels` in config/constants.json. */
export const TOTALMIX_CHANNELS = ['room', 'playback', 'click', 'phones', 'main'] as const;
export type TotalMixChannel = (typeof TOTALMIX_CHANNELS)[number];

/** Module-local reactive state. Keyed by channel name. No entry until
 *  the first fire for that channel lands. */
const levels = new SvelteMap<string, number>();

/** Public read-only accessor. Returns dB, or undefined until the first
 *  fire for that channel lands. Consumers derive via
 *  `$derived(totalmixStore.get('room'))` and treat undefined as "unknown"
 *  rather than substituting a level. */
export const totalmixStore = {
	get(channel: string): number | undefined {
		return levels.get(channel);
	},
	/** Exposed for test observability. Do not mutate from app code. */
	size(): number {
		return levels.size;
	}
};

/** Write a single channel's level (dB) into the store. */
export function applyTotalMix(channel: string, db: number): void {
	levels.set(channel, db);
}

/** Live signal meters, dB per channel, from `/looping/v3/totalmix_meters`
 *  (one frame of five, in `TOTALMIX_CHANNELS` order, at up to 30 fps).
 *  Separate from `levels`: a fader's position and the signal through it are
 *  different readings of the same channel. `-300` is silence. */
const meters = new SvelteMap<string, number>();

export const totalmixMeters = {
	get(channel: string): number | undefined {
		return meters.get(channel);
	}
};

/** Write one meter frame. Only a changed value is set, so a channel that
 *  holds still re-renders nothing. */
export function applyTotalMixMeters(frame: number[]): void {
	TOTALMIX_CHANNELS.forEach((channel, i) => {
		const db = frame[i];
		if (typeof db === 'number' && Number.isFinite(db) && meters.get(channel) !== db) {
			meters.set(channel, db);
		}
	});
}

/** Test-only reset. Clears both maps back to empty. */
export function __resetTotalMixStoreForTests(): void {
	levels.clear();
	meters.clear();
}
