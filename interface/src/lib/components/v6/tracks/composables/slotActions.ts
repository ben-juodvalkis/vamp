/**
 * What a touch on a session clip cell DOES.
 *
 * Extracted from `TracksPanelV6` when the FX grid grew a mini session
 * column (`MiniSessionGrid`): the two render the same `SlotGrid`, so a
 * cell must mean the same thing in both. Left as private functions in
 * the panel, the mini view would have had to re-implement the
 * select-before-you-fire ordering and the optimistic pedal-target write
 * — and a drift there is invisible until a stomp lands on the wrong
 * slot.
 *
 * Plain functions rather than a composable: none of this holds state,
 * it only writes to stores and the wire.
 */

import {
	sendClipLaunch,
	sendClipStop,
	sendClipFocus,
	sendSelectClip
} from '$lib/services/clipCommands';
import { clipDisplayCoordinator } from '$lib/services/clipDisplayCoordinator.svelte';
import { session } from '$lib/stores/session.svelte';
import { playingClipsStore } from '$lib/stores/v6/playingClipsStore.svelte';
import { triggeredSlotsStore } from '$lib/stores/v6/triggeredSlotsStore.svelte';
import type { SlotState } from '$lib/stores/v3/normalized.svelte';
import { selectTrackByIndex, interceptForGroupGesture } from './useTrackData.svelte.js';

export interface SlotActionOptions {
	/** Forwarded to `selectTrackByIndex` — the panel logs through it. */
	onTrackSelect?: (trackIndex: number) => void;
}

/**
 * Tapping a cell's BODY selects it and fires nothing.
 *
 * `selected_clip` writes Live's `highlighted_clip_slot`, which is the
 * exact property `FootTriggerComponent` reads — so touching a cell aims
 * the foot pedal at it, and the pedal is what plays. Selecting the
 * track too is not decoration: the highlight is the intersection of the
 * selected track and the selected scene, so moving only the scene would
 * leave the pedal pointed at another track's slot in that row. The two
 * writes together are the whole cursor.
 *
 * Both halves paint before the wire answers. `selectTrackByIndex` has
 * always been optimistic; the scene matches it, so the pedal-target
 * ring lands under the finger instead of a WiFi round trip later.
 * Live's echo carries the same values and simply re-lands on them — or
 * overrides, if it disagrees.
 */
export function selectSlot(
	trackIndex: number,
	slotIndex: number,
	options?: SlotActionOptions
): void {
	// A group gesture is active: this cell's track gets toggled into the
	// group, same as a strip tap — never the scene/pedal-aim writes below,
	// which have nothing to do with a track that is about to be grouped.
	if (interceptForGroupGesture(trackIndex)) return;
	session.selectSceneOptimistically(slotIndex);
	sendSelectClip(`tracks/${trackIndex}`, slotIndex);
	selectTrackByIndex(trackIndex, {
		showInstrumentView: false,
		onTrackSelect: options?.onTrackSelect
	});
}

/**
 * The action strip — the only part of a cell that acts. What it does
 * depends on what is in the slot, and the UI can decide that itself:
 * the cell is already painting that state, and both wires it needs
 * already exist. So there is no per-slot action address on the wire and
 * nothing to keep in step with the pedal's own branch.
 *
 *   empty / stopped  → launch  (an empty slot on an armed track
 *                               records — that IS the capture gesture)
 *   recording        → launch  (fires a recording session clip, which
 *                               ends the take and loops it — the
 *                               looper's "close the loop", where a stop
 *                               would end it without looping)
 *   playing          → launch  (re-fires it from the top on the next
 *                               quantize boundary; stopping a track is
 *                               the stop cell's job)
 *
 * It selects first, for the same reason the body tap does: firing a
 * slot the pedal is not aimed at would leave the next stomp acting
 * somewhere else entirely.
 */
export function actOnSlot(
	trackIndex: number,
	slotIndex: number,
	slotPath: string,
	slotState: SlotState,
	options?: SlotActionOptions
): void {
	// A group gesture is active: toggle the track, launch or stop nothing.
	// `selectSlot` below has the same guard, but it only stops ITS OWN
	// writes — this still needs its own check, or a tap on the action
	// strip would fire a clip while the performer is only trying to group.
	if (interceptForGroupGesture(trackIndex)) return;
	selectSlot(trackIndex, slotIndex, options);
	sendClipLaunch(slotPath);
	// Start the queued pulse on the gesture, not on the answer.
	// Everything that confirms a launch is remote — the wire, the LOM
	// listener, the transport boundary — and at 1-bar quantization the
	// clip itself is up to a bar away. The mark self-expires and the
	// surface's own `is_triggered` edges supersede it, so this is a head
	// start, not a second source of truth.
	triggeredSlotsStore.markPending(slotPath);
}

