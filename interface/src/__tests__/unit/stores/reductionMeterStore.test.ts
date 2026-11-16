/**
 * The gain reduction meter's store (ADR-541): what a held device asks Vamp
 * for Mac for, when it stops asking, and what a reading lands as.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));

import { send } from '$lib/api/simpleClient';
import { replaceTree, mergePadChain, mergeRackChain, _resetForTests, type TrackRecord, type DeviceRecord } from '$lib/stores/v3/normalized.svelte';
import { reductionMeterStore, watchArgs, WATCH_ADDRESS, READING_ADDRESS } from '$lib/stores/v6/reductionMeterStore.svelte';

const sendMock = vi.mocked(send);
const STOP = ['', '', '[]'];

function device(devicePath: string, name: string, className: string): DeviceRecord {
	return { devicePath, name, className, params: new Map(), properties: new Map() };
}

function track(trackPath: string, devices: DeviceRecord[]): TrackRecord {
	return {
		trackPath, name: trackPath, color: 0, mute: false, solo: false, arm: false,
		hasMidiInput: false, hasAudioInput: true, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: '',
		devices: new Map(devices.map((d) => [d.devicePath, d])),
		slots: new Map()
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	_resetForTests();
	reductionMeterStore.reset();
	sendMock.mockClear();
	replaceTree(1, [
		track('tracks/2', [
			device('tracks/2/devices/0', 'Operator', 'Operator'),
			device('tracks/2/devices/1', 'Glue Compressor', 'GlueCompressor'),
			device('tracks/2/devices/2', 'Permute', 'MxDeviceAudioEffect')
		]),
		track('tracks/1', [
			device('tracks/1/devices/0', 'Memphis Studio + Plymouth', 'DrumGroupDevice'),
			device('tracks/1/devices/1', 'Permute', 'MxDeviceAudioEffect')
		]),
		track('tracks/3', [device('tracks/3/devices/0', 'Bus', 'AudioEffectGroupDevice')])
	]);
	const pad = (p: string, n: string, c: string) => [`tracks/1/devices/0/pads/36/devices/${p}`, device(`tracks/1/devices/0/pads/36/devices/${p}`, n, c)] as const;
	mergePadChain(2, 'tracks/1/devices/0/pads/36', new Map([pad('0', 'Kick-SessionDry-Felt-Soft', 'DrumCell'), pad('1', 'Glue Compressor', 'GlueCompressor')]));
	mergeRackChain(3, 'tracks/3/devices/0', new Map([
		['tracks/3/devices/0/chains/0/devices/0', device('tracks/3/devices/0/chains/0/devices/0', 'EQ', 'Eq8')],
		['tracks/3/devices/0/chains/1/devices/0', device('tracks/3/devices/0/chains/1/devices/0', 'Saturator', 'Saturator')],
		['tracks/3/devices/0/chains/1/devices/1', device('tracks/3/devices/0/chains/1/devices/1', 'Glue Compressor', 'GlueCompressor')]
	]));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('watchArgs', () => {
	it("names a top-level device's index among the track's devices, and their names in order", () => {
		expect(watchArgs('tracks/2/devices/1')).toEqual([
			'tracks/2/devices/1', 'GlueCompressor', JSON.stringify([[1, ['Operator', 'Glue Compressor', 'Permute']]])
		]);
	});

	it("walks into a Drum Rack pad's chain: the rack's level, then the pad's", () => {
		expect(watchArgs('tracks/1/devices/0/pads/36/devices/1')).toEqual([
			'tracks/1/devices/0/pads/36/devices/1', 'GlueCompressor',
			JSON.stringify([[0, ['Memphis Studio + Plymouth', 'Permute']], [1, ['Kick-SessionDry-Felt-Soft', 'Glue Compressor']]])
		]);
	});

	it("walks into a rack chain, counting only that chain's devices", () => {
		expect(watchArgs('tracks/3/devices/0/chains/1/devices/1')).toEqual([
			'tracks/3/devices/0/chains/1/devices/1', 'GlueCompressor',
			JSON.stringify([[0, ['Bus']], [1, ['Saturator', 'Glue Compressor']]])
		]);
	});

	it('is null for a device with no meter or one not in the tree', () => {
		expect(watchArgs('tracks/2/devices/0')).toBeNull();
		expect(watchArgs('tracks/1/devices/0/pads/38/devices/0')).toBeNull();
		expect(watchArgs('tracks/9/devices/0')).toBeNull();
	});
});

describe('reductionMeterStore', () => {
	it('asks at once, every 2 s while held, and stops on release', () => {
		const release = reductionMeterStore.hold('tracks/2/devices/1');
		expect(sendMock).toHaveBeenCalledTimes(1);
		expect(sendMock.mock.calls[0][0]).toBe(WATCH_ADDRESS);
		expect(sendMock.mock.calls[0]?.[1]?.[0]).toBe('tracks/2/devices/1');
		vi.advanceTimersByTime(4000);
		expect(sendMock).toHaveBeenCalledTimes(3);
		release();
		expect(sendMock).toHaveBeenLastCalledWith(WATCH_ADDRESS, STOP);
		vi.advanceTimersByTime(4000);
		expect(sendMock).toHaveBeenCalledTimes(4);
	});

	it('the newest hold wins, and releasing it goes back to the one before', () => {
		const first = reductionMeterStore.hold('tracks/2/devices/1');
		const second = reductionMeterStore.hold('tracks/2/devices/0');
		expect(sendMock).toHaveBeenLastCalledWith(WATCH_ADDRESS, STOP); // Operator has no meter
		second();
		expect(sendMock.mock.lastCall?.[1]?.[0]).toBe('tracks/2/devices/1');
		first();
		expect(sendMock).toHaveBeenLastCalledWith(WATCH_ADDRESS, STOP);
	});

	it('keeps the latest reading per device and drops malformed ones', () => {
		reductionMeterStore.handleMessage(READING_ADDRESS, ['tracks/2/devices/1', 12.79, 'ok']);
		reductionMeterStore.handleMessage(READING_ADDRESS, ['tracks/2/devices/1', '4', 'ok']);
		expect(reductionMeterStore.readingFor('tracks/2/devices/1')).toMatchObject({ db: 12.79, status: 'ok' });
		reductionMeterStore.handleMessage(READING_ADDRESS, ['tracks/2/devices/1', -1, 'not-shown']);
		expect(reductionMeterStore.readingFor('tracks/2/devices/1')).toMatchObject({ db: -1, status: 'not-shown' });
		expect(reductionMeterStore.readingFor('tracks/2/devices/0')).toBeNull();
	});
});
