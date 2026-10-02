/**
 * ReverbCentralView (2026-10-02 redesign): an algorithm draws the tail
 * picture, its own controls with Freeze under them, and the controls every
 * algorithm shares — each reading Live's own label at rest. Convolution
 * keeps its IR Time pad.
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
import {
	replaceTree,
	_resetForTests,
	type TrackRecord,
	type DeviceRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';
import { LIVE_DEFAULTS } from '$lib/components/v6/device-panel/hybridReverbParams';
import ReverbCentralView from '$lib/components/v6/central/views/ReverbCentralView.svelte';

const sendMock = vi.mocked(send);
const TRACK = 'tracks/0';
const DEVICE = `${TRACK}/devices/0`;

/** The rails that are not 0..1, as the rig reported them. */
const MAX: Record<number, number> = { 3: 16, 6: 4, 21: 29, 36: 9, 46: 9, 48: 3, 50: 4 };

function hybrid(values: Record<number, number> = {}): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i <= 53; i++) {
		const paramPath = `${DEVICE}/params/${i}`;
		const value = values[i] ?? LIVE_DEFAULTS[i] ?? 0;
		params.set(paramPath, { paramPath, name: `P${i}`, displayName: `P${i}`, min: 0, max: MAX[i] ?? 1, value, unit: '' });
	}
	return { devicePath: DEVICE, name: 'Reverb', className: 'Hybrid', params, properties: new SvelteMap() };
}

function track(devices: DeviceRecord[]): TrackRecord {
	return {
		trackPath: TRACK, name: 'Pad', color: 0x36a2ff, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: 'synth',
		devices: new SvelteMap(devices.map((d) => [d.devicePath, d])), slots: new SvelteMap()
	};
}

async function mount(values: Record<number, number> = {}) {
	replaceTree(3, [track([hybrid(values)])]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
	const view = render(ReverbCentralView);
	await tick();
	return view.container;
}

/** The sliders of a column, by the name and value they read. */
const labels = (root: Element | null) =>
	[...(root?.querySelectorAll('[role="slider"]') ?? [])].map((el) => (el.getAttribute('aria-label') ?? '').replace(/: [\d.]+$/, ''));

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => cleanup());

describe('ReverbCentralView, an algorithm', () => {
	it('draws the Dark Hall: the tail, its own five, Freeze under them', async () => {
		const c = await mount({ 6: 0 });
		expect(c.querySelector('[data-reverb-portrait="darkHall"]')).not.toBeNull();
		expect(c.textContent).toContain('Dark Hall');
		expect(c.textContent).toContain('3.50 s');
		expect(labels(c.querySelector('[data-reverb-own]'))).toEqual([
			'Shape 50.0', 'Bass Mult 100 %', 'Bass X 440 Hz', 'Damping 50 %', 'Mod 50 %'
		]);
		expect(c.querySelector('[data-reverb-own] [data-reverb-switch="8"]')?.textContent?.trim()).toBe('Freeze');
	});

	it('draws what every algorithm shares, in Live’s words', async () => {
		const c = await mount({ 6: 1 });
		expect(labels(c.querySelector('[data-reverb-shared]'))).toEqual([
			'Size 50 %', 'Predelay 10.0 ms', 'Feedback 0.0 %', 'Delay 0.00 ms', 'Stereo 100 %', 'Vintage Off'
		]);
		const switches = [...c.querySelectorAll('[data-reverb-shared] [data-reverb-switch]')].map((b) => b.textContent?.trim());
		expect(switches).toEqual(['Sync', 'Mono']);
	});

	it('draws Prism’s three, and Tides’ Rate as Live’s note value', async () => {
		const prism = await mount({ 6: 4 });
		expect(labels(prism.querySelector('[data-reverb-own]'))).toEqual(['Low Mult 100 %', 'High Mult 100 %', 'X-Over 800 Hz']);
		cleanup();
		const tides = await mount({ 6: 3, 21: 22 });
		expect(labels(tides.querySelector('[data-reverb-own]'))).toContain('Rate 1');
		const rate = tides.querySelector('[aria-label^="Rate"]');
		expect(Number(rate?.getAttribute('aria-valuenow'))).toBeCloseTo(22 / 29, 6);
	});

	it('reads the 16ths and their own Feedback while Predelay is synced', async () => {
		const c = await mount({ 1: 1, 3: 3, 4: 0, 5: 0.5 });
		const shared = labels(c.querySelector('[data-reverb-shared]'));
		expect(shared).toContain('Predelay 3 / 16');
		expect(shared).toContain('Feedback 48 %');
	});

	it('Freeze switches param 8', async () => {
		const c = await mount();
		await fireEvent.click(c.querySelector('[data-reverb-switch="8"]')!);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/param/set', [`${DEVICE}/params/8`, 1, 3]);
	});

	it('the picker sets the routing to Algorithm and the type', async () => {
		const c = await mount({ 6: 0 });
		await fireEvent.click(c.querySelector('[data-reverb-type="Tides"]')!);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/param/set', [`${DEVICE}/params/48`, 2, 3]);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/param/set', [`${DEVICE}/params/6`, 3, 3]);
	});
});

