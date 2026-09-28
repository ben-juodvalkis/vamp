/**
 * vitest coverage for ADR-410 group-awareness in `clipStateStore`.
 *
 * Two behaviours, both driven by the same LOM fact: **a Group Track
 * reports `hasAudioInput === true` and never reports a clip of its
 * own** (its `clip_slots` mirror the scene row but are never
 * `has_clip`). Verified against Live 12.4.5b8 via
 * `/looping/probe/lom_introspect`.
 *
 * 1. `getVisibleTracks` drops tracks hidden inside a folded group, in
 *    both filter modes.
 * 2. `emptyMidiTracks` / `emptyAudioTracks` never offer a group as a
 *    reuse target — without the guard, every group looks exactly like
 *    an empty audio track and would get an instrument loaded onto it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { clipStateStore } from '$lib/stores/v6/clipStateStore.svelte';
import {
	_resetForTests,
	replaceTree,
	applyTrackFoldState,
	type TrackRecord,
	type SlotRecord,
	type DeviceRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';
import { SvelteMap } from 'svelte/reactivity';

interface TrackOpts {
	isFoldable?: boolean;
	foldState?: boolean;
	groupTrackIndex?: number;
	hasMidiInput?: boolean;
	hasAudioInput?: boolean;
	slots?: SlotRecord[];
	devices?: DeviceRecord[];
}

function track(index: number, opts: TrackOpts = {}): TrackRecord {
	const trackPath = `tracks/${index}`;
	return {
		trackPath,
		name: `t${index}`,
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: opts.hasMidiInput ?? false,
		// Default true: a group reports audio input, and so do the plain
		// audio tracks these fixtures model.
		hasAudioInput: opts.hasAudioInput ?? true,
		hasArrangementClips: false,
		isFoldable: opts.isFoldable ?? false,
		foldState: opts.foldState ?? false,
		groupTrackIndex: opts.groupTrackIndex ?? -1,
		role: '',
		devices: new SvelteMap((opts.devices ?? []).map((d) => [d.devicePath, d])),
		slots: new SvelteMap((opts.slots ?? []).map((s) => [s.slotPath, s]))
	};
}

function param(devicePath: string, index: number, name: string): [string, ParamRecord] {
	const paramPath = `${devicePath}/params/${index}`;
	return [paramPath, { paramPath, name, displayName: name, min: 0, max: 127, value: 0, unit: '' }];
}

/** An Instrument Rack shaped like the Skaka Metronome Rack: macro 1
 * named "Pattern N" -- the structural test `isMetronomeTrackFromV3`
 * (`clipStateStore.svelte.ts`) uses, in place of the literal name. */
function metronomeDevice(devicePath: string): DeviceRecord {
	return {
		devicePath,
		name: 'Skaka Metronome Rack',
		className: 'InstrumentGroupDevice',
		params: new SvelteMap([
			param(devicePath, 0, 'Device On'),
			param(devicePath, 1, 'Pattern 4'),
			param(devicePath, 2, 'Offset')
		]),
		properties: new SvelteMap()
	};
}

function slot(trackIndex: number, slotIndex: number, state: SlotRecord['state']) {
	return { slotPath: `tracks/${trackIndex}/slots/${slotIndex}`, state };
}

/**
 * Mirrors the user's real set at the time of ADR-410:
 * tracks/0 is "1-Group" holding tracks 1–3; 4 and 5 sit outside it.
 */
function seedFlatGroup(folded: boolean) {
	replaceTree(1, [
		track(0, { isFoldable: true, foldState: folded }),
		track(1, { groupTrackIndex: 0 }),
		track(2, { groupTrackIndex: 0 }),
		track(3, { groupTrackIndex: 0 }),
		track(4),
		track(5)
	]);
}

beforeEach(() => {
	_resetForTests();
	clipStateStore.filterMode = 'all';
});

