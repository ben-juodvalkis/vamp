/**
 * clipTranspose.setAudioClipPitch — absolute audio-clip pitch setter.
 *
 * Backs the audio-clip PITCH slider in ClipCentralView (PR #451). The
 * contract this locks down:
 *
 *  1. CLAMP+ROUND — the wire value must be a whole int in [-24, +24].
 *     `pitch_coarse` is an absolute int the Python surface *rejects*
 *     (not clamps) if non-integer or out of range, so the
 *     the clamp to ±AUDIO_CLIP_PITCH_RANGE is load-bearing, not
 *     cosmetic. It narrows to the slider's ±24 window (the parameter
 *     itself spans ±48).
 *  2. OPTIMISTIC APPLY — writes `clipPropertiesStore.pitchCoarse` before
 *     the send so the slider tracks the finger without waiting for the
 *     surface's property echo (same apply+send pairing as trackCommands).
 *  3. NO-OP GUARD — skips the send when the rounded target already
 *     matches the current value (dedup during a drag), while still
 *     pulling an out-of-range backing value into the ±24 window.
 *  4. FOCUS GATE — no focused clip → no send, no store write.
 *
 * Uses the REAL clipPropertiesStore (a self-contained runes singleton):
 * the no-op guard reads pitchCoarse back after the optimistic write, so
 * a stateless mock couldn't exercise it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({
	send: vi.fn()
}));

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

// Mutable focused-clip state, flipped per-test. `requireFocusedClip`
// mirrors the real signature (returns clipPath or null; opts ignored).
const { mockSessionState } = vi.hoisted(() => ({
	mockSessionState: { focusedClipPath: null as string | null }
}));

vi.mock('$lib/stores/session.svelte', () => ({
	session: {
		get focusedClipPath() {
			return mockSessionState.focusedClipPath;
		}
	},
	requireFocusedClip: vi.fn(() => mockSessionState.focusedClipPath)
}));

import { send } from '$lib/api/simpleClient';
import { setAudioClipPitch } from '$lib/services/clipTranspose';
import { clipPropertiesStore } from '$lib/stores/v6/clipPropertiesStore.svelte';

const sendMock = send as unknown as ReturnType<typeof vi.fn>;

const PITCH_ADDR = '/looping/v3/clip/set/pitch_coarse';
const CLIP = 'tracks/0/slots/0';

describe('clipTranspose.setAudioClipPitch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clipPropertiesStore.reset(); // pitchCoarse -> 0
		mockSessionState.focusedClipPath = CLIP;
	});

	describe('clamp to the slider range [-24, +24]', () => {
		it('clamps above +24 and still sends', () => {
			setAudioClipPitch(25);
			expect(sendMock).toHaveBeenCalledWith(PITCH_ADDR, [CLIP, 24]);
			expect(clipPropertiesStore.pitchCoarse).toBe(24);
		});

		it('clamps below -24 and still sends', () => {
			setAudioClipPitch(-25);
			expect(sendMock).toHaveBeenCalledWith(PITCH_ADDR, [CLIP, -24]);
			expect(clipPropertiesStore.pitchCoarse).toBe(-24);
		});

		it('clamps a far-out value (parameter spans ±48) into ±24', () => {
			setAudioClipPitch(48);
			expect(sendMock).toHaveBeenCalledWith(PITCH_ADDR, [CLIP, 24]);
		});

		it('passes an in-range value through unchanged', () => {
			setAudioClipPitch(7);
			expect(sendMock).toHaveBeenCalledWith(PITCH_ADDR, [CLIP, 7]);
			expect(clipPropertiesStore.pitchCoarse).toBe(7);
		});
	});

	describe('round to a whole semitone', () => {
		it('rounds 4.6 up to 5', () => {
			setAudioClipPitch(4.6);
			expect(sendMock).toHaveBeenCalledWith(PITCH_ADDR, [CLIP, 5]);
		});

		it('rounds 4.4 down to 4', () => {
			setAudioClipPitch(4.4);
			expect(sendMock).toHaveBeenCalledWith(PITCH_ADDR, [CLIP, 4]);
		});

		it('rounds -4.6 to -5', () => {
			setAudioClipPitch(-4.6);
			expect(sendMock).toHaveBeenCalledWith(PITCH_ADDR, [CLIP, -5]);
		});

		it('rounds-then-clamps at the +24 boundary (23.5 -> 24)', () => {
			setAudioClipPitch(23.5);
			expect(sendMock).toHaveBeenCalledWith(PITCH_ADDR, [CLIP, 24]);
		});

		it('rounds-then-clamps just over the boundary (24.5 -> 25 -> 24)', () => {
			setAudioClipPitch(24.5);
			expect(sendMock).toHaveBeenCalledWith(PITCH_ADDR, [CLIP, 24]);
		});

		it('always sends an integer on the wire', () => {
			setAudioClipPitch(3.9);
			const arg = sendMock.mock.calls[0][1][1];
			expect(Number.isInteger(arg)).toBe(true);
		});
	});

	describe('no-op guard (dedup)', () => {
		it('sends once, then no-ops on a repeat of the same value', () => {
			setAudioClipPitch(5);
			expect(sendMock).toHaveBeenCalledTimes(1);

			setAudioClipPitch(5);
			expect(sendMock).toHaveBeenCalledTimes(1); // still 1 — second call skipped
		});

		it('no-ops when a fractional input rounds to the current value', () => {
			setAudioClipPitch(5); // store -> 5
			sendMock.mockClear();

			setAudioClipPitch(5.2); // rounds to 5 === current
			expect(sendMock).not.toHaveBeenCalled();
		});

		it('no-ops when setting center (0) while already centered', () => {
			// reset() left pitchCoarse at 0; setting 0 is a no-op.
			setAudioClipPitch(0);
			expect(sendMock).not.toHaveBeenCalled();
		});

		it('still sends when clamping an out-of-range backing value into range', () => {
			// Simulate an outside-the-UI value (e.g. a set beyond the slider
			// window). First touch at the top of the slider must send even
			// though the wire target equals the slider max.
			clipPropertiesStore.handlePitchCoarse(36);
			setAudioClipPitch(24);
			expect(sendMock).toHaveBeenCalledWith(PITCH_ADDR, [CLIP, 24]);
			expect(clipPropertiesStore.pitchCoarse).toBe(24);
		});
	});

	describe('focus gate', () => {
		it('does not send and does not write the store with no focused clip', () => {
			mockSessionState.focusedClipPath = null;
			setAudioClipPitch(5);
			expect(sendMock).not.toHaveBeenCalled();
			expect(clipPropertiesStore.pitchCoarse).toBe(0);
		});
	});

	describe('optimistic apply ordering', () => {
		it('writes the store before/with the send (apply+send pair)', () => {
			// At send time the store already reflects the new value — the
			// optimistic write is not deferred to the surface echo.
			sendMock.mockImplementation(() => {
				expect(clipPropertiesStore.pitchCoarse).toBe(6);
			});
			setAudioClipPitch(6);
			expect(sendMock).toHaveBeenCalledWith(PITCH_ADDR, [CLIP, 6]);
		});
	});
});
