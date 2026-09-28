/**
 * v3 Session handler (PR-5d)
 *
 * Consumes `/looping/v3/session/<attr>` fires from the Python Control
 * Surface and dispatches them into `session.svelte.ts` via the existing
 * `handleSessionUpdate` / `handleRootNoteUpdate` / `handleScaleNameUpdate`
 * / `handleScaleModeUpdate` helpers — the same ones that used to
 * consume the M4L `/looping/session/*` and `/looping/song/*` fires.
 *
 * Wire (see Looping's documentation/archive/m4l-to-python-v3/phase-5-plan.md §3.5):
 *   /looping/v3/session/is_playing      [0|1]
 *   /looping/v3/session/metronome       [0|1]
 *   /looping/v3/session/session_record  [0|1]
 *   /looping/v3/session/loop            [0|1]
 *   /looping/v3/session/loop_start      [beats:float]
 *   /looping/v3/session/loop_length     [beats:float]
 *   /looping/v3/session/signature_num   [int]
 *   /looping/v3/session/signature_den   [int]
 *   /looping/v3/session/scale_root      [int]
 *   /looping/v3/session/scale_name      [string]
 *   /looping/v3/session/scale_mode      [0|1]
 *   /looping/v3/session/groove_amount   [float 0..1]
 *   /looping/v3/session/clip_trigger_quantization [int 0..13] (2026-07-27)
 *   /looping/v3/session/auto_arm         [0|1]   (2026-04-22)
 *   /looping/v3/session/move_volume_knob [0|1]   (2026-04-22)
 *   /looping/v3/session/auto_capture     [0|1]   (2026-07-06)
 *
 * `scale_name` arrives as a string (Live's scale list is
 * user-facing); the session store converts to its own index via
 * `getScaleIndex`, same as the M4L path did.
 *
 * Legacy address. Tempo still emits on the pre-v3 address
 * `/looping/session/tempo` (SessionComponent.TEMPO_OBSERVER_ADDRESS)
 * for wire-compat with pre-v3 UI consumers. It is the only non-v3
 * `/looping/*` address still on the wire; dispatched by this handler
 * alongside the v3 attrs.
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import {
	handleSessionUpdate,
	handleRootNoteUpdate,
	handleScaleNameUpdate,
	handleScaleModeUpdate,
	handleScaleDetected,
	handleAutoArmUpdate,
	handleMoveVolumeKnobUpdate,
	handleAutoCaptureUpdate,
	handleKeyFollowUpdate,
	handleFootSwitchUpdate,
	handleClipTriggerQuantizationUpdate,
	session,
	type FootSwitchState
} from '$lib/stores/session.svelte';
import { toNumber, toString } from './oscTypeHelpers';

export const V3_SESSION_IS_PLAYING_ADDRESS = '/looping/v3/session/is_playing';
export const V3_SESSION_METRONOME_ADDRESS = '/looping/v3/session/metronome';
export const V3_SESSION_SESSION_RECORD_ADDRESS = '/looping/v3/session/session_record';
export const V3_SESSION_LOOP_ADDRESS = '/looping/v3/session/loop';
export const V3_SESSION_LOOP_START_ADDRESS = '/looping/v3/session/loop_start';
export const V3_SESSION_LOOP_LENGTH_ADDRESS = '/looping/v3/session/loop_length';
export const V3_SESSION_SIGNATURE_NUM_ADDRESS = '/looping/v3/session/signature_num';
export const V3_SESSION_SIGNATURE_DEN_ADDRESS = '/looping/v3/session/signature_den';
export const V3_SESSION_SCALE_ROOT_ADDRESS = '/looping/v3/session/scale_root';
export const V3_SESSION_SCALE_NAME_ADDRESS = '/looping/v3/session/scale_name';
export const V3_SESSION_SCALE_MODE_ADDRESS = '/looping/v3/session/scale_mode';
/**
 * ADR-446. UI→Surf `[apply:0|1]`: detect the key of the launched MIDI clips;
 * with `1` the surface also writes root, scale and scale mode (one undo step).
 */
