/**
 * playingClipsStore — ADR-360.
 *
 * Covers the direct-position model:
 *  - applyPlayingSlot writes the entry's render context atomically.
 *  - applyPlayhead patches positionBeats + status without touching
 *    slot identity, and drops late fires from a slot the UI has
 *    already rotated past.
 *  - Stop frame (slotIdx === -1) clears the entry.
 *  - patchLoopWindowFromProperty matches by clipPath.
 *  - visibleWindow + playheadFraction render-time math.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
	__resetPlayingClipsStoreForTests,
	applyPlayhead,
	applyPlayingSlot,
	patchLoopWindowFromProperty,
	playheadFraction,
	playingClipsStore,
	visibleWindow
} from '$lib/stores/v6/playingClipsStore.svelte';

describe('playingClipsStore', () => {
	beforeEach(() => {
		__resetPlayingClipsStoreForTests();
	});

	describe('applyPlayingSlot', () => {
		it('writes the full render payload', () => {
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: 2,
				isAudioClip: true,
				filePath: '/User Library/Samples/foo.wav',
				lengthBeats: 8,
				loopStartBeats: 2,
				loopEndBeats: 6,
				looping: true,
				status: 1
			});
			const entry = playingClipsStore.get('tracks/0');
			expect(entry).toBeDefined();
			expect(entry!.slotIdx).toBe(2);
			expect(entry!.isAudioClip).toBe(true);
			expect(entry!.filePath).toBe('/User Library/Samples/foo.wav');
			expect(entry!.clipPath).toBe('tracks/0/slots/2/clip');
			expect(entry!.lengthBeats).toBe(8);
			expect(entry!.loopStartBeats).toBe(2);
			expect(entry!.loopEndBeats).toBe(6);
			expect(entry!.looping).toBe(true);
			expect(entry!.status).toBe(1);
			expect(entry!.positionBeats).toBe(0);
		});

		it('clears the entry to a stopped frame on slotIdx=-1', () => {
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: 2,
				isAudioClip: false,
				filePath: '',
				lengthBeats: 4,
				loopStartBeats: 0,
				loopEndBeats: 4,
				looping: false,
				status: 1
			});
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: -1,
				isAudioClip: false,
				filePath: '',
				lengthBeats: 0,
				loopStartBeats: 0,
				loopEndBeats: 0,
				looping: false,
				status: 0
			});
			const entry = playingClipsStore.get('tracks/0');
			expect(entry!.slotIdx).toBe(-1);
			expect(entry!.status).toBe(0);
			expect(entry!.clipPath).toBe('');
		});
	});

	describe('applyPlayhead', () => {
		it('patches positionBeats + status without touching identity', () => {
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: 0,
				isAudioClip: false,
				filePath: '',
				lengthBeats: 4,
				loopStartBeats: 0,
				loopEndBeats: 4,
				looping: false,
				status: 1
			});
			applyPlayhead({
				trackPath: 'tracks/0',
				slotIdx: 0,
				positionBeats: 1.5,
				status: 1
			});
			// Position + live status read from the high-frequency channel;
			// the gestural `entry` ref stays stable across playhead ticks
			// (this is the "stop the audio-rate reactive cascade" invariant).
			expect(playingClipsStore.position('tracks/0')).toBe(1.5);
			expect(playingClipsStore.liveStatus('tracks/0')).toBe(1);
			const entry = playingClipsStore.get('tracks/0');
			expect(entry!.slotIdx).toBe(0);
			expect(entry!.lengthBeats).toBe(4); // untouched
		});

		it('keeps the position when the same clip is re-sent, drops it on a new one', () => {
			// Transport stopped, clip held mid-loop: a re-send (an edit, another
			// screen connecting) must not snap its playhead to the start.
			const slot = (slotIdx: number, filePath: string) =>
				applyPlayingSlot({
					trackPath: 'tracks/0',
					slotIdx,
					isAudioClip: true,
					filePath,
					lengthBeats: 8,
					loopStartBeats: 0,
					loopEndBeats: 8,
					looping: true,
					status: 1
				});
			slot(0, '/a.aif');
			applyPlayhead({ trackPath: 'tracks/0', slotIdx: 0, positionBeats: 1.56, status: 1 });
			slot(0, '/a.aif');
			expect(playingClipsStore.position('tracks/0')).toBeCloseTo(1.56, 5);
			slot(0, '/b.aif'); // replaced in place
			expect(playingClipsStore.position('tracks/0')).toBe(0);
			applyPlayhead({ trackPath: 'tracks/0', slotIdx: 0, positionBeats: 3, status: 1 });
			slot(1, '/b.aif'); // another slot
			expect(playingClipsStore.position('tracks/0')).toBe(0);
		});

		it('drops late fires from a slot the UI has already rotated past', () => {
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: 1,
				isAudioClip: false,
				filePath: '',
				lengthBeats: 4,
				loopStartBeats: 0,
				loopEndBeats: 4,
				looping: false,
				status: 1
			});
			// Stale fire targeting the prior slot.
			applyPlayhead({
				trackPath: 'tracks/0',
				slotIdx: 0,
				positionBeats: 99,
				status: 1
			});
			// Position channel is unchanged (slot reset on slot change cleared it).
			expect(playingClipsStore.position('tracks/0')).toBe(0);
		});

		it('ignores playhead when no entry is active', () => {
			applyPlayhead({
				trackPath: 'tracks/0',
				slotIdx: 0,
				positionBeats: 1,
				status: 1
			});
			expect(playingClipsStore.get('tracks/0')).toBeUndefined();
		});
	});

	describe('patchLoopWindowFromProperty', () => {
		it('patches the matching entry by clip_path', () => {
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: 0,
				isAudioClip: false,
				filePath: '',
				lengthBeats: 8,
				loopStartBeats: 0,
				loopEndBeats: 8,
				looping: false,
				status: 1
			});
			applyPlayingSlot({
				trackPath: 'tracks/1',
				slotIdx: 0,
				isAudioClip: false,
				filePath: '',
				lengthBeats: 8,
				loopStartBeats: 0,
				loopEndBeats: 8,
				looping: false,
				status: 1
			});

			patchLoopWindowFromProperty({
				clipPath: 'tracks/1/slots/0/clip',
				loopStartBeats: 2,
				loopEndBeats: 4
			});
			expect(playingClipsStore.get('tracks/0')!.loopEndBeats).toBe(8);
			expect(playingClipsStore.get('tracks/1')!.loopStartBeats).toBe(2);
			expect(playingClipsStore.get('tracks/1')!.loopEndBeats).toBe(4);
		});

		it('updates the looping flag in isolation', () => {
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: 0,
				isAudioClip: false,
				filePath: '',
				lengthBeats: 8,
				loopStartBeats: 2,
				loopEndBeats: 6,
				looping: false,
				status: 1
			});
			patchLoopWindowFromProperty({
				clipPath: 'tracks/0/slots/0/clip',
				looping: true
			});
			expect(playingClipsStore.get('tracks/0')!.looping).toBe(true);
			expect(playingClipsStore.get('tracks/0')!.loopStartBeats).toBe(2);
		});

		it('is a no-op when no entry matches', () => {
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: 0,
				isAudioClip: false,
				filePath: '',
				lengthBeats: 8,
				loopStartBeats: 0,
				loopEndBeats: 8,
				looping: false,
				status: 1
			});
			expect(() =>
				patchLoopWindowFromProperty({
					clipPath: 'tracks/9/slots/0/clip',
					looping: true
				})
			).not.toThrow();
			expect(playingClipsStore.get('tracks/0')!.looping).toBe(false);
		});

		it('drops the prior reverse-index mapping when the slot rotates', () => {
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: 0,
				isAudioClip: false,
				filePath: '',
				lengthBeats: 8,
				loopStartBeats: 0,
				loopEndBeats: 8,
				looping: false,
				status: 1
			});
			// Rotate to a new slot — the old clipPath should no longer
			// route patches.
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: 3,
				isAudioClip: false,
				filePath: '',
				lengthBeats: 4,
				loopStartBeats: 0,
				loopEndBeats: 4,
				looping: false,
				status: 1
			});
			patchLoopWindowFromProperty({
				clipPath: 'tracks/0/slots/0/clip',
				looping: true
			});
			// Stale clipPath does not patch the now-current slot 3 entry.
			expect(playingClipsStore.get('tracks/0')!.looping).toBe(false);

			// Patches against the *current* clipPath still route.
			patchLoopWindowFromProperty({
				clipPath: 'tracks/0/slots/3/clip',
				looping: true
			});
			expect(playingClipsStore.get('tracks/0')!.looping).toBe(true);
		});

		it('drops the reverse-index mapping when the track stops', () => {
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: 0,
				isAudioClip: false,
				filePath: '',
				lengthBeats: 8,
				loopStartBeats: 0,
				loopEndBeats: 8,
				looping: false,
				status: 1
			});
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: -1,
				isAudioClip: false,
				filePath: '',
				lengthBeats: 0,
				loopStartBeats: 0,
				loopEndBeats: 0,
				looping: false,
				status: 0
			});
			// Routing the prior clipPath now hits an empty entry — store
			// must not throw and must not mutate.
			expect(() =>
				patchLoopWindowFromProperty({
					clipPath: 'tracks/0/slots/0/clip',
					looping: true
				})
			).not.toThrow();
			expect(playingClipsStore.get('tracks/0')!.looping).toBe(false);
		});
	});

	describe('visibleWindow + playheadFraction', () => {
		it('returns the loop range when looping', () => {
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: 0,
				isAudioClip: false,
				filePath: '',
				lengthBeats: 8,
				loopStartBeats: 2,
				loopEndBeats: 6,
				looping: true,
				status: 1
			});
			const entry = playingClipsStore.get('tracks/0')!;
			expect(visibleWindow(entry)).toEqual({
				windowStart: 2,
				windowEnd: 6,
				windowSize: 4
			});
		});

		it('returns the loop fields when not looping — Live puts the markers there', () => {
			// Measured 2026-09-18: a clip looping 0..4 with its end marker at 8
			// read loop_end 8 once looping went off.
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: 0,
				isAudioClip: false,
				filePath: '',
				lengthBeats: 8,
				loopStartBeats: 2,
				loopEndBeats: 6,
				looping: false,
				status: 1
			});
			const entry = playingClipsStore.get('tracks/0')!;
			expect(visibleWindow(entry)).toEqual({
				windowStart: 2,
				windowEnd: 6,
				windowSize: 4
			});
		});

		it('falls back to [0, length] when the loop fields are empty', () => {
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: 0,
				isAudioClip: false,
				filePath: '',
				lengthBeats: 8,
				loopStartBeats: 0,
				loopEndBeats: 0,
				looping: false,
				status: 1
			});
			const entry = playingClipsStore.get('tracks/0')!;
			expect(visibleWindow(entry)).toEqual({ windowStart: 0, windowEnd: 8, windowSize: 8 });
		});

		it('plays an unwarped take marker to marker, in seconds', () => {
			// The rig's Bass take after warping went off: can't loop, start
			// marker 10.16 s, plays to the file's end 17.78 s; `length` stale.
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: 0,
				isAudioClip: true,
				filePath: '/Rec/Bass 0001.aif',
				lengthBeats: 12,
				loopStartBeats: 10.158730158730158,
				loopEndBeats: 17.77777777777778,
				looping: false,
				status: 1,
				fileStartBeats: 0,
				fileEndBeats: 17.77777777777778
			});
			const entry = playingClipsStore.get('tracks/0')!;
			const w = visibleWindow(entry);
			expect(w.windowStart).toBeCloseTo(10.1587, 3);
			expect(w.windowEnd).toBeCloseTo(17.7778, 3);
			expect(playheadFraction(entry, 10.158730158730158)).toBe(0);
		});

		it('keeps the loop window for a looping take whatever its span', () => {
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: 0,
				isAudioClip: true,
				filePath: '/Rec/Bass 0001.aif',
				lengthBeats: 8,
				loopStartBeats: 16,
				loopEndBeats: 24,
				looping: true,
				status: 1,
				fileStartBeats: 0,
				fileEndBeats: 28
			});
			const entry = playingClipsStore.get('tracks/0')!;
			expect(visibleWindow(entry)).toEqual({ windowStart: 16, windowEnd: 24, windowSize: 8 });
		});

		it('maps positionBeats into a [0,1] fraction of the window', () => {
			applyPlayingSlot({
				trackPath: 'tracks/0',
				slotIdx: 0,
				isAudioClip: false,
				filePath: '',
				lengthBeats: 8,
				loopStartBeats: 2,
				loopEndBeats: 6,
				looping: true,
				status: 1
			});
			const entry = playingClipsStore.get('tracks/0')!;
			expect(playheadFraction(entry, 4)).toBeCloseTo(0.5, 5);
			expect(playheadFraction(entry, 2)).toBe(0);
			expect(playheadFraction(entry, 6)).toBe(1);
			expect(playheadFraction(entry, 99)).toBe(1); // clamp
			expect(playheadFraction(entry, -10)).toBe(0); // clamp
		});
	});
});