describe('getVisibleTracks — folded groups (filterMode: all)', () => {
	it('shows every track when the group is open', () => {
		seedFlatGroup(false);
		expect(clipStateStore.getVisibleTracks(6, 0)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('hides the group members when the group is folded', () => {
		seedFlatGroup(true);
		expect(clipStateStore.getVisibleTracks(6, 0)).toEqual([0, 4, 5]);
	});

	it('keeps the group itself visible when folded so it can be reopened', () => {
		seedFlatGroup(true);
		expect(clipStateStore.getVisibleTracks(6, 0)).toContain(0);
	});

	it('reacts to a fold echo without a state/full republish', () => {
		// The whole point of the focused `/looping/v3/track/fold_state`
		// wire: one flag flip hides every descendant.
		seedFlatGroup(false);
		expect(clipStateStore.getVisibleTracks(6, 0)).toHaveLength(6);
		applyTrackFoldState('tracks/0', true);
		expect(clipStateStore.getVisibleTracks(6, 0)).toEqual([0, 4, 5]);
		applyTrackFoldState('tracks/0', false);
		expect(clipStateStore.getVisibleTracks(6, 0)).toHaveLength(6);
	});

	it('hides a grandchild when only the outer group is folded', () => {
		replaceTree(1, [
			track(0, { isFoldable: true, foldState: true }),
			track(1, { isFoldable: true, foldState: false, groupTrackIndex: 0 }),
			track(2, { groupTrackIndex: 1 }),
			track(3)
		]);
		expect(clipStateStore.getVisibleTracks(4, 0)).toEqual([0, 3]);
	});
});

describe('getVisibleTracks — folded groups (filterMode: active)', () => {
	beforeEach(() => {
		clipStateStore.filterMode = 'active';
	});

	it('drops a clip-bearing track that is inside a folded group', () => {
		// `active` mode would normally include track 1 (it has a clip).
		// The fold filter runs last and outranks that.
		replaceTree(1, [
			track(0, { isFoldable: true, foldState: true }),
			track(1, { groupTrackIndex: 0, slots: [slot(1, 0, 'has_clip')] }),
			track(2, { slots: [slot(2, 0, 'has_clip')] })
		]);
		expect(clipStateStore.getVisibleTracks(3, 2)).toEqual([0, 2]);
	});

	it('drops the SELECTED track when it is folded away', () => {
		// Matches Live: folding a group hides the selected child too,
		// rather than leaving an orphan strip with no visible parent.
		replaceTree(1, [
			track(0, { isFoldable: true, foldState: true }),
			track(1, { groupTrackIndex: 0 }),
			track(2)
		]);
		expect(clipStateStore.getVisibleTracks(3, 1)).not.toContain(1);
	});
});

describe('empty-track reuse lists never offer a group or the metronome track', () => {
	it('excludes a group from emptyAudioTracks', () => {
		// A group has audio input and no clips of its own — without the
		// isFoldable guard it is indistinguishable from an empty audio
		// track, and a preset load would land an instrument on the bus.
		replaceTree(1, [
			track(0),
			track(1, { isFoldable: true }),
			track(2)
		]);
		expect(clipStateStore.emptyAudioTracks).toEqual([2]);
	});

	it('excludes a group from emptyMidiTracks', () => {
		replaceTree(1, [
			track(0),
			track(1, { isFoldable: true, hasMidiInput: true }),
			track(2, { hasMidiInput: true, hasAudioInput: false })
		]);
		expect(clipStateStore.emptyMidiTracks).toEqual([2]);
	});

	it('still lists ordinary empty audio tracks', () => {
		replaceTree(1, [track(0), track(1), track(2)]);
		expect(clipStateStore.emptyAudioTracks).toEqual([1, 2]);
	});

	it('still excludes tracks that hold a clip', () => {
		replaceTree(1, [
			track(0),
			track(1, { slots: [slot(1, 0, 'has_clip')] }),
			track(2)
		]);
		expect(clipStateStore.emptyAudioTracks).toEqual([2]);
	});

	it('excludes the metronome track wherever it sits, not just at index 0', () => {
		// The metronome rack generates its own notes off the transport, so
		// it carries no clips of its own and would otherwise read as an
		// ordinary empty track the moment it is grouped or moved off the
		// index-0 carve-out this exclusion doesn't rely on.
		replaceTree(1, [
			track(0),
			track(1),
			track(2, { devices: [metronomeDevice('tracks/2/devices/0')] }),
			track(3)
		]);
		expect(clipStateStore.emptyAudioTracks).toEqual([1, 3]);
	});

	it('does not exclude an ordinary rack that merely has an unrelated macro 1 name', () => {
		replaceTree(1, [
			track(0),
			track(1, {
				devices: [
					{
						devicePath: 'tracks/1/devices/0',
						name: 'Bass Rack',
						className: 'InstrumentGroupDevice',
						params: new SvelteMap([param('tracks/1/devices/0', 0, 'Device On'), param('tracks/1/devices/0', 1, 'Filter')]),
						properties: new SvelteMap()
					}
				]
			})
		]);
		expect(clipStateStore.emptyAudioTracks).toEqual([1]);
	});
});

describe('group predicates', () => {
	it('isGroupTrack is true only for foldable tracks', () => {
		seedFlatGroup(false);
		expect(clipStateStore.isGroupTrack(0)).toBe(true);
		expect(clipStateStore.isGroupTrack(1)).toBe(false);
	});

	it('isGroupFolded tracks the fold flag', () => {
		seedFlatGroup(false);
		expect(clipStateStore.isGroupFolded(0)).toBe(false);
		applyTrackFoldState('tracks/0', true);
		expect(clipStateStore.isGroupFolded(0)).toBe(true);
	});

	it('both predicates are false for an unknown index', () => {
		seedFlatGroup(false);
		expect(clipStateStore.isGroupTrack(99)).toBe(false);
		expect(clipStateStore.isGroupFolded(99)).toBe(false);
	});
});