export const V3_SESSION_SCALE_DETECT_ADDRESS = '/looping/v3/session/scale/detect';
/**
 * ADR-446. Surf→UI `[root, scale, band, gapPct, runnerRoot, runnerScale,
 * pitchClasses, reasons, applied]` — always answered, never on `/error`;
 * `band` is `no-key` (root `-1`, scale `''`) when nothing decides it.
 */
export const V3_SESSION_SCALE_DETECTED_ADDRESS = '/looping/v3/session/scale/detected';
export const V3_SESSION_GROOVE_AMOUNT_ADDRESS = '/looping/v3/session/groove_amount';

// Live's global launch quantization (`song.clip_trigger_quantization`),
// 0..13 — the grid the transport snaps clip launch/record to. Same
// bidirectional shape as the rest of the family: the UI writes this
// address and the surface echoes it back.
/**
 * Song position in beats, throttled to 10 Hz by the surface's
 * `SessionComponent`. Nothing carried this before, so the transport
 * header's readout sat on the store's cold-start zero and showed a
 * frozen `1.1.0` all session.
 */
export const V3_SESSION_SONG_TIME_ADDRESS = '/looping/v3/session/song_time';

export const V3_SESSION_CLIP_TRIGGER_QUANT_ADDRESS =
	'/looping/v3/session/clip_trigger_quantization';

// SessionSettings runtime toggles (Python SessionSettingsComponent,
// shipped 2026-04-22). Surface emits on change + on handshake accept;
// UI writes back to the same address to flip state.
export const V3_SESSION_AUTO_ARM_ADDRESS = '/looping/v3/session/auto_arm';
export const V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS =
	'/looping/v3/session/move_volume_knob';
// auto_capture (2026-07-06) gates auto-record-on-play + save-as-on-stop.
// Same bidirectional shape, but its default is launch-mode-derived on the
// surface (ipad -> on, dev -> off) and seeded on the first heartbeat, so a
// cold-start UI can read `off` for ~2s before the seed lands.
export const V3_SESSION_AUTO_CAPTURE_ADDRESS = '/looping/v3/session/auto_capture';
/** ADR-447: the key follows the loops (`[0|1]`, both directions; default on). */
export const V3_SESSION_KEY_FOLLOW_ADDRESS = '/looping/v3/session/key_follow';
/**
 * The foot switch, a user setting with Learn (surface `FootSwitchComponent`).
 * Surf→UI `[enabled, channel, cc, mode, learn, heard]`; the UI writes the two
 * sub-addresses, `enabled [0|1]` (on with nothing learned starts a learn) and
 * `learn [0|1]` (start, cancel).
 */
export const V3_SESSION_FOOT_SWITCH_ADDRESS = '/looping/v3/session/foot_switch';
export const V3_SESSION_FOOT_SWITCH_ENABLED_ADDRESS = '/looping/v3/session/foot_switch/enabled';
export const V3_SESSION_FOOT_SWITCH_LEARN_ADDRESS = '/looping/v3/session/foot_switch/learn';

// Legacy tempo wire — SessionComponent emits tempo on this pre-v3
// address for wire-compat. The only non-v3 `/looping/*` address still
// on the wire.
export const LEGACY_SESSION_TEMPO_ADDRESS = '/looping/session/tempo';

// Command verbs — UI→Surf only. No inbound handling (LOM fires the
// state attrs above on any resulting change). Exported from this
// module so UI senders have the same import site as the state attrs.
export const V3_SESSION_PLAY_CMD_ADDRESS = '/looping/v3/session/play_cmd';
export const V3_SESSION_STOP_CMD_ADDRESS = '/looping/v3/session/stop_cmd';
export const V3_SESSION_CONTINUE_CMD_ADDRESS = '/looping/v3/session/continue_cmd';

