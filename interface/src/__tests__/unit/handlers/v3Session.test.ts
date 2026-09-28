/**
 * vitest coverage for the PR-5d v3 session dispatcher (`handleV3Session`).
 *
 * The handler receives `/looping/v3/session/<attr>` messages from the
 * Python Control Surface and translates them into the existing
 * `handleSessionUpdate` / `handleRootNoteUpdate` / `handleScaleNameUpdate`
 * / `handleScaleModeUpdate` surface on the session store. The Python
 * side is the source of truth — these tests only cover the wire-to-
 * store translation at the TypeScript boundary.
 *
 * Pytest covers the producer behaviour (address, args, validate-and-
 * reject) — see `surface/tests/test_session_component.py`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger (same shape every handler test uses).
vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

// Mock the session store. `loop_start` / `loop_length` read back the
// current other side via `session.loopStart` / `session.loopEnd`; we
// control those via this mutable stub so tests can drive the
// preservation logic explicitly.
const mockSessionState = {
	loopStart: 0,
	loopEnd: 16,
	isLooping: false,
	timeSignature: { numerator: 4, denominator: 4 }
};

const mockHandleSessionUpdate = vi.fn();
const mockHandleRootNoteUpdate = vi.fn();
const mockHandleScaleNameUpdate = vi.fn();
const mockHandleScaleModeUpdate = vi.fn();
const mockHandleAutoArmUpdate = vi.fn();
const mockHandleMoveVolumeKnobUpdate = vi.fn();
const mockHandleClipTriggerQuantizationUpdate = vi.fn();
const mockHandleScaleDetected = vi.fn();
const mockHandleKeyFollowUpdate = vi.fn();

vi.mock('$lib/stores/session.svelte', () => ({
	handleSessionUpdate: (u: unknown) => mockHandleSessionUpdate(u),
	handleRootNoteUpdate: (n: number) => mockHandleRootNoteUpdate(n),
	handleScaleNameUpdate: (s: string | number) => mockHandleScaleNameUpdate(s),
	handleScaleModeUpdate: (m: number | boolean) => mockHandleScaleModeUpdate(m),
	handleScaleDetected: (d: unknown) => mockHandleScaleDetected(d),
	handleKeyFollowUpdate: (n: number | boolean) => mockHandleKeyFollowUpdate(n),
	handleAutoArmUpdate: (n: number | boolean) => mockHandleAutoArmUpdate(n),
	handleMoveVolumeKnobUpdate: (n: number | boolean) =>
		mockHandleMoveVolumeKnobUpdate(n),
	handleClipTriggerQuantizationUpdate: (n: number) =>
		mockHandleClipTriggerQuantizationUpdate(n),
	session: {
		get loopStart() {
			return mockSessionState.loopStart;
		},
		get loopEnd() {
			return mockSessionState.loopEnd;
		},
		get isLooping() {
			return mockSessionState.isLooping;
		},
		get timeSignature() {
			return mockSessionState.timeSignature;
		}
	}
}));

import {
	handleV3Session,
	isV3SessionAddress,
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
	V3_SESSION_KEY_FOLLOW_ADDRESS,
	V3_SESSION_GROOVE_AMOUNT_ADDRESS,
	V3_SESSION_CLIP_TRIGGER_QUANT_ADDRESS,
	V3_SESSION_AUTO_ARM_ADDRESS,
	V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS,
	LEGACY_SESSION_TEMPO_ADDRESS,
	V3_SESSION_PLAY_CMD_ADDRESS,
	V3_SESSION_STOP_CMD_ADDRESS,
	V3_SESSION_CONTINUE_CMD_ADDRESS
} from '$lib/api/handlers/v3Session';

describe('isV3SessionAddress', () => {
	it('recognizes all 15 v3 state addresses + legacy tempo', () => {
		const addrs = [
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
			V3_SESSION_GROOVE_AMOUNT_ADDRESS,
			V3_SESSION_CLIP_TRIGGER_QUANT_ADDRESS,
			V3_SESSION_AUTO_ARM_ADDRESS,
			V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS,
			LEGACY_SESSION_TEMPO_ADDRESS
		];
		for (const a of addrs) expect(isV3SessionAddress(a)).toBe(true);
	});

	it('does NOT recognize command verbs (UI→Surf only, no inbound path)', () => {
		// Commands are fire-and-forget writes. The surface does not
		// emit these addresses back — any resulting state lands on the
		// state attrs above (is_playing, etc). Guarding against an
		// accidental inbound dispatch catches UI wiring bugs.
		expect(isV3SessionAddress(V3_SESSION_PLAY_CMD_ADDRESS)).toBe(false);
		expect(isV3SessionAddress(V3_SESSION_STOP_CMD_ADDRESS)).toBe(false);
		expect(isV3SessionAddress(V3_SESSION_CONTINUE_CMD_ADDRESS)).toBe(false);
	});

	it('rejects unrelated addresses', () => {
		expect(isV3SessionAddress('/looping/v3/track/name')).toBe(false);
		expect(isV3SessionAddress('/looping/v3/session/unknown')).toBe(false);
		expect(isV3SessionAddress('')).toBe(false);
	});
});

describe('handleV3Session', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSessionState.loopStart = 0;
		mockSessionState.loopEnd = 16;
		mockSessionState.isLooping = false;
		mockSessionState.timeSignature = { numerator: 4, denominator: 4 };
	});

	it('drops messages with no args and warns', () => {
		handleV3Session(V3_SESSION_IS_PLAYING_ADDRESS, []);
		expect(mockHandleSessionUpdate).not.toHaveBeenCalled();
	});

	describe('bool01 attrs', () => {
		it('is_playing [1] → transport isPlaying=true', () => {
			handleV3Session(V3_SESSION_IS_PLAYING_ADDRESS, [1]);
			expect(mockHandleSessionUpdate).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'transport', isPlaying: true })
			);
		});

		it('is_playing [0] → transport isPlaying=false', () => {
			handleV3Session(V3_SESSION_IS_PLAYING_ADDRESS, [0]);
			expect(mockHandleSessionUpdate).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'transport', isPlaying: false })
			);
		});

		it('metronome [1] → metronome enabled=true', () => {
			handleV3Session(V3_SESSION_METRONOME_ADDRESS, [1]);
			expect(mockHandleSessionUpdate).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'metronome', enabled: true })
			);
		});

		it('session_record [1] → session-record isRecording=true', () => {
			handleV3Session(V3_SESSION_SESSION_RECORD_ADDRESS, [1]);
			expect(mockHandleSessionUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'session-record',
					isRecording: true
				})
			);
		});

		it('loop [1] → loop isLooping=true preserves current start/end', () => {
			mockSessionState.loopStart = 4;
			mockSessionState.loopEnd = 12;
			handleV3Session(V3_SESSION_LOOP_ADDRESS, [1]);
			expect(mockHandleSessionUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'loop',
					isLooping: true,
					loopStart: 4,
					loopEnd: 12
				})
			);
		});
	});

	describe('loop_start / loop_length', () => {
		it('loop_start preserves current loop_length by rebasing loopEnd', () => {
			// Current: start=0, end=16 → length=16. New start=8 → end=24.
			mockSessionState.loopStart = 0;
			mockSessionState.loopEnd = 16;
			mockSessionState.isLooping = true;
			handleV3Session(V3_SESSION_LOOP_START_ADDRESS, [8]);
			expect(mockHandleSessionUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'loop',
					isLooping: true,
					loopStart: 8,
					loopEnd: 24
				})
			);
		});

		it('loop_length preserves current loopStart', () => {
			mockSessionState.loopStart = 4;
			mockSessionState.loopEnd = 12;
			mockSessionState.isLooping = true;
			handleV3Session(V3_SESSION_LOOP_LENGTH_ADDRESS, [20]);
			expect(mockHandleSessionUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'loop',
					isLooping: true,
					loopStart: 4,
					loopEnd: 24 // 4 + 20
				})
			);
		});

		it('loop_length keeps isLooping from current store state', () => {
			mockSessionState.isLooping = false;
			handleV3Session(V3_SESSION_LOOP_LENGTH_ADDRESS, [32]);
			expect(mockHandleSessionUpdate).toHaveBeenCalledWith(
				expect.objectContaining({ isLooping: false })
			);
		});
	});

	describe('signature_num / signature_den', () => {
		it('signature_num preserves denominator from store', () => {
			mockSessionState.timeSignature = { numerator: 4, denominator: 8 };
			handleV3Session(V3_SESSION_SIGNATURE_NUM_ADDRESS, [3]);
			expect(mockHandleSessionUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'time-signature',
					timeSignature: { numerator: 3, denominator: 8 }
				})
			);
		});

		it('signature_den preserves numerator from store', () => {
			mockSessionState.timeSignature = { numerator: 7, denominator: 4 };
			handleV3Session(V3_SESSION_SIGNATURE_DEN_ADDRESS, [16]);
			expect(mockHandleSessionUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'time-signature',
					timeSignature: { numerator: 7, denominator: 16 }
				})
			);
		});
	});

	describe('scale attrs', () => {
		it('scale_root delegates to handleRootNoteUpdate', () => {
			handleV3Session(V3_SESSION_SCALE_ROOT_ADDRESS, [7]);
			expect(mockHandleRootNoteUpdate).toHaveBeenCalledWith(7);
			expect(mockHandleSessionUpdate).not.toHaveBeenCalled();
		});

		it('scale_name delegates to handleScaleNameUpdate (string arg)', () => {
			handleV3Session(V3_SESSION_SCALE_NAME_ADDRESS, ['Dorian']);
			expect(mockHandleScaleNameUpdate).toHaveBeenCalledWith('Dorian');
		});

		it('scale_mode delegates to handleScaleModeUpdate (1/0)', () => {
			handleV3Session(V3_SESSION_SCALE_MODE_ADDRESS, [1]);
			expect(mockHandleScaleModeUpdate).toHaveBeenCalledWith(1);
		});
	});

	describe('groove_amount', () => {
		it('forwards to handleSessionUpdate as a groove update', () => {
			handleV3Session(V3_SESSION_GROOVE_AMOUNT_ADDRESS, [0.42]);
			expect(mockHandleSessionUpdate).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'groove', amount: 0.42 })
			);
		});

		it('coerces non-number args via toNumber', () => {
			handleV3Session(V3_SESSION_GROOVE_AMOUNT_ADDRESS, ['0.5']);
			expect(mockHandleSessionUpdate).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'groove', amount: 0.5 })
			);
		});
	});

	describe('clip_trigger_quantization (global launch quantization)', () => {
		it('forwards the enum value to the store', () => {
			handleV3Session(V3_SESSION_CLIP_TRIGGER_QUANT_ADDRESS, [4]);
			expect(mockHandleClipTriggerQuantizationUpdate).toHaveBeenCalledWith(4);
		});

		it('forwards 0 (None) — falsy but a real setting', () => {
			handleV3Session(V3_SESSION_CLIP_TRIGGER_QUANT_ADDRESS, [0]);
			expect(mockHandleClipTriggerQuantizationUpdate).toHaveBeenCalledWith(0);
		});

		it('coerces non-number args via toNumber', () => {
			handleV3Session(V3_SESSION_CLIP_TRIGGER_QUANT_ADDRESS, ['13']);
			expect(mockHandleClipTriggerQuantizationUpdate).toHaveBeenCalledWith(13);
		});
	});

	describe('/looping/session/tempo (legacy pre-v3 wire)', () => {
		it('forwards bpm to handleSessionUpdate', () => {
			handleV3Session(LEGACY_SESSION_TEMPO_ADDRESS, [135.5]);
			expect(mockHandleSessionUpdate).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'tempo', bpm: 135.5 })
			);
		});

		it('skips empty args', () => {
			handleV3Session(LEGACY_SESSION_TEMPO_ADDRESS, []);
			expect(mockHandleSessionUpdate).not.toHaveBeenCalled();
		});
	});

	describe('SessionSettings runtime toggles (2026-04-22)', () => {
		it('forwards auto_arm=1 to handleAutoArmUpdate', () => {
			handleV3Session(V3_SESSION_AUTO_ARM_ADDRESS, [1]);
			expect(mockHandleAutoArmUpdate).toHaveBeenCalledWith(1);
			expect(mockHandleSessionUpdate).not.toHaveBeenCalled();
		});

		it('forwards auto_arm=0 to handleAutoArmUpdate', () => {
			handleV3Session(V3_SESSION_AUTO_ARM_ADDRESS, [0]);
			expect(mockHandleAutoArmUpdate).toHaveBeenCalledWith(0);
		});

		it('forwards move_volume_knob=1 to handleMoveVolumeKnobUpdate', () => {
			handleV3Session(V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS, [1]);
			expect(mockHandleMoveVolumeKnobUpdate).toHaveBeenCalledWith(1);
		});

		it('forwards move_volume_knob=0 to handleMoveVolumeKnobUpdate', () => {
			handleV3Session(V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS, [0]);
			expect(mockHandleMoveVolumeKnobUpdate).toHaveBeenCalledWith(0);
		});

		it('auto_arm and move_volume_knob are independent', () => {
			handleV3Session(V3_SESSION_AUTO_ARM_ADDRESS, [0]);
			expect(mockHandleAutoArmUpdate).toHaveBeenCalledTimes(1);
			expect(mockHandleMoveVolumeKnobUpdate).not.toHaveBeenCalled();
		});
	});
});

describe('song position', () => {
	// `/looping/v3/session/song_time` is the channel that made the
	// transport header's readout move at all: before it existed nothing
	// on the v3 wire carried song position, so the store's cold-start
	// zero rendered as a frozen `1.1.0` for the whole session.
	it('translates beats into a current-time update', () => {
		handleV3Session('/looping/v3/session/song_time', [6.5]);
		expect(mockHandleSessionUpdate).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'current-time', beats: 6.5 })
		);
	});

	it('accepts bar one, beat one', () => {
		handleV3Session('/looping/v3/session/song_time', [0]);
		expect(mockHandleSessionUpdate).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'current-time', beats: 0 })
		);
	});

	it('drops a negative or non-finite position rather than moving the readout', () => {
		handleV3Session('/looping/v3/session/song_time', [-1]);
		handleV3Session('/looping/v3/session/song_time', ['nonsense']);
		expect(mockHandleSessionUpdate).not.toHaveBeenCalled();
	});
});

describe('scale/detected (ADR-446)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('is a v3 session address', () => {
		expect(isV3SessionAddress(V3_SESSION_SCALE_DETECTED_ADDRESS)).toBe(true);
	});

	it('hands the nine positional args to the store, applied as a boolean', () => {
		handleV3Session(V3_SESSION_SCALE_DETECTED_ADDRESS, [
			0, 'Minor', 'sure', 60, 3, 'Major', 1453, 'bass downbeats C D# | tonic votes: C 20, D# 8', 1
		]);
		expect(mockHandleScaleDetected).toHaveBeenCalledTimes(1);
		expect(mockHandleScaleDetected.mock.calls[0][0]).toMatchObject({
			root: 0,
			scale: 'Minor',
			band: 'sure',
			gapPct: 60,
			runnerRoot: 3,
			runnerScale: 'Major',
			pitchClasses: 1453,
			reasons: 'bass downbeats C D# | tonic votes: C 20, D# 8',
			applied: true
		});
		expect(typeof mockHandleScaleDetected.mock.calls[0][0].at).toBe('number');
	});

	it('carries a no-key answer as it is', () => {
		handleV3Session(V3_SESSION_SCALE_DETECTED_ADDRESS, [-1, '', 'no-key', 0, -1, '', 0, 'nothing launched', 0]);
		expect(mockHandleScaleDetected.mock.calls[0][0]).toMatchObject({
			root: -1,
			scale: '',
			band: 'no-key',
			applied: false
		});
	});

	it('drops a short packet rather than guessing a key', () => {
		handleV3Session(V3_SESSION_SCALE_DETECTED_ADDRESS, [0, 'Minor', 'sure']);
		expect(mockHandleScaleDetected).not.toHaveBeenCalled();
	});
});

describe('key_follow (ADR-447)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('is a v3 session address', () => {
		expect(isV3SessionAddress(V3_SESSION_KEY_FOLLOW_ADDRESS)).toBe(true);
	});

	it('hands the flag to the store', () => {
		handleV3Session(V3_SESSION_KEY_FOLLOW_ADDRESS, [0]);
		expect(mockHandleKeyFollowUpdate).toHaveBeenCalledWith(0);
		handleV3Session(V3_SESSION_KEY_FOLLOW_ADDRESS, [1]);
		expect(mockHandleKeyFollowUpdate).toHaveBeenLastCalledWith(1);
	});
});
