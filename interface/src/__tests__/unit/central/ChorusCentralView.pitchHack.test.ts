/**
 * ChorusCentralView's Pitch Hack pitch: three stops under the pad, -12, 0,
 * +12 left to right (2026-10-05), written to Coarse (param 3, ±36 st, read
 * off the running device 2026-09-23) as raw semitones. The lit stop is the
 * one nearest the device's value.
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

function pitchHack(coarse: number): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	([['Device On', 0, 1, 1], ['Cents', -50, 50, 0], ['Dry / Wet', 0, 100, 50], ['Coarse', -36, 36, coarse]] as const).forEach(([name, min, max, value], i) => {
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
	Array.from(container.querySelectorAll<HTMLButtonElement>('.pitch-hack-row button'));

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => cleanup());

describe('ChorusCentralView Pitch Hack pitch stops', () => {
	it('draws -12, 0, +12 and lights the stop nearest the device', async () => {
		seed(pitchHack(10));
		const { container } = render(ChorusCentralView);
		await tick();
		expect(stops(container).map((b) => b.textContent?.trim())).toEqual(['-12', '0', '+12']);
		expect(stops(container).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
	});

	it('writes each stop to Coarse as raw semitones', async () => {
		seed(pitchHack(0));
		const { container } = render(ChorusCentralView);
		await tick();
		for (const b of stops(container)) await fireEvent.click(b);
		const writes = vi.mocked(send).mock.calls
			.filter(([, args]) => Array.isArray(args) && args.includes(`${PH}/params/3`))
			.map(([, args]) => (args as unknown[])[1]);
		expect(writes).toEqual([-12, 0, 12]);
	});
});