const V3_SESSION_ADDRESSES = new Set<string>([
	V3_SESSION_IS_PLAYING_ADDRESS,
	V3_SESSION_METRONOME_ADDRESS,
	V3_SESSION_SESSION_RECORD_ADDRESS,
	V3_SESSION_LOOP_ADDRESS,
	V3_SESSION_LOOP_START_ADDRESS,
	V3_SESSION_LOOP_LENGTH_ADDRESS,
	V3_SESSION_SIGNATURE_NUM_ADDRESS,
	V3_SESSION_SIGNATURE_DEN_ADDRESS,
	V3_SESSION_SCALE_ROOT_ADDRESS,
	V3_SESSION_SCALE_NAME_ADDRESS,
	V3_SESSION_SCALE_MODE_ADDRESS,
	V3_SESSION_SCALE_DETECTED_ADDRESS,
	V3_SESSION_GROOVE_AMOUNT_ADDRESS,
	V3_SESSION_CLIP_TRIGGER_QUANT_ADDRESS,
	V3_SESSION_SONG_TIME_ADDRESS,
	V3_SESSION_AUTO_ARM_ADDRESS,
	V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS,
	V3_SESSION_AUTO_CAPTURE_ADDRESS,
	V3_SESSION_KEY_FOLLOW_ADDRESS,
	V3_SESSION_FOOT_SWITCH_ADDRESS,
	LEGACY_SESSION_TEMPO_ADDRESS
]);

export function isV3SessionAddress(address: string): boolean {
	return V3_SESSION_ADDRESSES.has(address);
}