describe('ReverbCentralView, the EQ tab', () => {
	// The rig's EQ (2026-10-02): Lo Cut 121 Hz at 18 dB, Hi Shelf at 5 kHz.
	const RIG_EQ = { 33: 0, 34: 0.26008063554763794, 36: 2, 43: 1, 44: 0.7993133068084717 };

	it('swaps the tail for the EQ and the algorithm’s column for the EQ’s, keeping Freeze', async () => {
		const c = await mount({ 6: 0, ...RIG_EQ });
		await fireEvent.click(c.querySelector('[data-reverb-tab="eq"]')!);
		expect(c.querySelector('[data-reverb-eq]')).not.toBeNull();
		expect(c.querySelector('[data-reverb-portrait]')).toBeNull();
		expect(labels(c.querySelector('[data-reverb-own]'))).toEqual([
			'Lo Slope 18 dB', 'Peak 1 Q 0.71', 'Peak 2 Q 0.71', 'Hi Gain 0.0 dB'
		]);
		const own = [...c.querySelectorAll('[data-reverb-own] [data-reverb-switch]')].map((b) => b.textContent?.trim());
		expect(own).toEqual(['Cut', 'Shelf', 'On', 'Pre Algo', 'Freeze', 'In']);
		expect(c.querySelector('[data-reverb-eq]')?.getAttribute('aria-label')).toBe('Reverb EQ: Lo Cut 121 Hz · 18 dB');

		await fireEvent.click(c.querySelector('[data-reverb-tab="reverb"]')!);
		expect(labels(c.querySelector('[data-reverb-own]'))[0]).toBe('Shape 50.0');
	});

	it('switches an end between Cut and Shelf, and the EQ on and before the algorithm', async () => {
		const c = await mount(RIG_EQ);
		await fireEvent.click(c.querySelector('[data-reverb-tab="eq"]')!);
		await fireEvent.click(c.querySelector('[data-reverb-own] [data-reverb-switch="33"]')!);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/param/set', [`${DEVICE}/params/33`, 1, 3]);
		await fireEvent.click(c.querySelector('[data-reverb-own] [data-reverb-switch="31"]')!);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/param/set', [`${DEVICE}/params/31`, 0, 3]);
		await fireEvent.click(c.querySelector('[data-reverb-own] [data-reverb-switch="32"]')!);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/param/set', [`${DEVICE}/params/32`, 1, 3]);
	});

	it('names the EQ off on its curve', async () => {
		const c = await mount({ ...RIG_EQ, 31: 0 });
		await fireEvent.click(c.querySelector('[data-reverb-tab="eq"]')!);
		expect(c.querySelector('[data-reverb-eq]')?.classList.contains('off')).toBe(true);
		expect(c.querySelector('[data-reverb-eq]')?.getAttribute('aria-label')).toBe('Reverb EQ: EQ Off');
	});
});

describe('ReverbCentralView, convolution', () => {
	it('keeps the IR Time pad and draws no tail', async () => {
		const c = await mount({ 48: 3 });
		expect(c.querySelector('[data-reverb-portrait]')).toBeNull();
		expect(c.textContent).toContain('IR Time');
	});
});
