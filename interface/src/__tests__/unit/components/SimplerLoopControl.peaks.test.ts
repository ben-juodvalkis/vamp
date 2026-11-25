/**
 * SimplerLoopControl's waveform fetch is cancelled when the sample
 * changes or the control unmounts, and a failed fetch is caught.
 * Before, the cleanup that cancelled the fetch was returned from inside
 * a dynamic import's `.then` and discarded, so a superseded fetch ran on.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('$lib/services/clipWaveformService', () => ({
	getPeaks: vi.fn(),
	cancelPeaks: vi.fn()
}));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { replaceTree, _resetForTests, v3Store, type TrackRecord, type DeviceRecord, type ParamRecord } from '$lib/stores/v3/normalized.svelte';
import SimplerLoopControl from '$lib/components/v6/simpler/SimplerLoopControl.svelte';
import { getPeaks, cancelPeaks } from '$lib/services/clipWaveformService';
import { logger } from '$lib/utils/logger';

const TRACK = 'tracks/0';
const SIMPLER = `${TRACK}/devices/0`;

function simpler(filePath: string): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	[1, 0, 0, 0, 1, 0, 0, 0].forEach((value, i) => {
		const paramPath = `${SIMPLER}/params/${i}`;
		params.set(paramPath, { paramPath, name: `P${i}`, displayName: `P${i}`, min: 0, max: 1, value, unit: '' });
	});
	const properties = new SvelteMap<string, string | number>([['sample.file_path', filePath]]);
	return { devicePath: SIMPLER, name: 'Simpler', className: 'OriginalSimpler', params, properties };
}

function seed(device: DeviceRecord) {
	const t: TrackRecord = {
		trackPath: TRACK, name: 'Keys', color: 0xff8040, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: '',
		devices: new SvelteMap([[device.devicePath, device]]), slots: new SvelteMap()
	};
	replaceTree(3, [t]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
}

beforeEach(() => {
	vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('SimplerLoopControl peaks', () => {
	it('cancels the fetch on unmount', async () => {
		vi.mocked(getPeaks).mockReturnValue(new Promise(() => {}));
		const device = simpler('/s/a.wav');
		seed(device);
		const { unmount } = render(SimplerLoopControl, { device, devicePath: SIMPLER });
		await tick();
		expect(getPeaks).toHaveBeenCalledWith('/s/a.wav', 1024);
		unmount();
		expect(cancelPeaks).toHaveBeenCalledWith('/s/a.wav', 1024);
	});

	it('cancels the old fetch when the sample changes', async () => {
		vi.mocked(getPeaks).mockReturnValue(new Promise(() => {}));
		const device = simpler('/s/a.wav');
		seed(device);
		render(SimplerLoopControl, { device, devicePath: SIMPLER });
		await tick();
		v3Store.deviceByPath.get(SIMPLER)!.properties.set('sample.file_path', '/s/b.wav');
		await tick();
		expect(cancelPeaks).toHaveBeenCalledWith('/s/a.wav', 1024);
		expect(getPeaks).toHaveBeenLastCalledWith('/s/b.wav', 1024);
	});

	it('logs a failed fetch instead of leaving it unhandled', async () => {
		vi.mocked(getPeaks).mockRejectedValue(new Error('boom'));
		const device = simpler('/s/a.wav');
		seed(device);
		render(SimplerLoopControl, { device, devicePath: SIMPLER });
		await tick();
		await Promise.resolve();
		await Promise.resolve();
		expect(logger.warn).toHaveBeenCalled();
	});
});
