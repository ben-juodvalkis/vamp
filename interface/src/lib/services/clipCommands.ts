/**
 * clipCommands.ts — UI-initiated clip, groove and scene writes.
 *
 * The clip-side twin of `trackCommands.ts`: one named function per wire
 * write, each taking the path it writes to. Components call these rather
 * than `send` so every write the interface makes is named in `services/`
 * (the mock surface in `scripts/shot/` and the tests can see a name; they
 * cannot see a raw `send` buried in a view).
 *
 * Deliberately thin. None of these reads a store or decides which clip:
 * the caller resolves the path (`requireFocusedClip`, a gesture's held
 * path, a slot it was handed) and passes it in. The store-reading clip
 * operations (double / halve loop, reverse, sample-to-Simpler) are in
 * `clipOperations.ts`; this file stays free of its watchers and
 * preparation imports so a session-grid cell can import it cheaply.
 *
 * The clip- and scene-lifecycle helpers (`sendClipLaunch` …) predate this
 * file and live in `$lib/api/simpleClient`; they are re-exported here
 * unchanged so a component has one place to import a clip write from.
 */

import { send } from '$lib/api/simpleClient';
import {
	V3_CLIP_SET_LOOP_START_ADDRESS,
	V3_CLIP_SET_LOOP_END_ADDRESS,
	V3_CLIP_SET_WARP_MODE_ADDRESS,
	V3_CLIP_WARP_MARKER_MOVE_ADDRESS,
	V3_CLIP_WARP_MARKER_ADD_ADDRESS,
	V3_CLIP_WARP_MARKER_REMOVE_ADDRESS
} from '$lib/api/handlers/v3Clip';
import {
	V3_CLIP_GROOVE_SET_FILE_ADDRESS,
	V3_CLIP_GROOVE_SET_QUANTIZATION_AMOUNT_ADDRESS,
	V3_CLIP_GROOVE_SET_RANDOM_AMOUNT_ADDRESS,
	V3_CLIP_GROOVE_SET_TIMING_AMOUNT_ADDRESS,
	V3_CLIP_GROOVE_SET_VELOCITY_AMOUNT_ADDRESS
} from '$lib/api/handlers/v3ClipGroove';

export {
	sendClipLaunch,
	sendClipStop,
	sendClipFocus,
	sendSelectClip,
	sendClipDelete,
	sendSceneLaunch
} from '$lib/api/simpleClient';

const V3_CLIP_LOAD_FILE_ADDRESS = '/looping/v3/clip/load_file';

// ---------------------------------------------------------------------------
// Loop and warp
// ---------------------------------------------------------------------------

/**
 * Set a clip's loop start (beats). The surface also moves the start
 * marker to it, so a caller never sends the marker separately.
 */
export function setClipLoopStart(clipPath: string, beats: number): void {
	send(V3_CLIP_SET_LOOP_START_ADDRESS, [clipPath, beats]);
}

/** Set a clip's loop end (beats). */
export function setClipLoopEnd(clipPath: string, beats: number): void {
	send(V3_CLIP_SET_LOOP_END_ADDRESS, [clipPath, beats]);
}

/** Set an audio clip's warp mode (Live's `warp_mode` index). */
export function setClipWarpMode(clipPath: string, mode: number): void {
	send(V3_CLIP_SET_WARP_MODE_ADDRESS, [clipPath, mode]);
}

/** Move the warp marker at `fromBeat` by `distance` beats. */
export function moveWarpMarker(clipPath: string, fromBeat: number, distance: number): void {
	send(V3_CLIP_WARP_MARKER_MOVE_ADDRESS, [clipPath, fromBeat, distance]);
}

/** Add a warp marker pinning sample time `sec` to `beat`. */
export function addWarpMarker(clipPath: string, sec: number, beat: number): void {
	send(V3_CLIP_WARP_MARKER_ADD_ADDRESS, [clipPath, sec, beat]);
}

/** Remove the warp marker at `beat`. */
export function removeWarpMarker(clipPath: string, beat: number): void {
	send(V3_CLIP_WARP_MARKER_REMOVE_ADDRESS, [clipPath, beat]);
}

// ---------------------------------------------------------------------------
// Groove
// ---------------------------------------------------------------------------

/** Put the clip on the groove named `name` (a groove-pool name, `User: ` prefix and all). */
export function setClipGrooveFile(clipPath: string, name: string): void {
	send(V3_CLIP_GROOVE_SET_FILE_ADDRESS, [clipPath, name]);
}

/** The groove's quantization amount, 0..100. The surface assigns a groove on the first write. */
export function setClipGrooveQuantizationAmount(clipPath: string, value: number): void {
	send(V3_CLIP_GROOVE_SET_QUANTIZATION_AMOUNT_ADDRESS, [clipPath, value]);
}

/** The groove's timing amount, 0..100. */
export function setClipGrooveTimingAmount(clipPath: string, value: number): void {
	send(V3_CLIP_GROOVE_SET_TIMING_AMOUNT_ADDRESS, [clipPath, value]);
}

/** The groove's random amount, 0..100. */
export function setClipGrooveRandomAmount(clipPath: string, value: number): void {
	send(V3_CLIP_GROOVE_SET_RANDOM_AMOUNT_ADDRESS, [clipPath, value]);
}

/** The groove's velocity amount, 0..100. */
export function setClipGrooveVelocityAmount(clipPath: string, value: number): void {
	send(V3_CLIP_GROOVE_SET_VELOCITY_AMOUNT_ADDRESS, [clipPath, value]);
}

// ---------------------------------------------------------------------------
// Loading a file
// ---------------------------------------------------------------------------

/**
 * Load an audio file into a clip slot (`ClipsComponent.handle_load_file`),
 * replacing any clip there. `slotPath` `''` lets the surface pick the
 * track's first free slot. Takes any absolute path, unlike
 * `/looping/v3/device/load`'s Browser walk.
 */
export function loadFileIntoSlot(trackPath: string, slotPath: string, filePath: string): void {
	send(V3_CLIP_LOAD_FILE_ADDRESS, [trackPath, slotPath, filePath]);
}
