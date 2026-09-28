/**
 * vitest coverage for the ADR-410 fold-state wire.
 *
 * `/looping/v3/track/fold_state [trackPath, flag]` — the inbound leg,
 * emitted by `TrackMetadataComponent` on the Python surface both when
 * the user folds a group in Live's own UI (detected via the song-scoped
 * `visible_tracks` observable, because `Track` exposes no
 * `add_fold_state_listener`) and as the write-path echo of our own
 * `/looping/v3/track/set/fold_state`.
 *
 * The cold-start value rides the T-record (arity 13 offset 11) and is
 * covered by the parser tests in `v3StateFull.test.ts`; this file
 * covers only the focused-address path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
	handleV3TrackFoldState,
	V3_TRACK_FOLD_STATE_ADDRESS
} from '$lib/api/handlers/v3TrackFoldState';
import {
	v3Store,
	_resetForTests,
	replaceTree,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import { logger } from '$lib/utils/logger';
import { SvelteMap } from 'svelte/reactivity';

function group(trackPath: string, foldState = false): TrackRecord {
	return {
		trackPath,
		name: 'G',
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: false,
		// A group reports audio input — see ADR-410.
		hasAudioInput: true,
		hasArrangementClips: false,
		isFoldable: true,
		foldState,
		groupTrackIndex: -1,
		role: '',
		devices: new SvelteMap(),
		slots: new SvelteMap()
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
	replaceTree(1, [group('tracks/0')]);
});

describe('handleV3TrackFoldState', () => {
	it('exposes the documented wire address', () => {
		expect(V3_TRACK_FOLD_STATE_ADDRESS).toBe('/looping/v3/track/fold_state');
	});

	it('applies flag=1 as folded', () => {
		handleV3TrackFoldState(['tracks/0', 1]);
		expect(v3Store.tracks.get('tracks/0')?.foldState).toBe(true);
	});

	it('applies flag=0 as unfolded', () => {
		handleV3TrackFoldState(['tracks/0', 1]);
		handleV3TrackFoldState(['tracks/0', 0]);
		expect(v3Store.tracks.get('tracks/0')?.foldState).toBe(false);
	});

	it('preserves the rest of the record', () => {
		handleV3TrackFoldState(['tracks/0', 1]);
		const rec = v3Store.tracks.get('tracks/0');
		expect(rec?.name).toBe('G');
		expect(rec?.isFoldable).toBe(true);
		expect(rec?.groupTrackIndex).toBe(-1);
	});

	it('does NOT advance generation — a fold is not a structural change', () => {
		const before = v3Store.generation;
		handleV3TrackFoldState(['tracks/0', 1]);
		expect(v3Store.generation).toBe(before);
	});

	it('warns and drops a short payload', () => {
		handleV3TrackFoldState(['tracks/0']);
		expect(v3Store.tracks.get('tracks/0')?.foldState).toBe(false);
		expect(logger.warn).toHaveBeenCalledWith(
			'v3 track fold_state missing args',
			expect.any(Object)
		);
	});

	it('drops an unknown trackPath without throwing', () => {
		expect(() => handleV3TrackFoldState(['tracks/99', 1])).not.toThrow();
	});

	it('drops master (groups are regular tracks only)', () => {
		expect(() => handleV3TrackFoldState(['master', 1])).not.toThrow();
	});

	it('coerces boolean and string wire encodings', () => {
		handleV3TrackFoldState(['tracks/0', true]);
		expect(v3Store.tracks.get('tracks/0')?.foldState).toBe(true);
		handleV3TrackFoldState(['tracks/0', '0']);
		expect(v3Store.tracks.get('tracks/0')?.foldState).toBe(false);
	});
});
