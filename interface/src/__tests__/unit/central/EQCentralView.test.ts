/**
 * EQCentralView (the Channel EQ): its curve is a picture (ADR-544
 * rollout), drawn from the four parameters its chain cell's tone pad
 * writes (`deviceControls.eq`: 2 Low, 3 Mid, 4 Mid Freq, 5 High). The
 * gesture is the chain cell's: a view does not repeat what its chain
 * cell's pad moves (ADR-510), so the picture takes no touch and writes
 * nothing. Low Cut and Output stay the switch and the knob they were.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { send } from '$lib/api/simpleClient';
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { replaceTree, _resetForTests, type TrackRecord, type DeviceRecord, type ParamRecord } from '$lib/stores/v3/normalized.svelte';
import { pressTap } from '../../helpers/pressTap';
import EQCentralView from '$lib/components/v6/central/views/EQCentralView.svelte';

const TRACK = 'tracks/0';
const DEVICE = `${TRACK}/devices/0`;
/** Live's order: Device On, Highpass On, Low Gain, Mid Gain, Mid Freq, High Gain, Gain. */
const PARAMS = ['Device On', 'Highpass On', 'Low Gain', 'Mid Gain', 'Mid Freq', 'High Gain', 'Gain'];

function channelEq(values: Record<number, number> = {}): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	PARAMS.forEach((name, i) => {
		const paramPath = `${DEVICE}/params/${i}`;
		const rest = i === 0 ? 1 : i === 1 ? 0 : 0.5;
		params.set(paramPath, { paramPath, name, displayName: name, min: 0, max: 1, value: values[i] ?? rest, unit: '' });
	});
	return { devicePath: DEVICE, name: 'Channel EQ', className: 'ChannelEq', params, properties: new SvelteMap() };
}

function seed(devices: DeviceRecord[]) {
	const record: TrackRecord = {
		trackPath: TRACK, name: 'Keys', color: 0xff8040, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: '',
		devices: new SvelteMap(devices.map((d) => [d.devicePath, d])), slots: new SvelteMap()
	};
	replaceTree(3, [record]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
}

/** Every parameter write so far: [index, value]. */
function writes(): Array<[number, number]> {
	return vi
		.mocked(send)
		.mock.calls.filter(([addr]) => addr === '/looping/v3/param/set')
		.map(([, args]) => {
			const [path, value] = args as [string, number];
			return [Number(path.slice(path.lastIndexOf('/') + 1)), value];
		});
}

/** The graph's plot, given a 1000 x 200 box at the page's origin (jsdom has no layout). */
function graph(container: HTMLElement): HTMLElement {
	const pad = container.querySelector<HTMLElement>('[data-filter-graph]');
	const plot = pad?.querySelector<HTMLElement>('.plot');
	if (!pad || !plot) throw new Error('no graph');
	plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 200, right: 1000, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
	return pad;
}

async function pressAt(pad: HTMLElement, clientX: number, clientY: number) {
	await fireEvent.pointerDown(pad, { pointerId: 1, pointerType: 'touch', clientX, clientY });
	await fireEvent.pointerUp(pad, { pointerId: 1, pointerType: 'touch', clientX, clientY });
	await tick();
}

const dots = (container: HTMLElement) =>
	[...container.querySelectorAll<HTMLElement>('.graph-dot')].map((d) => d.dataset.dot).sort();

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => cleanup());

describe('EQCentralView: the curve is a picture', () => {
	it('draws a mark a band, the Low Cut switch and the Output knob', () => {
		seed([channelEq()]);
		const { container } = render(EQCentralView);
		expect(dots(container)).toEqual(['H', 'L', 'M']);
		expect(container.querySelector('.eq-switch')?.textContent?.trim()).toBe('Low Cut');
		expect(container.querySelector('.eq-switch')?.getAttribute('aria-pressed')).toBe('false');
		const knobs = [...container.querySelectorAll('[data-face="knob"]')].map((k) => k.getAttribute('aria-label')?.split(':')[0]);
		expect(knobs).toEqual(['Output']);
	});

	it('follows the parameters: a boosted low shelf lifts its mark, the bell stands at its frequency', () => {
		seed([channelEq({ 2: 0.9, 4: 0 })]);
		const { container } = render(EQCentralView);
		const mark = (label: string) => container.querySelector<HTMLElement>(`.graph-dot[data-dot="${label}"]`)!;
		// 0.9 is +12 dB on the shelf's ±15: three quarters up the graph's ±24.
		expect(parseFloat(mark('L').style.bottom)).toBeCloseTo(75, 4);
		// Mid Freq 0 is 120 Hz: log(120 / 20) / log(1000) across.
		expect(parseFloat(mark('M').style.left)).toBeCloseTo((Math.log(6) / Math.log(1000)) * 100, 3);
		expect(parseFloat(mark('H').style.bottom)).toBeCloseTo(50, 4);
	});

	it('takes no touch and writes nothing: the gesture is the chain cell’s', async () => {
		seed([channelEq()]);
		const { container } = render(EQCentralView);
		const picture = container.querySelector<HTMLElement>('[data-eq-picture]')!;
		expect(picture.getAttribute('role')).toBe('img');
		expect(picture.querySelector('[inert]')?.contains(container.querySelector('[data-filter-graph]'))).toBe(true);
		// Even an event that reached the graph inside moves no parameter.
		const pad = graph(container);
		for (const [x, y] of [[60, 75], [500, 125], [950, 0]]) await pressAt(pad, x, y);
		await fireEvent.pointerDown(pad, { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 100 });
		await fireEvent.pointerMove(pad, { pointerId: 2, pointerType: 'touch', clientX: 460, clientY: 40 });
		await fireEvent.pointerUp(pad, { pointerId: 2, pointerType: 'touch', clientX: 460, clientY: 40 });
		await tick();
		expect(writes()).toEqual([]);
	});

	it('Low Cut toggles parameter 1', async () => {
		seed([channelEq()]);
		const { container } = render(EQCentralView);
		await pressTap(container.querySelector('.eq-switch')!);
		expect(writes()).toEqual([[1, 1]]);
	});
});