/**
 * Long press on a cell: show the clip, don't play it. Focus is
 * surface-owned (`song.view.detail_clip` — the property, note and
 * groove channels all emit for the focused clip only), so the gesture
 * writes it over the wire and the clip view repaints when
 * `clip/focused` echoes back. What IS local is the view switch: the
 * central view is pointed at the clip view immediately, because a hold
 * that opens nothing reads as a gesture that missed.
 */
export function focusSlot(
	trackIndex: number,
	slotPath: string,
	options?: SlotActionOptions
): void {
	// A group gesture is active: toggle the track, don't focus a clip or
	// switch the central view — exactly the side effects grouping needs to
	// bypass.
	if (interceptForGroupGesture(trackIndex)) return;
	sendClipFocus(slotPath);
	selectTrackByIndex(trackIndex, {
		showInstrumentView: false,
		onTrackSelect: options?.onTrackSelect
	});
	clipDisplayCoordinator.showCurrentClip();
}

/**
 * Per-track stop (ADR-415 left the wire done and the cell undone).
 * Selects nothing: stopping a track you are not looking at is a
 * performance move of its own, and moving the selection with it would
 * drag the central view and the FX grid along.
 */
export function stopTrack(trackIndex: number): void {
	sendClipStop(`tracks/${trackIndex}`);
}

/**
 * The clip the sidebar's clip controls act on when nothing is focused.
 *
 * `VerticalQuantizeControl` and `VerticalLoopControl` are focus-scoped:
 * every channel they read (properties, groove) only emits for
 * `song.view.detail_clip`, and every write they make is keyed on
 * `session.focusedClipPath`. With no focused clip both were dead under
 * the finger — the brace drew an empty well and the Q slider moved and
 * wrote nothing at all.
 *
 * The fallback is the clip RUNNING on the selected track, not the
 * highlighted slot: the highlight is the intersection of selected track
 * and selected scene, so on a set where each track's loop lives in a
 * different scene it points at an empty slot of the track you just
 * picked. The running clip is the one the performer is already looking
 * at. Same rule `selectTrackByIndex`'s `aimAtPlayingClip` uses, and the
 * same live channel (`playing_slot` + its status) rather than the
 * `state/full` snapshot, which a clip launched since the last one is
 * not in.
 *
 * Returns the resolved `clipPath` (the address the control writes to),
 * or null when there is nothing to act on — no selected track, or that
 * track is not playing or recording anything.
 *
 * Focusing through the fallback shows the clip view, unless `showClip` is
 * false: the Q slider and the Groove view keep the Groove view up.
 */
export function focusPlayingClipOnSelectedTrack({ showClip = true }: { showClip?: boolean } = {}): string | null {
	const focused = session.focusedClipPath;
	if (focused) return focused;

	const trackIndex = session.selectedTrackIndex;
	if (trackIndex < 0) return null;
	const trackPath = `tracks/${trackIndex}`;

	const entry = playingClipsStore.get(trackPath);
	if (!entry || entry.slotIdx < 0) return null;
	// 1 = playing, 2 = recording. A take in progress counts: it is the
	// clip the performer is working on. A stopped entry lingers in the
	// store, so the status is what makes this "is playing".
	const status = playingClipsStore.liveStatus(trackPath);
	if (status !== 1 && status !== 2) return null;

	const slotPath = `${trackPath}/slots/${entry.slotIdx}`;
	// Focus is surface-owned, so this is a real write; the property and
	// groove channels answer on `clip/focused` and the controls come
	// alive when it lands. The scene moves optimistically so the grid's
	// pedal-target ring lands under the gesture rather than a round trip
	// later — `clip/focus` writes the highlight too, and its echo either
	// confirms this or overrides it.
	session.selectSceneOptimistically(entry.slotIdx);
	sendClipFocus(slotPath);
	if (showClip) clipDisplayCoordinator.showCurrentClip();

	return `${slotPath}/clip`;
}
