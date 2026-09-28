/**
 * PR-3.5.7-impl tests — `selectedTrackStore` path-keyed property API.
 *
 * Covers the three new public methods:
 *
 * - `propertyValue(devicePath, propertyName)` — reads from
 *   `v3Store.deviceByPath`; no v2 fallback.
 * - `setPropertyValue(devicePath, propertyName, value)` —
 *   optimistic-write into the store, then emits
 *   `/looping/v3/property/set [devicePath, propertyName, value, generation]`.
 *   Drops silently when generation is still UNSET.
 * - `subscribeProperty(devicePath, propertyName)` — `$effect`-cleanup
 *   helper that calls the refcounted manager's acquire on attach and
 *   returns its release for teardown.
 *
 * @see Looping's documentation/archive/m4l-to-python-v3/05-migration-plan.md §3.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module-scope mocks ------------------------------------------------

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

vi.mock('$lib/services/instrumentService', () => ({
	instrumentService: {
		identifyInstrumentType: vi.fn(() => 'unknown')
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

// Mock the refcount manager so we can assert `subscribeProperty`
// wires `acquire` on attach and `release` on teardown without
// stubbing the wire side. The real manager is exercised in
// `propertySubscriptions.test.ts`.
vi.mock('$lib/stores/v3/propertySubscriptions.svelte', () => ({
	acquire: vi.fn(),
	release: vi.fn()
}));

// Imports after the mocks so the real modules see the shims.
import { SvelteMap } from 'svelte/reactivity';
import type { OSCArg } from '$lib/types/osc';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { send } from '$lib/api/simpleClient';
import {
	replaceTree,
	_resetForTests,
	type TrackRecord,
	type DeviceRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';
import {
	acquire as acquireMock,
	release as releaseMock
} from '$lib/stores/v3/propertySubscriptions.svelte';

// ------------------------------------------------------------------
// Fixture helpers
// ------------------------------------------------------------------

function mkTrackWithProperty(
	trackIdx: number,
	deviceIdx: number,
	properties: Record<string, OSCArg> = {}
): TrackRecord {
	const trackPath = `tracks/${trackIdx}`;
	const devicePath = `${trackPath}/devices/${deviceIdx}`;
	return {
		trackPath,
		name: `t${trackIdx}`,
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		// ADR-410: plain top-level track (not a group, not folded, no parent).
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		// SvelteMap throughout per ADR-002 — the property `.set()` in
		// `applyPropertyValue` must fire `$derived` consumers reactively.
		devices: new SvelteMap<string, DeviceRecord>([
			[
				devicePath,
				{
					devicePath,
					name: 'Simpler',
					className: 'Simpler',
					params: new SvelteMap<string, ParamRecord>(),
					properties: new SvelteMap<string, OSCArg>(Object.entries(properties))
				}
			]
		]),
		slots: new SvelteMap()
	};
}

// ------------------------------------------------------------------
// Suite
// ------------------------------------------------------------------

describe('selectedTrackStore property API (PR-3.5.7-impl)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		selectedTrackStore.handleTrackSelected(0);
	});

	describe('propertyValue()', () => {
		it('reads the value from v3Store.deviceByPath.properties', () => {
			replaceTree(5, [
				mkTrackWithProperty(3, 2, { playback_mode: 1, 'sample.gain': 0.42 })
			]);

			expect(
				selectedTrackStore.propertyValue('tracks/3/devices/2', 'playback_mode')
			).toBe(1);
			expect(
				selectedTrackStore.propertyValue('tracks/3/devices/2', 'sample.gain')
			).toBe(0.42);
		});

		it('returns undefined when devicePath is not in the tree', () => {
			replaceTree(5, [mkTrackWithProperty(3, 2, { playback_mode: 1 })]);

			expect(
				selectedTrackStore.propertyValue('tracks/99/devices/0', 'playback_mode')
			).toBeUndefined();
		});

		it('returns undefined when propertyName has not been set yet', () => {
			replaceTree(5, [mkTrackWithProperty(3, 2)]);

			expect(
				selectedTrackStore.propertyValue('tracks/3/devices/2', 'playback_mode')
			).toBeUndefined();
		});
	});

	describe('setPropertyValue()', () => {
		it('emits /looping/v3/property/set with [devicePath, propertyName, value, generation]', () => {
			replaceTree(42, [mkTrackWithProperty(3, 2)]);

			selectedTrackStore.setPropertyValue(
				'tracks/3/devices/2',
				'playback_mode',
				2
			);

			expect(send).toHaveBeenCalledTimes(1);
			expect(send).toHaveBeenCalledWith('/looping/v3/property/set', [
				'tracks/3/devices/2',
				'playback_mode',
				2,
				42
			]);
		});

		it('writes the value into the store optimistically before sending', () => {
			// The optimistic write is what kills snap-back: the next
			// $derived re-run on the same tick sees the user's value
			// rather than the stale-leaf-or-nothing read that triggered
			// the bug. The send happens after the write, so a $derived
			// that reads `propertyValue` synchronously after this call
			// must see the new value.
			replaceTree(11, [mkTrackWithProperty(0, 0, { playback_mode: 0 })]);

			selectedTrackStore.setPropertyValue(
				'tracks/0/devices/0',
				'playback_mode',
				2
			);

			expect(
				selectedTrackStore.propertyValue('tracks/0/devices/0', 'playback_mode')
			).toBe(2);
			expect(send).toHaveBeenCalledTimes(1);
		});

		it('drops silently when generation is still UNSET', () => {
			// No replaceTree call — generation remains UNSET_GENERATION.
			selectedTrackStore.setPropertyValue(
				'tracks/0/devices/0',
				'playback_mode',
				1
			);

			expect(send).not.toHaveBeenCalled();
		});

		it('does not pre-validate the devicePath against the tree (surface decides)', () => {
			// Mirrors `setParamValue` posture: the wire is the source of
			// truth for "this path is dead." Optimistic local write
			// no-ops when the device isn't in the store; the OSC emit
			// still fires and the surface returns property-write-rejected
			// if appropriate.
			replaceTree(11, [mkTrackWithProperty(0, 0)]);

			selectedTrackStore.setPropertyValue(
				'tracks/5/devices/9',
				'playback_mode',
				1
			);

			expect(send).toHaveBeenCalledWith('/looping/v3/property/set', [
				'tracks/5/devices/9',
				'playback_mode',
				1,
				11
			]);
		});

		it('passes value type through unchanged (int / float / string / int-coerced bool)', () => {
			replaceTree(7, [mkTrackWithProperty(0, 0)]);

			selectedTrackStore.setPropertyValue('tracks/0/devices/0', 'playback_mode', 1);
			selectedTrackStore.setPropertyValue('tracks/0/devices/0', 'sample.gain', 0.42);
			selectedTrackStore.setPropertyValue(
				'tracks/0/devices/0',
				'sample.warp_mode',
				'beats'
			);
			// sample.warping rides the wire as int 0/1 — caller is
			// responsible for the coercion (see ADR-002 §coerce_bool_to_int).
			selectedTrackStore.setPropertyValue('tracks/0/devices/0', 'sample.warping', 1);

			const sentValues = (send as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
				(call) => (call[1] as unknown[])[2]
			);
			expect(sentValues).toEqual([1, 0.42, 'beats', 1]);
		});
	});

	describe('subscribeProperty()', () => {
		it('calls acquire on attach and returns release as cleanup', () => {
			const cleanup = selectedTrackStore.subscribeProperty(
				'tracks/0/devices/0',
				'playback_mode'
			);

			expect(acquireMock).toHaveBeenCalledTimes(1);
			expect(acquireMock).toHaveBeenCalledWith(
				'tracks/0/devices/0',
				'playback_mode'
			);
			expect(releaseMock).not.toHaveBeenCalled();

			cleanup();

			expect(releaseMock).toHaveBeenCalledTimes(1);
			expect(releaseMock).toHaveBeenCalledWith(
				'tracks/0/devices/0',
				'playback_mode'
			);
		});

		it('treats each (devicePath, propertyName) pair independently', () => {
			selectedTrackStore.subscribeProperty('tracks/0/devices/0', 'playback_mode');
			selectedTrackStore.subscribeProperty('tracks/0/devices/0', 'sample.gain');
			selectedTrackStore.subscribeProperty('tracks/0/devices/1', 'playback_mode');

			expect(acquireMock).toHaveBeenCalledTimes(3);
			expect(acquireMock).toHaveBeenNthCalledWith(
				1,
				'tracks/0/devices/0',
				'playback_mode'
			);
			expect(acquireMock).toHaveBeenNthCalledWith(
				2,
				'tracks/0/devices/0',
				'sample.gain'
			);
			expect(acquireMock).toHaveBeenNthCalledWith(
				3,
				'tracks/0/devices/1',
				'playback_mode'
			);
		});
	});
});
