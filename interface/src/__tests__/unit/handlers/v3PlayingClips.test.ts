/**
 * v3PlayingClips handler — ADR-360.
 *
 * Routes:
 *   /looping/v3/track/playing_slot
 *   /looping/v3/track/playhead
 *   /looping/v3/clip/notes/changed
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
	V3_CLIP_NOTES_CHANGED_ADDRESS,
	V3_TRACK_PLAYHEAD_ADDRESS,
	V3_TRACK_PLAYING_SLOT_ADDRESS,
	handleV3PlayingClips,
	isV3PlayingClipsAddress
} from '$lib/api/handlers/v3PlayingClips';
import {
	__resetPlayingClipsStoreForTests,
	playingClipsStore
} from '$lib/stores/v6/playingClipsStore.svelte';
import {
	__resetClipNotesServiceForTests,
	subscribeNotesChanged
} from '$lib/services/clipNotesService';

describe('v3PlayingClips handler', () => {
	beforeEach(() => {
		__resetPlayingClipsStoreForTests();
		__resetClipNotesServiceForTests();
	});

	describe('isV3PlayingClipsAddress', () => {
		it('matches the three relevant addresses', () => {
			expect(isV3PlayingClipsAddress(V3_TRACK_PLAYING_SLOT_ADDRESS)).toBe(true);
			expect(isV3PlayingClipsAddress(V3_TRACK_PLAYHEAD_ADDRESS)).toBe(true);
			expect(isV3PlayingClipsAddress(V3_CLIP_NOTES_CHANGED_ADDRESS)).toBe(true);
			expect(isV3PlayingClipsAddress('/looping/v3/track/meter')).toBe(false);
		});
	});

	describe('playing_slot', () => {
		it('writes the entry to playingClipsStore', () => {
			handleV3PlayingClips(V3_TRACK_PLAYING_SLOT_ADDRESS, [
				'tracks/0',
				2,
				1,
				'/User Library/Samples/foo.wav',
				8,
				2,
				6,
				1,
				1
			]);
			const entry = playingClipsStore.get('tracks/0');
			expect(entry).toBeDefined();
			expect(entry!.slotIdx).toBe(2);
			expect(entry!.isAudioClip).toBe(true);
			expect(entry!.filePath).toBe('/User Library/Samples/foo.wav');
			expect(entry!.lengthBeats).toBe(8);
			expect(entry!.looping).toBe(true);
			expect(entry!.status).toBe(1);
		});

		it('reads the trailing file span — the rig Bass take, loop past `length`', () => {
			handleV3PlayingClips(V3_TRACK_PLAYING_SLOT_ADDRESS, [
				'tracks/2',
				0,
				1,
				'/Rec/Bass 0001.aif',
				8,
				16,
				24,
				1,
				1,
				0,
				28
			]);
			const entry = playingClipsStore.get('tracks/2')!;
			expect(entry.fileStartBeats).toBe(0);
			expect(entry.fileEndBeats).toBe(28);
		});

		it('reads a nine-arg frame (surface older than the span) as span unknown', () => {
			handleV3PlayingClips(V3_TRACK_PLAYING_SLOT_ADDRESS, [
				'tracks/2',
				0,
				1,
				'/Rec/Bass 0001.aif',
				8,
				16,
				24,
				1,
				1
			]);
			const entry = playingClipsStore.get('tracks/2')!;
			expect(entry.fileStartBeats).toBe(0);
			expect(entry.fileEndBeats).toBe(0);
		});

		it('handles stop frame (slotIdx=-1)', () => {
			handleV3PlayingClips(V3_TRACK_PLAYING_SLOT_ADDRESS, [
				'tracks/0',
				-1,
				0,
				'',
				0,
				0,
				0,
				0,
				0
			]);
			const entry = playingClipsStore.get('tracks/0');
			expect(entry!.slotIdx).toBe(-1);
			expect(entry!.status).toBe(0);
		});

		it('drops short payloads', () => {
			handleV3PlayingClips(V3_TRACK_PLAYING_SLOT_ADDRESS, ['tracks/0']);
			expect(playingClipsStore.get('tracks/0')).toBeUndefined();
		});
	});

	describe('playhead', () => {
		it('updates positionBeats + status via the live position channel', () => {
			handleV3PlayingClips(V3_TRACK_PLAYING_SLOT_ADDRESS, [
				'tracks/0',
				0,
				0,
				'',
				4,
				0,
				4,
				0,
				1
			]);
			handleV3PlayingClips(V3_TRACK_PLAYHEAD_ADDRESS, [
				'tracks/0',
				0,
				1.25,
				1
			]);
			// High-frequency channel: queried via the live accessors.
			// The gestural `entry` ref must NOT have been replaced by
			// the playhead emit (audio-rate reactive cascade defense).
			expect(playingClipsStore.position('tracks/0')).toBe(1.25);
			expect(playingClipsStore.liveStatus('tracks/0')).toBe(1);
		});
	});

	describe('clip notes/changed', () => {
		it('fires the matching subscriber', () => {
			const cb = vi.fn();
			subscribeNotesChanged('tracks/0/slots/0/clip', cb);
			handleV3PlayingClips(V3_CLIP_NOTES_CHANGED_ADDRESS, [
				'tracks/0',
				'tracks/0/slots/0/clip'
			]);
			expect(cb).toHaveBeenCalledTimes(1);
		});
	});
});
