/**
 * The sidebar's clip controls with NOTHING focused (2026-09-19).
 *
 * `VerticalQuantizeControl` and `VerticalLoopControl` are focus-scoped:
 * every write they make is keyed on `session.focusedClipPath`, so with
 * no focused clip the Q slider moved under the finger and sent nothing
 * at all, and the brace drew an inert well. `focusPlayingClipOnSelectedTrack`
 * is the fallback both now reach through — the clip RUNNING on the
 * selected track — and this pins which clip that is, and that a focused
 * clip is left exactly as it was.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({
	send: vi.fn(),
	sendClipLaunch: vi.fn(),
	sendClipStop: vi.fn(),
	sendClipFocus: vi.fn(),
	sendSelectClip: vi.fn()
}));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { sendClipFocus } from '$lib/api/simpleClient';
import { session, handleFocusedClipPath } from '$lib/stores/session.svelte';
import {
	applyPlayingSlot,
	__resetPlayingClipsStoreForTests
} from '$lib/stores/v6/playingClipsStore.svelte';
import { focusPlayingClipOnSelectedTrack } from '$lib/components/v6/tracks/composables/slotActions';

const TRACK_INDEX = 2;
const TRACK = `tracks/${TRACK_INDEX}`;

/** A `playing_slot` frame for `TRACK`, at `status` (1 play, 2 rec, 0 stopped). */
function playingSlot(slotIdx: number, status: number) {
	applyPlayingSlot({
		trackPath: TRACK,
		slotIdx,
		isAudioClip: true,
		filePath: '/x.wav',
		lengthBeats: 16,
		loopStartBeats: 0,
		loopEndBeats: 16,
		looping: true,
		status
	});
}

describe('focusPlayingClipOnSelectedTrack', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		__resetPlayingClipsStoreForTests();
		handleFocusedClipPath('');
		session.selectTrackOptimistically(TRACK_INDEX);
		session.selectSceneOptimistically(0);
	});

	it('returns the focused clip and writes nothing when one is focused', () => {
		handleFocusedClipPath('tracks/7/slots/1/clip');
		playingSlot(3, 1);

		expect(focusPlayingClipOnSelectedTrack()).toBe('tracks/7/slots/1/clip');
		expect(sendClipFocus).not.toHaveBeenCalled();
	});

	it('focuses the clip playing on the selected track', () => {
		playingSlot(3, 1);

		expect(focusPlayingClipOnSelectedTrack()).toBe(`${TRACK}/slots/3/clip`);
		expect(sendClipFocus).toHaveBeenCalledWith(`${TRACK}/slots/3`);
		// The pedal's row moves with it, before the echo.
		expect(session.selectedSceneIndex).toBe(3);
	});

	it('counts a take in progress — it is the clip being worked on', () => {
		playingSlot(5, 2);

		expect(focusPlayingClipOnSelectedTrack()).toBe(`${TRACK}/slots/5/clip`);
	});

	it('ignores a stopped entry lingering in the store', () => {
		playingSlot(3, 0);

		expect(focusPlayingClipOnSelectedTrack()).toBeNull();
		expect(sendClipFocus).not.toHaveBeenCalled();
		expect(session.selectedSceneIndex).toBe(0);
	});

	it('does nothing when the selected track is playing nothing', () => {
		expect(focusPlayingClipOnSelectedTrack()).toBeNull();
		expect(sendClipFocus).not.toHaveBeenCalled();
	});

	it('does not reach for another track that IS playing', () => {
		applyPlayingSlot({
			trackPath: 'tracks/9',
			slotIdx: 1,
			isAudioClip: true,
			filePath: '/y.wav',
			lengthBeats: 16,
			loopStartBeats: 0,
			loopEndBeats: 16,
			looping: true,
			status: 1
		});

		expect(focusPlayingClipOnSelectedTrack()).toBeNull();
		expect(sendClipFocus).not.toHaveBeenCalled();
	});

	it('does nothing with the master selected', () => {
		session.selectTrackOptimistically(-1);
		playingSlot(3, 1);

		expect(focusPlayingClipOnSelectedTrack()).toBeNull();
		expect(sendClipFocus).not.toHaveBeenCalled();
	});
});
