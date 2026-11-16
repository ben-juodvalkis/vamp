/**
 * The gain reduction meter's store (ADR-541): what a held device asks Vamp
 * for Mac for, when it stops asking, and what a reading lands as.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));

import { send } from '$lib/api/simpleClient';
import { replaceTree, _resetForTests, type TrackRecord, type DeviceRecord } from '$lib/stores/v3/normalized.svelte';
import { reductionMeterStore, watchArgs, WATCH_ADDRESS, READING_ADDRESS } from '$lib/stores/v6/reductionMeterStore.svelte';

const sendMock = vi.mocked(send);
const STOP = ['', -1, '', '[]'];

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
			device('tracks/2/devices/1/chains/0/devices/0', 'Inner', 'Eq8'),
			device('tracks/2/devices/2', 'Permute', 'MxDeviceAudioEffect')
		])
	]);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('watchArgs', () => {
	it("names the device's index among the track's top-level devices, and their names in order", () => {
		expect(watchArgs('tracks/2/devices/1')).toEqual([
			'tracks/2/devices/1', 1, 'GlueCompressor', JSON.stringify(['Operator', 'Glue Compressor', 'Permute'])
		]);
	});

	it('is null for a device with no meter, a nested device or one not in the tree', () => {
		expect(watchArgs('tracks/2/devices/0')).toBeNull();
		expect(watchArgs('tracks/2/devices/1/chains/0/devices/0')).toBeNull();
		expect(watchArgs('tracks/9/devices/0')).toBeNull();
	});
});

describe('reductionMeterStore', () => {
	it('asks at once, every 2 s while held, and stops on release', () => {
		const release = reductionMeterStore.hold('tracks/2/devices/1');
		expect(sendMock).toHaveBeenCalledTimes(1);
		expect(sendMock.mock.calls[0][0]).toBe(WATCH_ADDRESS);
		expect(sendMock.mock.calls[0][1][0]).toBe('tracks/2/devices/1');
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
		expect(sendMock.mock.lastCall?.[1][0]).toBe('tracks/2/devices/1');
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
