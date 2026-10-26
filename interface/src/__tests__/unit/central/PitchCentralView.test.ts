/**
 * The Pitch view (2026-10-24; the Pitch family in the Auto Pan view from
 * 2026-10-15): the Octave's interval. Its Mix is the grid's Pitch slider,
 * and Pitch Hack (Reverse) has its own view (the Glitch view's from the same
 * day until 2026-10-26). Pitch Hack: a Mix
 * slider and the Rate column (1 to 1/16 top to bottom;
 * Rate is param 5, an index into the device's value_items), and no
 * Coarse, Reverse, Recycle or Int Var. A step writes its own param only; the step
 * that loads the device also puts Dry / Wet (param 2) at 100. The Octave,
 * the Pitch tile until then: an interval column of the tile's four stops
 * and a Mix slider. The fixtures are the parameter lists dumped off the
 * running Live.
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
import ReverseCentralView from '$lib/components/v6/central/views/ReverseCentralView.svelte';
import { send } from '$lib/api/simpleClient';

const TRACK = 'tracks/0';
const PH = `${TRACK}/devices/0`;
const OCT = `${TRACK}/devices/1`;

function octave(semitones: number, mix = 50, response = 0, quality = 0, name = 'Octave'): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	// As dumped off the running Live (2026-10-26).
	([['Device On', 0, 1, 1], ['Semitones', -12, 12, semitones], ['Mix', 0, 100, mix], ['Tone', 0, 100, 100], ['Response', 0, 2, response], ['Quality', 0, 2, quality]] as const).forEach(([pname, min, max, value], i) => {
		const paramPath = `${OCT}/params/${i}`;
		params.set(paramPath, { paramPath, name: pname, displayName: pname, min, max, value, unit: '' });
	});
	return { devicePath: OCT, name, className: 'MxDeviceAudioEffect', params, properties: new SvelteMap() };
}

function pitchHack(rate: number, coarse = 0, mix = 0): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	([['Device On', 0, 1, 1], ['Cents', -99, 99, 0], ['Dry / Wet', 0, 100, mix], ['Coarse', -36, 36, coarse], ['Level', -96, 0, 0], ['Rate', 0, 23, rate], ['Recycle', 0, 95, 0], ['Reverse', 0, 100, 0], ['Int Var', 0, 24, 0]] as const).forEach(([name, min, max, value], i) => {
		const paramPath = `${PH}/params/${i}`;
		params.set(paramPath, { paramPath, name, displayName: name, min, max, value, unit: '' });
	});
	return { devicePath: PH, name: 'Pitch Hack', className: 'MxDeviceAudioEffect', params, properties: new SvelteMap() };
}

function seed(...devices: DeviceRecord[]) {
	const t: TrackRecord = {
		trackPath: TRACK, name: 'Keys', color: 0xff8040, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: '',
		devices: new SvelteMap(devices.map((d) => [d.devicePath, d])), slots: new SvelteMap()
	};
	replaceTree(3, [t]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
}

const stops = (container: HTMLElement) =>
	Array.from(container.querySelectorAll<HTMLButtonElement>('.pitch-hack-rate button'));
const coarseSteps = (container: HTMLElement) =>
	Array.from(container.querySelectorAll<HTMLButtonElement>('.pitch-hack-coarse button'));
const tab = (container: HTMLElement, title: string) =>
	Array.from(container.querySelectorAll<HTMLButtonElement>(`[role="radiogroup"][aria-label="${title}"] button`));
const sliderTitles = (container: HTMLElement) =>
	Array.from(container.querySelectorAll<HTMLElement>('[role="slider"]')).map((s) => s.getAttribute('aria-label')?.split(':')[0]);

const writtenTo = (device: string, param: number) =>
	vi.mocked(send).mock.calls
		.filter(([, args]) => Array.isArray(args) && args.includes(`${device}/params/${param}`))
		.map(([, args]) => (args as unknown[])[1]);
const written = (param: number) => writtenTo(PH, param);

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => {
	cleanup();
});

// Pitch Hack (titled Reverse) has its own view since 2026-10-26.
describe('Reverse view: Pitch Hack rate column', () => {
	it('draws 1 to 1/16 and lights the stop Rate matches', async () => {
		seed(pitchHack(10));
		const { container } = render(ReverseCentralView);
		await tick();
		expect(stops(container).map((b) => b.textContent?.trim())).toEqual(['1', '1/2', '1/4', '1/8', '1/16']);
		expect(stops(container).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true', 'false']);
	});

	it('writes each stop to Rate and leaves Dry / Wet to its slider', async () => {
		seed(pitchHack(0, 0, 40));
		const { container } = render(ReverseCentralView);
		await tick();
		for (const b of stops(container)) await fireEvent.click(b);
		expect(written(5)).toEqual([19, 16, 13, 10, 7]);
		expect(written(2)).toEqual([]);
	});
});

describe('Pitch view: the Pitch family', () => {
	it('draws the Octave alone in the Pitch view: three tabs, no Mix (the grid tile) and no Reverse', async () => {
		seed(pitchHack(13), octave(7));
		const { container } = render(PitchCentralView);
		await tick();
		expect(sliderTitles(container)).toEqual([]);
		expect(container.querySelector('.pitch-hack-rate')).toBeNull();
		expect(container.textContent).not.toContain('Reverse');
		expect(Array.from(container.querySelectorAll('[role="radiogroup"]')).map((g) => g.getAttribute('aria-label'))).toEqual(['Pitch', 'Response', 'Quality']);
	});

	it('draws Pitch Hack in its own view: one Mix slider, no Coarse, Reverse, Recycle or Int Var', async () => {
		seed(pitchHack(13), octave(7));
		const { container } = render(ReverseCentralView);
		await tick();
		const titles = sliderTitles(container);
		expect(titles.filter((t) => t === 'Mix')).toHaveLength(1);
		for (const gone of ['Reverse', 'Recycle', 'Int Var']) expect(titles).not.toContain(gone);
		expect(coarseSteps(container)).toEqual([]);
		expect(container.textContent).not.toContain('Coarse');
		expect(container.querySelector('.pitch-hack-mix [role="slider"]')).not.toBeNull();
		expect(container.querySelector('.pitch-hack-rate')?.closest('.stack')?.querySelector('.row-title')?.textContent).toBe('Reverse');
	});

	it("draws the Octave's pitch +12 to -12, lights the device's step and writes semitones", async () => {
		seed(pitchHack(13), octave(-5, 30));
		const { container } = render(PitchCentralView);
		await tick();
		expect(tab(container, 'Pitch').map((b) => b.textContent?.trim())).toEqual(['+12', '+7', '-5', '-12']);
		expect(tab(container, 'Pitch').map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false']);
		for (const b of tab(container, 'Pitch')) await fireEvent.click(b);
		expect(writtenTo(OCT, 1)).toEqual([12, 7, -5, -12]);
		// A loaded Octave's Mix is the slider's: a step leaves it alone.
		expect(writtenTo(OCT, 2)).toEqual([]);
	});

	it('draws Response and Quality as tabs and writes their steps (params 4 and 5)', async () => {
		seed(octave(7, 50, 1, 2));
		const { container } = render(PitchCentralView);
		await tick();
		expect(tab(container, 'Response').map((b) => b.textContent?.trim())).toEqual(['Fast', 'Balanced', 'Clean']);
		expect(tab(container, 'Quality').map((b) => b.textContent?.trim())).toEqual(['Full', 'Lite', 'Eco']);
		expect(tab(container, 'Response').map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
		expect(tab(container, 'Quality').map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
		for (const b of tab(container, 'Response')) await fireEvent.click(b);
		for (const b of tab(container, 'Quality')) await fireEvent.click(b);
		expect(writtenTo(OCT, 4)).toEqual([0, 1, 2]);
		expect(writtenTo(OCT, 5)).toEqual([0, 1, 2]);
	});

	it('drives the same device loaded from the shelf as "Pitch Shift"', async () => {
		seed(octave(12, 50, 0, 0, 'Pitch Shift'));
		const { container } = render(PitchCentralView);
		await tick();
		expect(tab(container, 'Pitch').map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
	});

});
