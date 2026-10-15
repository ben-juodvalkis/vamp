/**
 * PitchCentralView, Pitch Hack's controls (2026-10-15): Mix, Reverse,
 * Recycle and Int Var sliders, a Coarse column and the Rate column (1 to
 * 1/16 top to bottom; Rate is param 5, an index into the device's
 * value_items). A step writes its own param only; the step that loads the
 * device also puts Dry / Wet (param 2) at 100. The fixture is the
 * parameter list dumped off the running Live.
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
import PitchCentralView from '$lib/components/v6/central/views/PitchCentralView.svelte';
import { send } from '$lib/api/simpleClient';

const TRACK = 'tracks/0';
const PH = `${TRACK}/devices/0`;

function pitchHack(rate: number, coarse = 0, mix = 0): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	([['Device On', 0, 1, 1], ['Cents', -99, 99, 0], ['Dry / Wet', 0, 100, mix], ['Coarse', -36, 36, coarse], ['Level', -96, 0, 0], ['Rate', 0, 23, rate], ['Recycle', 0, 95, 0], ['Reverse', 0, 100, 0], ['Int Var', 0, 24, 0]] as const).forEach(([name, min, max, value], i) => {
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
const coarseSteps = (container: HTMLElement) =>
	Array.from(container.querySelectorAll<HTMLButtonElement>('.pitch-hack-coarse button'));
const sliderTitles = (container: HTMLElement) =>
	Array.from(container.querySelectorAll<HTMLElement>('[role="slider"]')).map((s) => s.getAttribute('aria-label')?.split(':')[0]);

const written = (param: number) =>
	vi.mocked(send).mock.calls
		.filter(([, args]) => Array.isArray(args) && args.includes(`${PH}/params/${param}`))
		.map(([, args]) => (args as unknown[])[1]);

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => cleanup());

describe('PitchCentralView Pitch Hack rate column', () => {
	it('draws 1 to 1/16 and lights the stop Rate matches', async () => {
		seed(pitchHack(10));
		const { container } = render(PitchCentralView);
		await tick();
		expect(stops(container).map((b) => b.textContent?.trim())).toEqual(['1', '1/2', '1/4', '1/8', '1/16']);
		expect(stops(container).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true', 'false']);
	});

	it('writes each stop to Rate and leaves Dry / Wet to its slider', async () => {
		seed(pitchHack(0, 0, 40));
		const { container } = render(PitchCentralView);
		await tick();
		for (const b of stops(container)) await fireEvent.click(b);
		expect(written(5)).toEqual([19, 16, 13, 10, 7]);
		expect(written(2)).toEqual([]);
	});
});

describe('PitchCentralView Pitch Hack controls', () => {
	it('draws Mix, Reverse, Recycle and Int Var, and no Octave control', async () => {
		seed(pitchHack(13));
		const { container } = render(PitchCentralView);
		await tick();
		expect(sliderTitles(container)).toEqual(['Mix', 'Reverse', 'Recycle', 'Int Var']);
		expect(container.textContent).not.toContain('Octave');
	});

	it('draws Coarse +12 to -12, lights the device\'s step and writes raw semitones', async () => {
		seed(pitchHack(13, 7));
		const { container } = render(PitchCentralView);
		await tick();
		expect(coarseSteps(container).map((b) => b.textContent?.trim())).toEqual(['+12', '+7', '0', '-5', '-12']);
		expect(coarseSteps(container).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false', 'false']);
		for (const b of coarseSteps(container)) await fireEvent.click(b);
		expect(written(3)).toEqual([12, 7, 0, -5, -12]);
	});
});
