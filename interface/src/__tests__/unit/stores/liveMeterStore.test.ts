/**
 * The live meters' store (ADR-541): what a held device asks Vamp for Mac
 * for, when it stops asking, and what a reading of either kind lands as.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));

import { send } from '$lib/api/simpleClient';
import { replaceTree, mergePadChain, mergeRackChain, _resetForTests, type TrackRecord, type DeviceRecord } from '$lib/stores/v3/normalized.svelte';
import { liveMeterStore, watchArgs, bandHz, WATCH_ADDRESS, REDUCTION_ADDRESS, SPECTRUM_ADDRESS, METERED_CLASSES } from '$lib/stores/v6/liveMeterStore.svelte';

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
	liveMeterStore.reset();
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

	it("a pad's records hold its effects, not its instrument: Live's index from the path, null for the instrument", () => {
		mergePadChain(4, 'tracks/1/devices/0/pads/38', new Map([
			['tracks/1/devices/0/pads/38/devices/1', device('tracks/1/devices/0/pads/38/devices/1', 'Glue Compressor', 'GlueCompressor')]
		]));
		expect(watchArgs('tracks/1/devices/0/pads/38/devices/1')).toEqual([
			'tracks/1/devices/0/pads/38/devices/1', 'GlueCompressor',
			JSON.stringify([[0, ['Memphis Studio + Plymouth', 'Permute']], [1, [null, 'Glue Compressor']]])
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
		expect(watchArgs('tracks/1/devices/0/pads/40/devices/0')).toBeNull();
		expect(watchArgs('tracks/9/devices/0')).toBeNull();
	});
});

describe('liveMeterStore', () => {
	it('asks at once, every 2 s while held, and stops on release', () => {
		const release = liveMeterStore.hold('tracks/2/devices/1');
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

	it('asks for every held device each round, and stops all when the last goes', () => {
		const glue = liveMeterStore.hold('tracks/2/devices/1');
		const bus = liveMeterStore.hold('tracks/3/devices/0/chains/1/devices/1');
		const operator = liveMeterStore.hold('tracks/2/devices/0'); // no meter: not asked for
		sendMock.mockClear();
		vi.advanceTimersByTime(2000);
		expect(sendMock.mock.calls.map((c) => c[1]?.[0])).toEqual(['tracks/2/devices/1', 'tracks/3/devices/0/chains/1/devices/1']);
		operator();
		bus();
		sendMock.mockClear();
		vi.advanceTimersByTime(2000);
		expect(sendMock.mock.calls.map((c) => c[1]?.[0])).toEqual(['tracks/2/devices/1']);
		glue();
		expect(sendMock).toHaveBeenLastCalledWith(WATCH_ADDRESS, STOP);
	});

	it('keeps the latest reading per device and drops malformed ones', () => {
		liveMeterStore.handleMessage(REDUCTION_ADDRESS, ['tracks/2/devices/1', 12.79, 'ok']);
		liveMeterStore.handleMessage(REDUCTION_ADDRESS, ['tracks/2/devices/1', '4', 'ok']);
		expect(liveMeterStore.readingFor('tracks/2/devices/1')).toMatchObject({ kind: 'reduction', values: [12.79], status: 'ok' });
		liveMeterStore.handleMessage(REDUCTION_ADDRESS, ['tracks/2/devices/1', -1, 'not-shown']);
		expect(liveMeterStore.readingFor('tracks/2/devices/1')).toMatchObject({ values: [], status: 'not-shown' });
		expect(liveMeterStore.readingFor('tracks/2/devices/0')).toBeNull();
	});

	it("keeps a spectrum's bands, and drops one with a non-number band", () => {
		const bands = Array.from({ length: 64 }, (_, i) => -60 + i / 2);
		liveMeterStore.handleMessage(SPECTRUM_ADDRESS, ['tracks/4/devices/0', 'ok', ...bands]);
		expect(liveMeterStore.readingFor('tracks/4/devices/0')).toMatchObject({ kind: 'spectrum', values: bands, status: 'ok' });
		liveMeterStore.handleMessage(SPECTRUM_ADDRESS, ['tracks/4/devices/0', 'ok', -3, 'x']);
		expect(liveMeterStore.readingFor('tracks/4/devices/0')?.values).toEqual(bands);
	});
});

describe('the standard spectrum grid', () => {
	it('puts 64 band centres log-spaced across 20 Hz–20 kHz', () => {
		expect(bandHz(0)).toBeCloseTo(20 * Math.pow(1000, 0.5 / 64), 6);
		expect(bandHz(63)).toBeCloseTo(20000 / Math.pow(1000, 0.5 / 64), 3);
		expect(bandHz(31) * bandHz(32)).toBeCloseTo(20 * 20000, 0);
	});

	it('meters the Glue by its needle and the Auto Filter and Channel EQ by their spectrum', () => {
		expect(METERED_CLASSES.get('GlueCompressor')).toBe('reduction');
		expect(METERED_CLASSES.get('AutoFilter2')).toBe('spectrum');
		expect(METERED_CLASSES.get('ChannelEq')).toBe('spectrum');
	});
});
