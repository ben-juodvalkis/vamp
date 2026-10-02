/**
 * Slot-cell state derivation for the session grid (ADR-415).
 *
 * A cell has two sources of truth and they can disagree:
 *
 *  - the **S record** in the v3 normalized store, which is a snapshot
 *    from the last `state/full` ride
 *  - **`playingClipsStore`**, which is live — the `playing_slot` wire
 *    plus a 30 Hz playhead, so it knows what is playing or recording
 *    right now
 *
 * The live channel only ever speaks about the ONE slot each track is
 * currently playing, so it can't be used alone. This resolves the two
 * into what a cell should paint.
 *
 * Extracted as a pure function rather than living inline in SlotGrid so
 * the resolution rules — especially the stale-snapshot rule, which is
 * the one that goes wrong invisibly — are directly testable.
 */

import type { SlotState } from '$lib/stores/v3/normalized.svelte';

/** The live channel's view of a track: which slot, and doing what. */
export interface LiveSlotStatus {
	/** Slot index the track is on, or -1 for none. */
	slotIdx: number;
	/** 0 stopped, 1 playing, 2 recording. */
	status: number;
}

/**
 * Resolve what a cell paints.
 *
 * @param base       state from the S record, or undefined for a slot the
 *                   snapshot doesn't mention (treated as empty)
 * @param live       the track's live entry, or undefined before the first
 *                   `playing_slot` lands
 * @param slotIndex  which slot this cell is
 */
export function deriveSlotCellState(
	base: SlotState | undefined,
	live: LiveSlotStatus | undefined,
	slotIndex: number
): SlotState {
	// The live channel wins, but only for the slot it is actually about.
	if (live && live.slotIdx === slotIndex) {
		if (live.status === 2) return 'recording';
		if (live.status === 1) return 'playing';
	}

	const resolved = base ?? 'empty';

	// A transport state from an older snapshot must not outlive the live
	// channel's silence about this slot. Without this, a clip that was
	// playing at the last `state/full` would paint as playing forever
	// after it stopped — the S record is not re-emitted on stop.
	if (resolved === 'playing' || resolved === 'recording') return 'has_clip';

	return resolved;
}

/**
 * The mark the action strip shows — what a press on it will DO.
 *
 *   empty + canRecord   ●  record a take here (the track is armed)
 *   empty               –  `fire()` on an empty slot of an unarmed track
 *                          records nothing, and a red dot there promised
 *                          a take the press could not deliver
 *   playing             ▶  re-fire (the stop cell below the column stops)
 *   has_clip            ▶  play
 *   recording           ▶  end the take and loop it (NOT ■ — firing a
 *                          recording session clip is how a looper closes
 *                          a take and keeps it)
 *
 * Pure, so the rule is testable without a layout — the same reason the
 * strip's geometry lives in `slotActionZone`.
 *
 * @param slotState  what the cell is painting
 * @param canRecord  the track is armed (literally — Auto-Arm arming it
 *                   on the way past is not a state the grid reports)
 */
export function slotActionGlyph(slotState: SlotState, canRecord: boolean): string {
	if (slotState === 'empty') return canRecord ? '\u25cf' : '\u2013';
	return '\u25b6';
}
