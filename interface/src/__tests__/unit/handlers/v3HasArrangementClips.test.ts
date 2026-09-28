/**
 * vitest coverage for the PR-7c pr7c-5 focused-address handler.
 *
 * `/looping/v3/track/has_arrangement_clips [trackPath, flag]` —
 * emit-only inbound path from `TrackMetadataComponent.arrangement_clips`
 * on the Python surface. Writes through `applyHasArrangementClips`
 * into the v3 normalized store's `TrackRecord.hasArrangementClips`
 * field. No generation advance UI-side (rule #3, trust the echo).
 *
 * The cold-start path (T-record arity 9 offset 8) is covered by the
 * parser tests in `v3StateFull.test.ts`; this file covers only the
 * listener-fire path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

import {
	handleV3HasArrangementClips,
	V3_TRACK_HAS_ARRANGEMENT_CLIPS_ADDRESS
} from '$lib/api/handlers/v3HasArrangementClips';
import {
	v3Store,
	_resetForTests,
	replaceTree,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import { SvelteMap } from 'svelte/reactivity';

function seedTrack(
	trackPath: string,
	hasArrangementClips = false
): TrackRecord {
	return {
		trackPath,
		name: 'seed',
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips,
		// ADR-410: plain top-level track (not a group, not folded, no parent).
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		devices: new SvelteMap(),
		slots: new SvelteMap()
	};
}

describe('handleV3HasArrangementClips', () => {
	beforeEach(() => {
		_resetForTests();
		replaceTree(1, [seedTrack('tracks/0'), seedTrack('tracks/1', true)]);
	});

	it('exposes the focused address as a module constant', () => {
		expect(V3_TRACK_HAS_ARRANGEMENT_CLIPS_ADDRESS).toBe(
			'/looping/v3/track/has_arrangement_clips'
		);
	});

	it('flips hasArrangementClips false → true on flag=1', () => {
		handleV3HasArrangementClips(['tracks/0', 1]);
		expect(v3Store.tracks.get('tracks/0')?.hasArrangementClips).toBe(true);
		// Untouched track unchanged.
		expect(v3Store.tracks.get('tracks/1')?.hasArrangementClips).toBe(true);
	});

	it('flips hasArrangementClips true → false on flag=0', () => {
		handleV3HasArrangementClips(['tracks/1', 0]);
		expect(v3Store.tracks.get('tracks/1')?.hasArrangementClips).toBe(false);
	});

	it('accepts boolean wire form (defense-in-depth for non-OSC test paths)', () => {
		handleV3HasArrangementClips(['tracks/0', true]);
		expect(v3Store.tracks.get('tracks/0')?.hasArrangementClips).toBe(true);
		handleV3HasArrangementClips(['tracks/0', false]);
		expect(v3Store.tracks.get('tracks/0')?.hasArrangementClips).toBe(false);
	});

	it('preserves nested Map identity on re-insert (ADR-003)', () => {
		const prev = v3Store.tracks.get('tracks/0')!;
		const prevDevices = prev.devices;
		const prevSlots = prev.slots;
		handleV3HasArrangementClips(['tracks/0', 1]);
		const next = v3Store.tracks.get('tracks/0')!;
		expect(next.devices).toBe(prevDevices);
		expect(next.slots).toBe(prevSlots);
	});

	it('skips re-insert when value is unchanged (no-op write)', () => {
		const prev = v3Store.tracks.get('tracks/0')!;
		handleV3HasArrangementClips(['tracks/0', 0]);
		// Same record reference — no spread, no set.
		expect(v3Store.tracks.get('tracks/0')).toBe(prev);
	});

	it('drops silently for master path (structural zero only)', () => {
		replaceTree(2, [
			{ ...seedTrack('master'), trackPath: 'master' },
			seedTrack('tracks/0')
		]);
		const before = v3Store.tracks.get('master');
		handleV3HasArrangementClips(['master', 1]);
		// Unchanged — master doesn't carry a meaningful arrangement flag.
		expect(v3Store.tracks.get('master')).toBe(before);
	});

	it('drops silently for returns/<N> path', () => {
		handleV3HasArrangementClips(['returns/0', 1]);
		expect(v3Store.tracks.get('returns/0')).toBeUndefined();
	});

	it('drops silently for unknown trackPath (benign race)', () => {
		const before = v3Store.tracks.get('tracks/0');
		handleV3HasArrangementClips(['tracks/999', 1]);
		expect(v3Store.tracks.get('tracks/0')).toBe(before);
		expect(v3Store.tracks.get('tracks/999')).toBeUndefined();
	});

	it('drops silently on short args (missing flag)', () => {
		const before = v3Store.tracks.get('tracks/0')!;
		handleV3HasArrangementClips(['tracks/0']);
		expect(v3Store.tracks.get('tracks/0')).toBe(before);
	});

	it('drops silently on empty args', () => {
		const before = v3Store.tracks.get('tracks/0')!;
		handleV3HasArrangementClips([]);
		expect(v3Store.tracks.get('tracks/0')).toBe(before);
	});

	it('state/full re-emit at arity 9 matches listener-fire value (ADR-003)', () => {
		// Listener fire first: flag=1.
		handleV3HasArrangementClips(['tracks/0', 1]);
		const afterFire = v3Store.tracks.get('tracks/0')!;
		expect(afterFire.hasArrangementClips).toBe(true);
		const devicesRef = afterFire.devices;
		const slotsRef = afterFire.slots;

		// Simulate the state/full that Python emits after the
		// `arrangement-clips-changed` generation advance: same T record
		// but now with hasArrangementClips=true.
		replaceTree(2, [
			{ ...seedTrack('tracks/0'), hasArrangementClips: true },
			seedTrack('tracks/1', true)
		]);
		const afterFull = v3Store.tracks.get('tracks/0')!;
		// Scalars equal → reconcile skipped the re-insert; same record ref.
		expect(afterFull).toBe(afterFire);
		// Nested Maps identity preserved (defense-in-depth — same ref also
		// implies same nested collections, but pin it explicitly).
		expect(afterFull.devices).toBe(devicesRef);
		expect(afterFull.slots).toBe(slotsRef);
	});
});
