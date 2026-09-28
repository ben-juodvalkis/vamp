/**
 * vitest coverage for `/looping/v3/clip/created` + `/clip/removed`.
 *
 * These rode the wire from the surface's per-slot `has_clip` listener
 * with no UI handler at all, so a clip added or deleted in Live never
 * reached the session grid: the companion `state/invalidate` carries a
 * generation and NO paths, and a path-less invalidate drops nothing.
 *
 * What is pinned here is the split the fix rests on — the slot's
 * has/has-not flips LOCALLY and at once (that is what the grid paints),
 * while name and length wait for one debounced `state/resync`, because
 * only a `state/full` carries the C record.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

const sendStateResync = vi.fn();
vi.mock('$lib/api/handlers/v3Handshake', () => ({
	sendStateResync: () => sendStateResync()
}));

const invalidateSample = vi.fn();
vi.mock('$lib/services/clipSampleService', () => ({
	invalidateSample: (path: string) => invalidateSample(path)
}));

import {
	handleV3ClipLifecycle,
	isV3ClipLifecycleAddress,
	_cancelPendingResync,
	V3_CLIP_CREATED_ADDRESS,
	V3_CLIP_REMOVED_ADDRESS
} from '$lib/api/handlers/v3ClipLifecycle';
import {
	v3Store,
	_resetForTests,
	replaceTree,
	type TrackRecord,
	type SlotRecord
} from '$lib/stores/v3/normalized.svelte';
import { SvelteMap } from 'svelte/reactivity';

function seedTrack(trackPath: string, withClipAtSlot0 = false): TrackRecord {
	const slots = new SvelteMap<string, SlotRecord>();
	if (withClipAtSlot0) {
		slots.set(`${trackPath}/slots/0`, {
			slotPath: `${trackPath}/slots/0`,
			state: 'has_clip' as const,
			clip: {
				clipPath: `${trackPath}/slots/0/clip`,
				name: 'Take 1',
				length: 8,
				color: 0,
				pitch: 0,
				properties: new SvelteMap()
			}
		});
	}
	return {
		trackPath,
		name: 'seed',
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
		slots
	};
}

describe('handleV3ClipLifecycle', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		sendStateResync.mockClear();
		invalidateSample.mockClear();
		_resetForTests();
		replaceTree(1, [seedTrack('tracks/0', true), seedTrack('tracks/1')]);
	});

	afterEach(() => {
		_cancelPendingResync();
		vi.useRealTimers();
	});

	it('claims both structural addresses and nothing else', () => {
		expect(isV3ClipLifecycleAddress(V3_CLIP_CREATED_ADDRESS)).toBe(true);
		expect(isV3ClipLifecycleAddress(V3_CLIP_REMOVED_ADDRESS)).toBe(true);
		// Properties of a clip that already exists belong to handleV3Clip.
		expect(isV3ClipLifecycleAddress('/looping/v3/clip/property')).toBe(false);
		expect(isV3ClipLifecycleAddress('/looping/v3/clip/triggered')).toBe(false);
	});

	it('empties the slot on removed, so the deleted clip leaves the grid', () => {
		handleV3ClipLifecycle(V3_CLIP_REMOVED_ADDRESS, ['tracks/0/slots/0', 7]);
		const slot = v3Store.tracks.get('tracks/0')?.slots.get('tracks/0/slots/0');
		expect(slot?.state).toBe('empty');
		expect(slot?.clip).toBeUndefined();
	});

	it('drops the removed clip from the sample cache (the path gets reused)', () => {
		handleV3ClipLifecycle(V3_CLIP_REMOVED_ADDRESS, ['tracks/0/slots/0', 7]);
		expect(invalidateSample).toHaveBeenCalledWith('tracks/0/slots/0/clip');
	});

	it('fills an empty slot on created, without waiting for a state/full', () => {
		handleV3ClipLifecycle(V3_CLIP_CREATED_ADDRESS, ['tracks/1/slots/2', 7]);
		const slot = v3Store.tracks.get('tracks/1')?.slots.get('tracks/1/slots/2');
		expect(slot?.state).toBe('has_clip');
		// A placeholder: the wire carries no name/length, the resync does.
		expect(slot?.clip?.clipPath).toBe('tracks/1/slots/2/clip');
		expect(slot?.clip?.name).toBe('');
	});

	it('never blanks a name it already has', () => {
		handleV3ClipLifecycle(V3_CLIP_CREATED_ADDRESS, ['tracks/0/slots/0', 7]);
		const slot = v3Store.tracks.get('tracks/0')?.slots.get('tracks/0/slots/0');
		expect(slot?.clip?.name).toBe('Take 1');
		expect(slot?.clip?.length).toBe(8);
	});

	it('asks for exactly one resync per burst', () => {
		// A scene duplicate flips every slot it touches.
		handleV3ClipLifecycle(V3_CLIP_CREATED_ADDRESS, ['tracks/0/slots/1', 7]);
		handleV3ClipLifecycle(V3_CLIP_CREATED_ADDRESS, ['tracks/1/slots/1', 7]);
		handleV3ClipLifecycle(V3_CLIP_CREATED_ADDRESS, ['tracks/1/slots/2', 7]);
		expect(sendStateResync).not.toHaveBeenCalled();
		vi.advanceTimersByTime(300);
		expect(sendStateResync).toHaveBeenCalledTimes(1);
	});

	it('drops a payload with no slotPath rather than half-applying', () => {
		handleV3ClipLifecycle(V3_CLIP_CREATED_ADDRESS, []);
		vi.advanceTimersByTime(300);
		expect(sendStateResync).not.toHaveBeenCalled();
	});

	it('no-ops on an unknown track, and still reconciles', () => {
		handleV3ClipLifecycle(V3_CLIP_CREATED_ADDRESS, ['tracks/99/slots/0', 7]);
		expect(v3Store.tracks.get('tracks/99')).toBeUndefined();
		vi.advanceTimersByTime(300);
		// "Already knew" and "never heard of it" both deserve the resync.
		expect(sendStateResync).toHaveBeenCalledTimes(1);
	});
});
