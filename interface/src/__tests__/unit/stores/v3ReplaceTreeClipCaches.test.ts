/**
 * A clip path is a position, so a track reorder puts a different clip
 * behind the same path. `replaceTree` has to drop what the notes cache
 * holds for that path and tell its mounted views to re-pull — otherwise
 * each strip keeps drawing the clip that used to sit at its index (seen
 * on the rig 2026-10-19 after grouping two tracks).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SvelteMap } from 'svelte/reactivity';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
	_resetForTests,
	replaceTree,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import {
	__resetClipNotesServiceForTests,
	handleNotesReply,
	requestNotes,
	setNotesSender,
	subscribeNotesChanged
} from '$lib/services/clipNotesService';

function mkTrack(idx: number, name: string, clipName: string, length = 16): TrackRecord {
	const slotPath = `tracks/${idx}/slots/0`;
	return {
		trackPath: `tracks/${idx}`,
		name,
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		devices: new SvelteMap(),
		slots: new SvelteMap([
			[
				slotPath,
				{
					slotPath,
					state: 'has_clip',
					clip: {
						clipPath: `${slotPath}/clip`,
						name: clipName,
						length,
						color: 0,
						pitch: 0,
						properties: new SvelteMap()
					}
				}
			]
		])
	};
}

const PATH = 'tracks/2/slots/0/clip';
let sent: string[];

/** Fill the notes cache for PATH, answering with one note at `pitch`. */
async function cacheNotes(pitch: number): Promise<void> {
	const p = requestNotes(PATH);
	const blob = new Uint8Array(new Float32Array([pitch, 0, 1, 100]).buffer);
	handleNotesReply({ requestId: lastRequestId, clipPath: PATH, count: 1, blob });
	await p;
}
let lastRequestId = '';

beforeEach(() => {
	_resetForTests();
	__resetClipNotesServiceForTests();
	sent = [];
	setNotesSender((clipPath, requestId) => {
		sent.push(clipPath);
		lastRequestId = requestId;
	});
});

describe('replaceTree and the clip-contents caches', () => {
	it('a different track at the same path drops its cached notes and re-pulls', async () => {
		replaceTree(1, [mkTrack(2, 'Clyde', 'Clyde 12')]);
		await cacheNotes(60);
		const repull = vi.fn();
		subscribeNotesChanged(PATH, repull);

		// The reorder: 70s Tight now sits where Clyde was.
		replaceTree(2, [mkTrack(2, '70s Tight', '70s Tight 2')]);

		expect(repull).toHaveBeenCalledTimes(1);
		sent = [];
		void requestNotes(PATH);
		expect(sent).toEqual([PATH]);
	});

	it('a renamed track drops the cache even when its clip matches by name and length', async () => {
		replaceTree(1, [mkTrack(2, 'A', 'Clip', 16)]);
		await cacheNotes(60);
		replaceTree(2, [mkTrack(2, 'B', 'Clip', 16)]);
		sent = [];
		void requestNotes(PATH);
		expect(sent).toEqual([PATH]);
	});

	it('a track that lands on a new path drops whatever was cached there', async () => {
		replaceTree(1, [mkTrack(2, 'Old', 'Old clip')]);
		await cacheNotes(60);
		replaceTree(2, []);
		replaceTree(3, [mkTrack(2, 'New', 'New clip')]);
		sent = [];
		void requestNotes(PATH);
		expect(sent).toEqual([PATH]);
	});

	it('an unchanged tree keeps the cache and fires no re-pull', async () => {
		replaceTree(1, [mkTrack(2, 'Clyde', 'Clyde 12')]);
		await cacheNotes(60);
		const repull = vi.fn();
		subscribeNotesChanged(PATH, repull);

		replaceTree(2, [mkTrack(2, 'Clyde', 'Clyde 12')]);

		expect(repull).not.toHaveBeenCalled();
		sent = [];
		void requestNotes(PATH);
		expect(sent).toEqual([]);
	});
});
