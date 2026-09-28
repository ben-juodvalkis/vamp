/**
 * v3 group-track fold-state handler (ADR-410, 2026-07-27).
 *
 * Consumes `/looping/v3/track/fold_state [trackPath:string,
 * foldState:int(0|1)]` from `TrackMetadataComponent` on the Python
 * Control Surface.
 *
 * The cold-start value rides the T-record (arity 13, offset 11). This
 * handler carries the subsequent flips, from two sources that look
 * identical on the wire:
 *
 *   1. **Live-side folds.** The user clicks the fold triangle in
 *      Live's own track header. `Track` exposes no
 *      `add_fold_state_listener` and no `add_is_visible_listener`
 *      (verified against Live 12.4.5b8), so the surface can't watch
 *      the track — it listens on song-scoped `Song.visible_tracks`,
 *      which a fold does change, and diffs the foldable tracks.
 *   2. **Our own writes.** The write-path echo of
 *      `/looping/v3/track/set/fold_state`, because there's no listener
 *      to produce one (same shape `Groove.base` needs).
 *
 * Deliberately no generation advance and no state/full republish: a
 * fold adds, removes, and reorders nothing, so the tree is unchanged.
 * The UI recomputes which strips are hidden from the group tree it
 * already holds (`$lib/utils/trackGroups`), which is why one flag flip
 * updates every descendant at any nesting depth for two OSC args.
 *
 * @see docs/reference/wire-protocol.md §2.5
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import { applyTrackFoldState } from '$lib/stores/v3/normalized.svelte';

export const V3_TRACK_FOLD_STATE_ADDRESS = '/looping/v3/track/fold_state';

export function handleV3TrackFoldState(args: OSCArg[]): void {
	if (args.length < 2) {
		logger.warn('v3 track fold_state missing args', { args });
		return;
	}
	const trackPath = typeof args[0] === 'string' ? args[0] : String(args[0]);
	applyTrackFoldState(trackPath, toBool(args[1]));
}

function toBool(v: OSCArg): boolean {
	if (typeof v === 'boolean') return v;
	if (typeof v === 'number') return v !== 0;
	if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
	return Boolean(v);
}
