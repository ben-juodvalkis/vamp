/**
 * v3 selected-track handler (PR-7d pr7d-6, 2026-04-19).
 *
 * Consumes `/looping/v3/selected_track [trackPath:string]` from the
 * Python Control Surface's `SelectedTrackComponent`, parses the
 * canonical path and hands the index to the session store's
 * `handleTrackSelectionUpdate` — the one owner of the selected track.
 * It drops a stale echo while an optimistic selection is in flight and
 * runs the track-change side effects (FX grid reset, param arms, the
 * `track-changed` event) once, on a real change.
 *
 * Path mapping:
 *
 *   "tracks/<N>" → N
 *   "master"     → -1
 *
 * Returns / unknown path shapes log at debug and skip — the surface
 * itself suppresses the emit for return-track selection (design §4.2
 * / Q1), so a `returns/<N>` arrival here would be a bug in the
 * surface, not routine.
 *
 * @see Looping's documentation/archive/m4l-to-python-v3/phase-7-pr7d-design.md
 * @see surface/components/SelectedTrackComponent.py
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import { handleTrackSelectionUpdate } from '$lib/stores/session.svelte';
import { trackIndexOf } from '$lib/utils/livePaths';

export const V3_SELECTED_TRACK_ADDRESS = '/looping/v3/selected_track';

export function handleV3SelectedTrack(args: OSCArg[]): void {
	if (args.length < 1) {
		logger.warn('v3 selected_track missing trackPath', { args });
		return;
	}

	const trackPath = typeof args[0] === 'string' ? args[0] : String(args[0]);
	const trackIndex = trackIndexOf(trackPath);
	if (trackIndex === null) {
		logger.debug('v3 selected_track ignored for unknown path shape', {
			trackPath
		});
		return;
	}

	handleTrackSelectionUpdate(trackIndex);
}
