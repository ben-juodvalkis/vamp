/**
 * ChorusCentralView's Pitch Hack: one column of Rate stops, 1 to 1/16 top
 * to bottom (2026-10-08). A stop writes Rate (param 5, an index into the
 * device's value_items) and puts Dry / Wet (param 2) at 100.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { replaceTree, _resetForTests, type TrackRecord, type DeviceRecord, type ParamRecord } from '$lib/stores/v3/normalized.svelte';
import ChorusCentralView from '$lib/components/v6/central/views/ChorusCentralView.svelte';
import { send } from '$lib/api/simpleClient';

const TRACK = 'tracks/0';
const PH = `${TRACK}/devices/0`;

function pitchHack(rate: number): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	([['Device On', 0, 1, 1], ['Cents', -50, 50, 0], ['Dry / Wet', 0, 100, 0], ['Coarse', -36, 36, 0], ['Level', 0, 1, 1], ['Rate', 0, 23, rate]] as const).forEach(([name, min, max, value], i) => {
		const paramPath = `${PH}/params/${i}`;
		params.set(paramPath, { paramPath, name, displayName: name, min, max, value, unit: '' });
	});
	return { devicePath: PH, name: 'Pitch Hack', className: 'MxDeviceAudioEffect', params, properties: new SvelteMap() };
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

const stops = (container: HTMLElement) =>
	Array.from(container.querySelectorAll<HTMLButtonElement>('.pitch-hack-rate button'));

const written = (param: number) =>
	vi.mocked(send).mock.calls
		.filter(([, args]) => Array.isArray(args) && args.includes(`${PH}/params/${param}`))
		.map(([, args]) => (args as unknown[])[1]);

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => cleanup());

describe('ChorusCentralView Pitch Hack rate column', () => {
	it('draws 1 to 1/16 and lights the stop Rate matches', async () => {
		seed(pitchHack(10));
		const { container } = render(ChorusCentralView);
		await tick();
		expect(stops(container).map((b) => b.textContent?.trim())).toEqual(['1', '1/2', '1/4', '1/8', '1/16']);
		expect(stops(container).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true', 'false']);
	});

	it('writes each stop to Rate and puts Dry / Wet at full', async () => {
		seed(pitchHack(0));
		const { container } = render(ChorusCentralView);
		await tick();
		for (const b of stops(container)) await fireEvent.click(b);
		expect(written(5)).toEqual([19, 16, 13, 10, 7]);
		expect(written(2)).toEqual([100, 100, 100, 100, 100]);
	});
});
