/**
 * fxGridStore.loadDevice — guitar/bass auto-rename guard.
 *
 * Loading a `guitar` or `bass` effect renames the selected track, but
 * only when that track is an *audio* track. Adding either effect to a
 * MIDI track (e.g. a Mic track), a track whose type is unknown, or the
 * master must leave the existing name untouched. Other device types
 * never trigger the rename.
 *
 * The guard lives in `FXGridState.loadDevice` and reads
 * `selectedTrackStore.trackType` (derived from the v3 store's
 * `hasMidiInput` / `hasAudioInput` flags).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Module-scope mocks ------------------------------------------------

vi.mock('$lib/api/simpleClient', () => ({
	send: vi.fn()
}));

vi.mock('$lib/services/trackCommands', () => ({
	setTrackName: vi.fn()
}));

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

vi.mock('$lib/stores/v6/slotRegistry.svelte', () => ({
	slotRegistry: {
		resetForTrackChange: vi.fn(),
		getAllSlots: vi.fn(() => new Map()),
		getPositionForDeviceType: vi.fn(() => null),
		getDeviceTypeForPosition: vi.fn(() => null)
	}
}));

// Imports after the mocks so the real modules see the shims.
// `fxGrid` is constructed in selectedTrackStore.svelte (fxGridStore only
// re-exports it); import both from there so that module — and the
// FXGridState class it depends on — evaluates in the right order under
// the fxGridStore <-> selectedTrackStore import cycle.
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { setTrackName } from '$lib/services/trackCommands';
import { DEVICE_PRESETS } from '$lib/config/devicePresets';
import {
	replaceTree,
	_resetForTests,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';

const setTrackNameMock = vi.mocked(setTrackName);

// ------------------------------------------------------------------
// Fixture helper — minimal TrackRecord with a chosen I/O shape.
// ------------------------------------------------------------------

function mkTrack(
	trackPath: string,
	hasMidiInput: boolean,
	hasAudioInput: boolean
): TrackRecord {
	return {
		trackPath,
		name: trackPath,
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput,
		hasAudioInput,
		hasArrangementClips: false,
		// ADR-410: plain top-level track (not a group, not folded, no parent).
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		devices: new Map(),
		slots: new Map()
	};
}

// ------------------------------------------------------------------
// Suite
// ------------------------------------------------------------------

describe('fxGridStore.loadDevice — guitar/bass rename guard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		// resetForTrackChange clears any 'loading' slot state + pending
		// timeouts from a prior loadDevice so each test starts from 'ghost'
		// (loadDevice early-returns when a slot is still 'loading').
		fxGrid.resetForTrackChange();
		selectedTrackStore.handleTrackSelected(0);
	});

	afterEach(() => {
		// Drop the 10s load-timeout the final loadDevice armed.
		fxGrid.resetForTrackChange();
	});

	it('renames an audio track to "Guitar" when loading the guitar effect', async () => {
		replaceTree(1, [mkTrack('tracks/0', false, true)]);
		selectedTrackStore.handleTrackSelected(0);

		await fxGrid.loadDevice('guitar');

		expect(setTrackNameMock).toHaveBeenCalledTimes(1);
		expect(setTrackNameMock).toHaveBeenCalledWith(
			'tracks/0',
			DEVICE_PRESETS.guitar.defaultName
		);
	});

	it('renames an audio track to "Bass" when loading the bass effect', async () => {
		replaceTree(1, [mkTrack('tracks/0', false, true)]);
		selectedTrackStore.handleTrackSelected(0);

		await fxGrid.loadDevice('bass');

		// Bass is the Bass Amp rack (defaultName "Bass Amp"), so
		// the rename uses the literal "Bass" rather than config.defaultName.
		expect(setTrackNameMock).toHaveBeenCalledTimes(1);
		expect(setTrackNameMock).toHaveBeenCalledWith('tracks/0', 'Bass');
	});

	it('does NOT rename a MIDI track when loading the guitar effect', async () => {
		replaceTree(1, [mkTrack('tracks/0', true, false)]);
		selectedTrackStore.handleTrackSelected(0);

		await fxGrid.loadDevice('guitar');

		expect(setTrackNameMock).not.toHaveBeenCalled();
	});

	it('does NOT rename a MIDI track when loading the bass effect', async () => {
		replaceTree(1, [mkTrack('tracks/0', true, false)]);
		selectedTrackStore.handleTrackSelected(0);

		await fxGrid.loadDevice('bass');

		expect(setTrackNameMock).not.toHaveBeenCalled();
	});

	it('does NOT rename an External Instrument track (both I/O flags set)', async () => {
		// hasMidiInput dominates → trackType is "midi", so no rename.
		replaceTree(1, [mkTrack('tracks/0', true, true)]);
		selectedTrackStore.handleTrackSelected(0);

		await fxGrid.loadDevice('guitar');

		expect(setTrackNameMock).not.toHaveBeenCalled();
	});

	it('does NOT rename when the track type is unknown (track absent from v3 tree)', async () => {
		// No replaceTree → trackType resolves to null. The === 'audio'
		// guard skips the rename rather than renaming on an unknown type.
		await fxGrid.loadDevice('guitar');

		expect(setTrackNameMock).not.toHaveBeenCalled();
	});

	it('does NOT rename the master track even though its trackType is "audio"', async () => {
		// Live's master reports has_audio_input=true, but its path is
		// "master" (not "tracks/N") and is read-only on the wire.
		replaceTree(1, [mkTrack('master', false, true)]);
		selectedTrackStore.handleTrackSelected(-1);
		expect(selectedTrackStore.selectedTrackPath).toBe('master');
		expect(selectedTrackStore.trackType).toBe('audio');

		await fxGrid.loadDevice('guitar');

		expect(setTrackNameMock).not.toHaveBeenCalled();
	});

	it('does NOT rename for a non-guitar/bass device on an audio track', async () => {
		replaceTree(1, [mkTrack('tracks/0', false, true)]);
		selectedTrackStore.handleTrackSelected(0);

		await fxGrid.loadDevice('echo');

		expect(setTrackNameMock).not.toHaveBeenCalled();
	});
});
