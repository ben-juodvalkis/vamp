/**
 * sessionCommands.ts — UI-initiated writes to the Live set as a whole:
 * transport, tempo, time signature, launch quantization, the key, and
 * the surface's own session switches.
 *
 * The session-side twin of `trackCommands.ts`: one named function per
 * write, so components never hand-roll an address. Where the UI paints a
 * value before Live echoes it (tempo, metronome, transport, launch
 * quantization) the command makes the optimistic apply and the send
 * together, in that order, as `trackCommands` pairs `applyTrackMetadata`
 * with its send — two views that both write tempo cannot drift apart on
 * whether the digit moves under the finger.
 *
 * The rest are **echo-confirmed**, deliberately: Follow Key, the scale
 * writes and the Settings switches are surface-side state, and a write
 * sent mid-set-load reaches no surface. An optimistic flip there would
 * leave a button lying about a behavior that did not change.
 *
 * Writes that several values make together (a key pick: root, scale,
 * mode) are one synchronous function, so the outbound batcher sends
 * them as one frame and Live never sees half a key.
 */

import { send } from '$lib/api/simpleClient';
import {
	V3_SESSION_AUTO_ARM_ADDRESS,
	V3_SESSION_AUTO_CAPTURE_ADDRESS,
	V3_SESSION_CLIP_TRIGGER_QUANT_ADDRESS,
	V3_SESSION_FOOT_SWITCH_ENABLED_ADDRESS,
	V3_SESSION_FOOT_SWITCH_LEARN_ADDRESS,
	V3_SESSION_KEY_FOLLOW_ADDRESS,
	V3_SESSION_METRONOME_ADDRESS,
	V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS,
	V3_SESSION_PLAY_CMD_ADDRESS,
	V3_SESSION_SCALE_DETECT_ADDRESS,
	V3_SESSION_SCALE_MODE_ADDRESS,
	V3_SESSION_SCALE_NAME_ADDRESS,
	V3_SESSION_SCALE_ROOT_ADDRESS,
	V3_SESSION_SIGNATURE_DEN_ADDRESS,
	V3_SESSION_SIGNATURE_NUM_ADDRESS,
	V3_SESSION_STOP_CMD_ADDRESS
} from '$lib/api/handlers/v3Session';
import { session } from '$lib/stores/session.svelte';

/** Tempo still rides AbletonOSC's address, not a `/looping/v3/session/*` one. */
const LIVE_SONG_SET_TEMPO_ADDRESS = '/live/song/set/tempo';

// ---------------------------------------------------------------------------
// Transport (optimistic)
// ---------------------------------------------------------------------------

/** Start the transport if it is stopped, stop it if it is playing. */
export function toggleTransport(): void {
	const address = session.isPlaying ? V3_SESSION_STOP_CMD_ADDRESS : V3_SESSION_PLAY_CMD_ADDRESS;
	session.toggleTransportOptimistically();
	send(address, []);
}

/** Flip the metronome. */
export function toggleMetronome(): void {
	const newState = session.metronome ? 0 : 1;
	session.toggleMetronomeOptimistically();
	send(V3_SESSION_METRONOME_ADDRESS, [newState]);
}

/** Set the tempo in BPM. The caller clamps and rounds; this sends what it is given. */
export function setTempo(bpm: number): void {
	session.setTempoOptimistically(bpm);
	send(LIVE_SONG_SET_TEMPO_ADDRESS, [bpm]);
}

/** Set Live's global clip-trigger quantization (`LAUNCH_QUANTIZATIONS` value). */
export function setClipTriggerQuantization(value: number): void {
	session.setClipTriggerQuantizationOptimistically(value);
	send(V3_SESSION_CLIP_TRIGGER_QUANT_ADDRESS, [value]);
}

// ---------------------------------------------------------------------------
// Time signature (echo-confirmed)
// ---------------------------------------------------------------------------

export function setSignatureNumerator(numerator: number): void {
	send(V3_SESSION_SIGNATURE_NUM_ADDRESS, [numerator]);
}

export function setSignatureDenominator(denominator: number): void {
	send(V3_SESSION_SIGNATURE_DEN_ADDRESS, [denominator]);
}

// ---------------------------------------------------------------------------
// Key (echo-confirmed)
// ---------------------------------------------------------------------------
// A key picked by hand is a key to keep (ADR-447): the surface turns
// Follow off itself when a `scale_root` / `scale_name` write arrives.

/** Pick the root note (0 = C) and turn scale mode on. */
export function pickRootNote(index: number): void {
	send(V3_SESSION_SCALE_ROOT_ADDRESS, [index]);
	send(V3_SESSION_SCALE_MODE_ADDRESS, [1]);
}

/** Pick the scale by name and turn scale mode on. */
export function pickScaleName(scaleName: string): void {
	send(V3_SESSION_SCALE_NAME_ADDRESS, [scaleName]);
	send(V3_SESSION_SCALE_MODE_ADDRESS, [1]);
}

/** Pick root and scale together (the runner-up chip): one write each, one mode. */
export function pickKey(root: number, scaleName: string): void {
	send(V3_SESSION_SCALE_ROOT_ADDRESS, [root]);
	send(V3_SESSION_SCALE_NAME_ADDRESS, [scaleName]);
	send(V3_SESSION_SCALE_MODE_ADDRESS, [1]);
}

/**
 * Ask the surface for the key of what is launched, and set it (ADR-446).
 * The answer lands in `session.scaleDetected`.
 */
export function detectKey(): void {
	send(V3_SESSION_SCALE_DETECT_ADDRESS, [1]);
}

/** Follow Key on or off. Turning it on makes the surface detect at once. */
export function setKeyFollow(on: boolean): void {
	send(V3_SESSION_KEY_FOLLOW_ADDRESS, [on ? 1 : 0]);
}

// ---------------------------------------------------------------------------
// Settings switches (echo-confirmed)
// ---------------------------------------------------------------------------

export function setAutoArm(on: boolean): void {
	send(V3_SESSION_AUTO_ARM_ADDRESS, [on ? 1 : 0]);
}

export function setAutoCapture(on: boolean): void {
	send(V3_SESSION_AUTO_CAPTURE_ADDRESS, [on ? 1 : 0]);
}

/** Ableton Move's knobs set the selected track's volume (owner rig: needs the Max patch). */
export function setMoveVolumeKnob(on: boolean): void {
	send(V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS, [on ? 1 : 0]);
}

export function setFootSwitchEnabled(on: boolean): void {
	send(V3_SESSION_FOOT_SWITCH_ENABLED_ADDRESS, [on ? 1 : 0]);
}

/** Start (true) or cancel (false) learning the foot switch's CC. */
export function setFootSwitchLearn(on: boolean): void {
	send(V3_SESSION_FOOT_SWITCH_LEARN_ADDRESS, [on ? 1 : 0]);
}
