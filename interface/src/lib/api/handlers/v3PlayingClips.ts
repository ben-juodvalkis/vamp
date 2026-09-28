/**
 * v3 Playing-clips handler — ADR-360.
 *
 * Consumes:
 *   /looping/v3/track/playing_slot
 *     [trackPath, slotIdx, isAudioClip, filePath, lengthBeats,
 *      loopStartBeats, loopEndBeats, looping, status,
 *      fileStartBeats?, fileEndBeats?]
 *   (the file span is trailing and optional: a surface from before it
 *   sends nine args, and the span then reads as unknown)
 *   /looping/v3/track/playhead
 *     [trackPath, slotIdx, positionBeats, status]
 *   /looping/v3/clip/notes/changed
 *     [trackPath, clipPath]
 *
 * `playhead` ships `clip.playing_position` directly (no client-side
 * extrapolation); both addresses update `playingClipsStore`.
 *
 * The notes-changed channel is routed through `clipNotesService` so the
 * request/response model for notes/get can deduplicate inflight
 * requests.
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import { applyPlayingSlot, applyPlayhead } from '$lib/stores/v6/playingClipsStore.svelte';
import { handleClipNotesChanged } from '$lib/services/clipNotesService';
import { triggeredSlotsStore } from '$lib/stores/v6/triggeredSlotsStore.svelte';
import { toNumber, toString } from './oscTypeHelpers';

export const V3_TRACK_PLAYING_SLOT_ADDRESS = '/looping/v3/track/playing_slot';
export const V3_TRACK_PLAYHEAD_ADDRESS = '/looping/v3/track/playhead';
export const V3_CLIP_NOTES_CHANGED_ADDRESS = '/looping/v3/clip/notes/changed';

export function isV3PlayingClipsAddress(address: string): boolean {
	return (
		address === V3_TRACK_PLAYING_SLOT_ADDRESS ||
		address === V3_TRACK_PLAYHEAD_ADDRESS ||
		address === V3_CLIP_NOTES_CHANGED_ADDRESS
	);
}

export function handleV3PlayingClips(address: string, args: OSCArg[]): void {
	if (address === V3_TRACK_PLAYING_SLOT_ADDRESS) {
		if (args.length < 9) {
			logger.warn('v3 playing_slot wrong arity', { args });
			return;
		}
		// A slot that is now playing or recording is no longer queued.
		// Clearing here rather than in the grid means the pulse ends on
		// the very message that repaints the cell as playing — one
		// event, one visual change, no window where a cell is both.
		const playingTrackPath = toString(args[0]);
		const playingSlotIdx = toNumber(args[1]) | 0;
		if ((toNumber(args[8]) | 0) > 0 && playingSlotIdx >= 0) {
			triggeredSlotsStore.resolve(`${playingTrackPath}/slots/${playingSlotIdx}`);
		}
		applyPlayingSlot({
			trackPath: toString(args[0]),
			slotIdx: toNumber(args[1]) | 0,
			isAudioClip: toNumber(args[2]) === 1,
			filePath: toString(args[3]),
			lengthBeats: toNumber(args[4]),
			loopStartBeats: toNumber(args[5]),
			loopEndBeats: toNumber(args[6]),
			looping: toNumber(args[7]) === 1,
			status: toNumber(args[8]) | 0,
			fileStartBeats: args.length > 10 ? toNumber(args[9]) : 0,
			fileEndBeats: args.length > 10 ? toNumber(args[10]) : 0
		});
		return;
	}

	if (address === V3_TRACK_PLAYHEAD_ADDRESS) {
		if (args.length < 4) {
			logger.warn('v3 playhead wrong arity', { args });
			return;
		}
		applyPlayhead({
			trackPath: toString(args[0]),
			slotIdx: toNumber(args[1]) | 0,
			positionBeats: toNumber(args[2]),
			status: toNumber(args[3]) | 0
		});
		return;
	}

	if (address === V3_CLIP_NOTES_CHANGED_ADDRESS) {
		if (args.length < 2) {
			logger.warn('v3 clip notes/changed wrong arity', { args });
			return;
		}
		handleClipNotesChanged(toString(args[0]), toString(args[1]));
		return;
	}
}
