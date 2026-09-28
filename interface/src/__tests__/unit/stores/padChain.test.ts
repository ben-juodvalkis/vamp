/**
 * The v3 store's pad-chain map (issue #491, protocol 3.8.0).
 *
 * The devices inside a drum pad's chain live in a SEPARATE map keyed by
 * pad path — never in the track's `devices` — so every consumer that
 * takes `devicesByPath[N]` to be the device at chain index N keeps that
 * invariant. What is pinned: a pad bundle merges with ADR-003 identity
 * and an empty one empties the pad; the flat path views include pad
 * devices, so echoes land; the nested path grammar splits and drops
 * correctly; a reset takes the pad map with it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SvelteMap } from 'svelte/reactivity';
import {
	_resetForTests,
	applyParamValue,
	applyPropertyValue,
	invalidatePaths,
	mergePadChain,
	mergeSubtreeAtPath,
	padDevicesAt,
	replaceTree,
	splitParamPath,
	v3Store,
	type DeviceRecord,
	type ParamRecord,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import type { OSCArg } from '$lib/types/osc';

const RACK = 'tracks/2/devices/0';
const PAD = `${RACK}/pads/38`;

function device(devicePath: string, name: string, className: string, params: [string, number][]): DeviceRecord {
	const map = new SvelteMap<string, ParamRecord>();
	params.forEach(([pname, value], i) => {
		const paramPath = `${devicePath}/params/${i}`;
		map.set(paramPath, { paramPath, name: pname, displayName: pname, min: 0, max: 1, value, unit: '' });
	});
	return { devicePath, name, className, params: map, properties: new SvelteMap<string, OSCArg>() };
}

function track(): TrackRecord {
	return {
		trackPath: 'tracks/2',
		name: 'Drums',
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
		role: 'drum',
		devices: new SvelteMap<string, DeviceRecord>([[RACK, device(RACK, 'Drum Rack', 'DrumGroupDevice', [['Device On', 1]])]]),
		slots: new SvelteMap()
	};
}

function reverb(): DeviceRecord {
	return device(`${PAD}/devices/1`, 'Reverb', 'Hybrid', [['Device On', 1], ['Dry/Wet', 0.3]]);
}

beforeEach(() => {
	_resetForTests();
	replaceTree(3, [track()]);
});

describe('the pad map', () => {
	it('merges a pad bundle into its own map and leaves the track alone', () => {
		mergePadChain(4, PAD, new Map([[`${PAD}/devices/1`, reverb()]]));
		expect(v3Store.generation).toBe(4);
		expect(padDevicesAt(PAD).map((d) => d.name)).toEqual(['Reverb']);
		expect(v3Store.tracks.get('tracks/2')?.devices.size).toBe(1); // the rack alone
		expect(v3Store.deviceByPath.get(`${PAD}/devices/1`)?.className).toBe('Hybrid');
		expect(v3Store.paramByPath.get(`${PAD}/devices/1/params/1`)?.value).toBe(0.3);
	});

	it('keeps record identity across a re-emit and drops what is gone', () => {
		mergePadChain(4, PAD, new Map([[`${PAD}/devices/1`, reverb()]]));
		const before = v3Store.paramByPath.get(`${PAD}/devices/1/params/1`);
		const again = reverb();
		mergePadChain(5, PAD, new Map([[`${PAD}/devices/1`, again]]));
		expect(v3Store.paramByPath.get(`${PAD}/devices/1/params/1`)).toBe(before); // unchanged: same identity
		// An empty bundle is a real answer: every effect gone.
		mergePadChain(6, PAD, new Map());
		expect(padDevicesAt(PAD)).toEqual([]);
		expect(v3Store.deviceByPath.has(`${PAD}/devices/1`)).toBe(false);
	});

	it('lands param and property echoes on pad devices', () => {
		mergePadChain(4, PAD, new Map([[`${PAD}/devices/1`, reverb()]]));
		expect(applyParamValue(`${PAD}/devices/1/params/1`, 0.8)).toBe(true);
		expect(v3Store.paramByPath.get(`${PAD}/devices/1/params/1`)?.value).toBe(0.8);
		expect(applyPropertyValue(`${PAD}/devices/1`, 'ir_category_index', 3)).toBe(true);
		expect(v3Store.deviceByPath.get(`${PAD}/devices/1`)?.properties.get('ir_category_index')).toBe(3);
		// A pad nobody subscribed drops, like any unknown path.
		expect(applyParamValue(`${RACK}/pads/40/devices/1/params/0`, 0.5)).toBe(false);
	});

	it('answers [] for a pad with no bundle', () => {
		expect(padDevicesAt(PAD)).toEqual([]);
		expect(padDevicesAt('tracks/9/devices/0/pads/1')).toEqual([]);
	});

	it('is dropped by a reset', () => {
		mergePadChain(4, PAD, new Map([[`${PAD}/devices/1`, reverb()]]));
		_resetForTests();
		expect(padDevicesAt(PAD)).toEqual([]);
		expect(v3Store.padDevices.size).toBe(0);
	});
});

describe('the nested path grammar', () => {
	it('splits a pad parameter path into its device path', () => {
		expect(splitParamPath(`${PAD}/devices/1/params/4`)).toEqual({ trackPath: 'tracks/2', devicePath: `${PAD}/devices/1` });
		expect(splitParamPath('tracks/2/devices/0/params/3')).toEqual({ trackPath: 'tracks/2', devicePath: 'tracks/2/devices/0' });
		// A rack inside a pad chain takes the same suffix.
		expect(splitParamPath(`${PAD}/devices/1/pads/60/devices/0/params/2`)).toEqual({
			trackPath: 'tracks/2',
			devicePath: `${PAD}/devices/1/pads/60/devices/0`
		});
	});

	it('refuses malformed nested shapes', () => {
		for (const bad of [
			`${RACK}/pads/38/params/0`, // params off a pad
			`${RACK}/pads/x/devices/1/params/0`,
			`${RACK}/pads/200/devices/1/params/0`, // note out of range
			`${RACK}/chains/0/devices/1/params/0`, // chains stay reserved
			`${PAD}/devices/1/params/a`
		]) {
			expect(splitParamPath(bad).devicePath, bad).toBeNull();
		}
	});

	it('drops a pad, a pad device or one of its params by path', () => {
		mergePadChain(4, PAD, new Map([[`${PAD}/devices/1`, reverb()], [`${PAD}/devices/2`, device(`${PAD}/devices/2`, 'Delay', 'Delay', [['Time', 0.5]])]]));
		expect(invalidatePaths(5, [`${PAD}/devices/1/params/1`])).toBe(1);
		expect(v3Store.paramByPath.has(`${PAD}/devices/1/params/1`)).toBe(false);
		expect(invalidatePaths(6, [`${PAD}/devices/2`])).toBe(2); // the device and its one param
		expect(padDevicesAt(PAD).map((d) => d.name)).toEqual(['Reverb']);
		expect(invalidatePaths(7, [PAD])).toBe(2); // the Reverb and its remaining param
		expect(padDevicesAt(PAD)).toEqual([]);
		expect(v3Store.generation).toBe(7);
		// The track's own devices were never touched.
		expect(v3Store.tracks.get('tracks/2')?.devices.size).toBe(1);
	});

	it('a path-less invalidate drops nothing and moves the generation', () => {
		mergePadChain(4, PAD, new Map([[`${PAD}/devices/1`, reverb()]]));
		expect(invalidatePaths(9, [])).toBe(0);
		expect(padDevicesAt(PAD)).toHaveLength(1);
		expect(v3Store.generation).toBe(9);
	});
});

describe('pad maps follow their rack (code review of #491)', () => {
	function otherAtRackPath(): TrackRecord {
		const t = track();
		t.devices = new SvelteMap<string, DeviceRecord>([[RACK, device(RACK, 'Delay', 'Delay', [['Device On', 1]])]]);
		return t;
	}

	beforeEach(() => {
		mergePadChain(4, PAD, new Map([[`${PAD}/devices/1`, reverb()]]));
		expect(padDevicesAt(PAD).map((d) => d.name)).toEqual(['Reverb']);
	});

	it('goes with its track on a track-level invalidate', () => {
		const removed = invalidatePaths(5, ['tracks/2']);
		expect(removed).toBeGreaterThanOrEqual(1 + 2); // the track, plus the Reverb and its two params
		expect(v3Store.padDevices.has(PAD)).toBe(false);
		expect(v3Store.paramByPath.has(`${PAD}/devices/1/params/1`)).toBe(false);
	});

	it('goes with its rack on a device-level invalidate', () => {
		invalidatePaths(5, [RACK]);
		expect(v3Store.padDevices.has(PAD)).toBe(false);
		expect(v3Store.paramByPath.has(`${PAD}/devices/1/params/1`)).toBe(false);
	});

	it('goes when a whole-song replace puts something other than a Drum Rack at the path', () => {
		replaceTree(5, [otherAtRackPath()]);
		expect(v3Store.padDevices.has(PAD)).toBe(false);
		expect(padDevicesAt(PAD)).toEqual([]);
	});

	it('stays when the replace keeps the rack where it was', () => {
		replaceTree(5, [track()]);
		expect(padDevicesAt(PAD).map((d) => d.name)).toEqual(['Reverb']);
	});

	it('goes on a selection-change merge that moves the rack away too', () => {
		mergeSubtreeAtPath(5, 'tracks/2', otherAtRackPath());
		expect(v3Store.padDevices.has(PAD)).toBe(false);
	});
});
