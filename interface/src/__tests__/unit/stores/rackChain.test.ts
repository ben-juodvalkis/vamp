/**
 * Rack chains in the v3 store and the chain overview's model (ADR-529,
 * protocol 3.13.0): a rack's chain devices live in their own map keyed by
 * the rack's path, the flat views carry them so echoes land, the path
 * grammar's `chains/<i>` splits, a nested rack's map goes with its parent,
 * and the `chain_devices` row parses.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SvelteMap } from 'svelte/reactivity';
import {
	_resetForTests,
	applyParamValue,
	applyPropertyValue,
	chainDevicesAt,
	chainRackOf,
	invalidatePaths,
	mergeRackChain,
	replaceTree,
	splitParamPath,
	v3Store,
	type DeviceRecord,
	type ParamRecord,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import { SELECTED_CHAIN, SHOW_DEVICES, parseChainDevices, rackFold } from '$lib/services/rackChains.svelte';
import type { OSCArg } from '$lib/types/osc';

const RACK = 'tracks/1/devices/2';
const ECHO = `${RACK}/chains/1/devices/0`;
const INNER = `${RACK}/chains/1/devices/1`;
const CRUSH = `${INNER}/chains/0/devices/0`;

function device(devicePath: string, name: string, className: string, params: [string, number][] = [['Device On', 1]]): DeviceRecord {
	const map = new SvelteMap<string, ParamRecord>();
	params.forEach(([pname, value], i) => {
		const paramPath = `${devicePath}/params/${i}`;
		map.set(paramPath, { paramPath, name: pname, displayName: pname, min: 0, max: 1, value, unit: '' });
	});
	return { devicePath, name, className, params: map, properties: new SvelteMap<string, OSCArg>() };
}

function track(rackClass = 'AudioEffectGroupDevice'): TrackRecord {
	return {
		trackPath: 'tracks/1',
		name: 'Gtr',
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: false,
		hasAudioInput: true,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		devices: new SvelteMap<string, DeviceRecord>([[RACK, device(RACK, 'Dub Space', rackClass)]]),
		slots: new SvelteMap()
	};
}

beforeEach(() => {
	_resetForTests();
	replaceTree(3, [track()]);
});

describe('the rack chain map', () => {
	it('merges a rack bundle into its own map, the track untouched, the views carrying it', () => {
		mergeRackChain(4, RACK, new Map([[ECHO, device(ECHO, 'Echo', 'Echo', [['Device On', 1], ['Feedback', 0.4]])]]));
		expect(chainDevicesAt(RACK).map((d) => d.name)).toEqual(['Echo']);
		expect(v3Store.tracks.get('tracks/1')?.devices.size).toBe(1);
		expect(v3Store.deviceByPath.get(ECHO)?.className).toBe('Echo');
		expect(applyParamValue(`${ECHO}/params/1`, 0.7)).toBe(true);
		expect(v3Store.paramByPath.get(`${ECHO}/params/1`)?.value).toBe(0.7);
	});

	it('splits chain param paths and names the innermost rack', () => {
		expect(splitParamPath(`${CRUSH}/params/3`).devicePath).toBe(CRUSH);
		expect(splitParamPath(`${RACK}/chains/1/params/3`).devicePath).toBeNull();
		expect(chainRackOf(CRUSH)).toBe(INNER);
		expect(chainRackOf(RACK)).toBeNull();
	});

	it('drops a nested rack map with its parent and when the rack is gone', () => {
		mergeRackChain(4, RACK, new Map([[INNER, device(INNER, 'Inner', 'AudioEffectGroupDevice')]]));
		mergeRackChain(5, INNER, new Map([[CRUSH, device(CRUSH, 'Saturator', 'Saturator')]]));
		expect(v3Store.deviceByPath.get(CRUSH)?.name).toBe('Saturator');
		invalidatePaths(6, [INNER]);
		expect(v3Store.deviceByPath.get(CRUSH)).toBeUndefined();
		mergeRackChain(7, RACK, new Map([[ECHO, device(ECHO, 'Echo', 'Echo')]]));
		replaceTree(8, [track('StereoGain')]); // no rack at that path any more
		expect(chainDevicesAt(RACK)).toEqual([]);
	});
});

describe('the chain_devices row and folding', () => {
	it('parses the row', () => {
		const chains = parseChainDevices(
			JSON.stringify({
				chains: [
					{ index: 0, name: 'Dry', color: null, mute: 0, solo: 0, devices: [] },
					{ index: 1, name: 'Wet', color: 255, mute: 1, solo: 0, volume: 0.6, devices: [{ index: 0, class: 'Echo', name: 'Echo', type: 2, rack: 0 }] }
				]
			})
		);
		expect(chains?.[1]).toMatchObject({ name: 'Wet', color: 255, mute: true, volume: 0.6, devices: [{ className: 'Echo', rack: false }] });
		expect(chains?.[0].volume).toBeNull();
		expect(parseChainDevices('not json')).toBeNull();
		expect(parseChainDevices(undefined)).toBeNull();
	});

	it('reads a rack open exactly while Live shows its devices', () => {
		expect(rackFold.isOpen(RACK)).toBe(false);
		applyPropertyValue(RACK, SHOW_DEVICES, 1);
		expect(rackFold.isOpen(RACK)).toBe(true);
		applyPropertyValue(RACK, SHOW_DEVICES, 0);
		expect(rackFold.isOpen(RACK)).toBe(false);
	});

	it("shows Live's selected chain, the first before its row answers", () => {
		expect(rackFold.chainOf(RACK)).toBe(0);
		applyPropertyValue(RACK, SELECTED_CHAIN, 2);
		expect(rackFold.chainOf(RACK)).toBe(2);
		expect(rackFold.chainOf(INNER)).toBe(0);
		applyPropertyValue(RACK, SELECTED_CHAIN, -1);
		expect(rackFold.chainOf(RACK)).toBe(0);
	});
});
