/**
 * v3 has-arrangement-clips handler (PR-7c pr7c-5, 2026-04-19).
 *
 * Consumes the focused `/looping/v3/track/has_arrangement_clips`
 * arrival emitted by `TrackMetadataComponent.arrangement_clips`
 * listener on the Python Control Surface (pr7c-2 shipped the emit).
 * Wire: `[trackPath:string, flag:int(0|1)]`.
 *
 * The cold-start value already rides the T-record at arity-9 offset
 * 8 (pr7c-3); this handler is for the subsequent add/remove fires
 * that tell the UI "arrangement just gained / lost its last clip on
 * this track". Writes through `applyHasArrangementClips`, which:
 *
 *   - silently no-ops for master / returns / unknown paths (same
 *     drop-on-missing discipline as `applyTrackMetadata`),
 *   - does NOT advance a UI-side generation — per rule #3 (trust the
 *     echo) the Python surface already advanced on its side and the
 *     re-emitted state/full will sync the T-record without disturbing
 *     nested Map identity.
 *
 * No inbound write leg: arrangement-clip presence is LOM-derived,
 * not UI-commandable. A track gains arrangement clips only by the
 * user dragging/recording into the arrangement view — both routes
 * are Live-internal.
 *
 * @see Looping's documentation/archive/m4l-to-python-v3/04-wire-protocol.md §3.3
 * @see Looping's documentation/archive/m4l-to-python-v3/phase-7-pr7c-design.md
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import { applyHasArrangementClips } from '$lib/stores/v3/normalized.svelte';

export const V3_TRACK_HAS_ARRANGEMENT_CLIPS_ADDRESS =
	'/looping/v3/track/has_arrangement_clips';

export function handleV3HasArrangementClips(args: OSCArg[]): void {
	if (args.length < 2) {
		logger.warn('v3 has_arrangement_clips missing args', { args });
		return;
	}
	const trackPath = typeof args[0] === 'string' ? args[0] : String(args[0]);
	const flag = toBool(args[1]);
	applyHasArrangementClips(trackPath, flag);
}

function toBool(v: OSCArg): boolean {
	if (typeof v === 'boolean') return v;
	if (typeof v === 'number') return v !== 0;
	if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
	return Boolean(v);
}
