/**
 * v3 selected-track handler (PR-7d pr7d-6, 2026-04-19).
 *
 * Consumes `/looping/v3/selected_track [trackPath:string]` from the
 * Python Control Surface's `SelectedTrackComponent`. Parses the
 * canonical path and updates `selectedTrackStore._trackIndex` via
 * the narrow writer `handleTrackSelected`.
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
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { handleSessionUpdate } from '$lib/stores/session.svelte';

export const V3_SELECTED_TRACK_ADDRESS = '/looping/v3/selected_track';

export function handleV3SelectedTrack(args: OSCArg[]): void {
	if (args.length < 1) {
		logger.warn('v3 selected_track missing trackPath', { args });
		return;
	}

	const trackPath = typeof args[0] === 'string' ? args[0] : String(args[0]);
	const trackIndex = parseTrackPath(trackPath);
	if (trackIndex === null) {
		logger.debug('v3 selected_track ignored for unknown path shape', {
			trackPath
		});
		return;
	}

	selectedTrackStore.handleTrackSelected(trackIndex);
	handleSessionUpdate({
		type: 'track-selection',
		trackIndex,
		timestamp: Date.now()
	});
}

/**
 * Map a canonical v3 trackPath to the numeric index
 * `selectedTrackStore` uses internally. Returns `null` for shapes
 * the UI doesn't yet represent (returns tracks, any other string).
 */
function parseTrackPath(trackPath: string): number | null {
	if (trackPath === 'master') return -1;
	if (trackPath.startsWith('tracks/')) {
		const n = Number(trackPath.slice('tracks/'.length));
		return Number.isInteger(n) && n >= 0 ? n : null;
	}
	return null;
}
