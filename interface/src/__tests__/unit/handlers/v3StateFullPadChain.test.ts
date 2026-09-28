/**
 * `state/full/tree` with reason `pad-chain` (issue #491, protocol 3.8.0):
 * D and P records for one drum pad's effects, scope the pad path, no T.
 * Applied to the pad map, never the track; never deduped (a bundle answers
 * a subscription); a malformed one is dropped whole.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { SvelteMap } from 'svelte/reactivity';
import {
	_resetForTests,
	padDevicesAt,
	replaceTree,
	v3Store,
	type DeviceRecord,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import { handleV3StateFullTree, parsePadChainArgs, _resetV3StateFull_forTests } from '$lib/api/handlers/v3StateFull';
import { getHeldEtag } from '$lib/api/handlers/stateFullEtagStore';
import type { OSCArg } from '$lib/types/osc';

const RACK = 'tracks/2/devices/0';
const PAD = `${RACK}/pads/38`;

function drumsTrack(): TrackRecord {
	const rack: DeviceRecord = {
		devicePath: RACK,
		name: 'Drum Rack',
		className: 'DrumGroupDevice',
		params: new SvelteMap(),
		properties: new SvelteMap()
	};
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
		devices: new SvelteMap([[RACK, rack]]),
		slots: new SvelteMap()
	};
}

/** The records a pad bundle carries: a Reverb at chain index 1 with two params. */
function reverbRecords(): OSCArg[] {
	return [
		'D', `${PAD}/devices/1`, 'Reverb', 'Hybrid',
		'P', `${PAD}/devices/1/params/0`, 'Device On', 'Device On', 0, 1, 1, '',
		'P', `${PAD}/devices/1/params/1`, 'Dry/Wet', 'Dry/Wet', 0, 1, 0.3, ''
	];
}

function deliver(records: OSCArg[], generation = 5, etag = '0x0000abcd', scope = PAD) {
	handleV3StateFullTree(['pad-chain', generation, etag, scope, ...records]);
}

beforeEach(() => {
	_resetForTests();
	_resetV3StateFull_forTests();
	replaceTree(3, [drumsTrack()]);
});

describe('pad-chain bundles', () => {
	it('lands the records in the pad map and moves the generation', () => {
		deliver(reverbRecords());
		expect(v3Store.generation).toBe(5);
		expect(padDevicesAt(PAD).map((d) => [d.name, d.className, d.params.size])).toEqual([['Reverb', 'Hybrid', 2]]);
		expect(v3Store.paramByPath.get(`${PAD}/devices/1/params/1`)?.value).toBe(0.3);
		// The track's own devices are exactly what they were.
		expect(Array.from(v3Store.tracks.get('tracks/2')!.devices.keys())).toEqual([RACK]);
	});

	it('is never deduped: the same bundle twice lands twice', () => {
		deliver(reverbRecords());
		_resetForTests();
		replaceTree(5, [drumsTrack()]);
		deliver(reverbRecords()); // same generation, same etag
		expect(padDevicesAt(PAD)).toHaveLength(1);
	});

	it('does not record a held ETag for a pad scope', () => {
		deliver(reverbRecords(), 5, '0x00001234');
		expect(getHeldEtag(PAD)).toBeNull();
		expect(getHeldEtag(null)).toBeNull();
	});

	it('an empty bundle empties the pad', () => {
		deliver(reverbRecords());
		deliver([], 6);
		expect(padDevicesAt(PAD)).toEqual([]);
		expect(v3Store.generation).toBe(6);
	});

	it('drops a malformed bundle whole', () => {
		deliver(reverbRecords());
		// A T record has no place in a pad bundle; a device outside the pad neither.
		deliver(['T', 'tracks/2'], 7);
		deliver(['D', `${RACK}/pads/40/devices/1`, 'Delay', 'Delay'], 7);
		deliver(['P', `${PAD}/devices/1/params/0`, 'x', 'x', 0, 1, 0, ''], 7);
		expect(padDevicesAt(PAD).map((d) => d.name)).toEqual(['Reverb']);
		expect(v3Store.generation).toBe(5);
	});

	it('parses records in chain order with their params under them', () => {
		const devices = parsePadChainArgs(
			[
				...reverbRecords(),
				'D', `${PAD}/devices/2`, 'Delay', 'Delay',
				'P', `${PAD}/devices/2/params/0`, 'Time', 'Time', 0, 1, 0.5, ''
			],
			PAD
		);
		expect(devices && Array.from(devices.keys())).toEqual([`${PAD}/devices/1`, `${PAD}/devices/2`]);
		expect(devices?.get(`${PAD}/devices/2`)?.params.size).toBe(1);
		expect(parsePadChainArgs(['D', `${PAD}/devices/1`, 'Reverb'], PAD)).toBeNull(); // short D
		expect(parsePadChainArgs(['P', `${PAD}/devices/1/params/0`, 'x', 'x', 0, 1, 0, ''], PAD)).toBeNull(); // P before D
	});

	it('leaves a track-scoped bundle on the track path', () => {
		handleV3StateFullTree([
			'selection-change', 8, '0x00000001', 'tracks/2',
			'T', 'tracks/2', 'Drums', 0, 0, 0, 0, 1, 0, 0, 0.8, 0, 0, -1, 'drum', '',
			'D', RACK, 'Drum Rack', 'DrumGroupDevice'
		]);
		expect(v3Store.generation).toBe(8);
		expect(v3Store.padDevices.size).toBe(0);
	});
});