export function handleV3Session(address: string, args: OSCArg[]): void {
	if (args.length < 1) {
		logger.warn('v3 session missing args', { address, args });
		return;
	}
	const ts = Date.now();
	const raw = args[0];

	switch (address) {
		case V3_SESSION_SONG_TIME_ADDRESS: {
			// Beats since the start of the arrangement. The store turns
			// it into bar.beat.sixteenth against the current signature.
			//
			// Read explicitly rather than through `toNumber`, which
			// answers 0 for junk — and 0 is a MEANINGFUL position here
			// (bar 1), so a garbled packet would jump the readout to the
			// top of the set rather than leaving it where it was.
			const beats =
				typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
			if (!Number.isFinite(beats) || beats < 0) {
				logger.warn('v3 session song_time: bad value', { raw });
				return;
			}
			handleSessionUpdate({ type: 'current-time', beats, timestamp: ts });
			return;
		}

		case V3_SESSION_IS_PLAYING_ADDRESS:
			handleSessionUpdate({
				type: 'transport',
				isPlaying: toNumber(raw) === 1,
				timestamp: ts
			});
			return;

		case V3_SESSION_METRONOME_ADDRESS:
			handleSessionUpdate({
				type: 'metronome',
				enabled: toNumber(raw) === 1,
				timestamp: ts
			});
			return;

		case V3_SESSION_SESSION_RECORD_ADDRESS:
			handleSessionUpdate({
				type: 'session-record',
				isRecording: toNumber(raw) === 1,
				timestamp: ts
			});
			return;

		case V3_SESSION_LOOP_ADDRESS:
			handleSessionUpdate({
				type: 'loop',
				isLooping: toNumber(raw) === 1,
				loopStart: session.loopStart,
				loopEnd: session.loopEnd,
				timestamp: ts
			});
			return;

		case V3_SESSION_LOOP_START_ADDRESS: {
			// Preserve current loopLength by rebasing loopEnd off the
			// new start. The session store shape is (start, end),
			// Live's LOM is (start, length) — convert at the boundary.
			const loopStart = toNumber(raw);
			const loopLength = session.loopEnd - session.loopStart;
			handleSessionUpdate({
				type: 'loop',
				isLooping: session.isLooping,
				loopStart,
				loopEnd: loopStart + loopLength,
				timestamp: ts
			});
			return;
		}

		case V3_SESSION_LOOP_LENGTH_ADDRESS: {
			const loopLength = toNumber(raw);
			const loopStart = session.loopStart;
			handleSessionUpdate({
				type: 'loop',
				isLooping: session.isLooping,
				loopStart,
				loopEnd: loopStart + loopLength,
				timestamp: ts
			});
			return;
		}

		case V3_SESSION_SIGNATURE_NUM_ADDRESS:
			handleSessionUpdate({
				type: 'time-signature',
				timeSignature: {
					numerator: toNumber(raw),
					denominator: session.timeSignature.denominator
				},
				timestamp: ts
			});
			return;

		case V3_SESSION_SIGNATURE_DEN_ADDRESS:
			handleSessionUpdate({
				type: 'time-signature',
				timeSignature: {
					numerator: session.timeSignature.numerator,
					denominator: toNumber(raw)
				},
				timestamp: ts
			});
			return;

		case V3_SESSION_SCALE_ROOT_ADDRESS:
			handleRootNoteUpdate(toNumber(raw));
			return;

		case V3_SESSION_SCALE_NAME_ADDRESS:
			handleScaleNameUpdate(toString(raw));
			return;

		case V3_SESSION_SCALE_MODE_ADDRESS:
			handleScaleModeUpdate(toNumber(raw));
			return;

		case V3_SESSION_SCALE_DETECTED_ADDRESS: {
			// ADR-446: nine positional args. A short packet is a garbled one —
			// dropped, never guessed at, since a wrong key is worse than none.
			if (args.length < 9) {
				logger.warn('v3 session scale/detected: short packet', { args });
				return;
			}
			handleScaleDetected({
				root: toNumber(args[0]),
				scale: toString(args[1]),
				band: toString(args[2]),
				gapPct: toNumber(args[3]),
				runnerRoot: toNumber(args[4]),
				runnerScale: toString(args[5]),
				pitchClasses: toNumber(args[6]),
				reasons: toString(args[7]),
				applied: toNumber(args[8]) === 1,
				at: ts
			});
			return;
		}

		case V3_SESSION_GROOVE_AMOUNT_ADDRESS:
			handleSessionUpdate({
				type: 'groove',
				amount: toNumber(raw),
				timestamp: ts
			});
			return;

		case V3_SESSION_CLIP_TRIGGER_QUANT_ADDRESS:
			handleClipTriggerQuantizationUpdate(toNumber(raw));
			return;

		case V3_SESSION_AUTO_ARM_ADDRESS:
			handleAutoArmUpdate(toNumber(raw));
			return;

		case V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS:
			handleMoveVolumeKnobUpdate(toNumber(raw));
			return;

		case V3_SESSION_AUTO_CAPTURE_ADDRESS:
			handleAutoCaptureUpdate(toNumber(raw));
			return;

		case V3_SESSION_KEY_FOLLOW_ADDRESS:
			handleKeyFollowUpdate(toNumber(raw));
			return;

		case V3_SESSION_FOOT_SWITCH_ADDRESS:
			handleFootSwitchUpdate(parseFootSwitch(args));
			return;

		case LEGACY_SESSION_TEMPO_ADDRESS:
			handleSessionUpdate({
				type: 'tempo',
				bpm: toNumber(raw),
				timestamp: ts
			});
			return;
	}
}

const FOOT_MODES = new Set(['momentary', 'latching', '']);
const FOOT_LEARN_STATES = new Set(['idle', 'listening', 'timeout']);

/** `[enabled, channel, cc, mode, learn, heard]` → state, or null if malformed. */
export function parseFootSwitch(args: OSCArg[]): FootSwitchState | null {
	if (args.length < 6) {
		logger.warn('foot_switch: short args', { args });
		return null;
	}
	const [enabled, channel, cc, mode, learn, heard] = args;
	const state = {
		enabled: toNumber(enabled) === 1,
		channel: toNumber(channel),
		cc: toNumber(cc),
		mode: toString(mode),
		learn: toString(learn),
		heard: toNumber(heard) === 1
	};
	if (
		!Number.isInteger(state.channel) || state.channel < 0 || state.channel > 16 ||
		!Number.isInteger(state.cc) || state.cc < -1 || state.cc > 127 ||
		!FOOT_MODES.has(state.mode) || !FOOT_LEARN_STATES.has(state.learn)
	) {
		logger.warn('foot_switch: malformed args', { args });
		return null;
	}
	return state as FootSwitchState;
}
