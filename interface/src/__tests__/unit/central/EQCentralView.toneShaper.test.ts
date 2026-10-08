/**
 * EQCentralView's Tone Shaper: Ben's Adaptive Tone Shaper's graph beside the
 * Channel EQ (params read off the running device 2026-10-07: 1 Amount,
 * 2–5 the tone levels, 6 Latency, 7 Quality, 8–11 the centers in Hz), and
 * the frames its device sends through the bridge.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { send } from '$lib/api/simpleClient';
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { replaceTree, _resetForTests, type TrackRecord, type DeviceRecord, type ParamRecord } from '$lib/stores/v3/normalized.svelte';
import { applyToneShaperFrame, __resetToneShaperStoreForTests } from '$lib/stores/v3/toneShaper.svelte';
import { handleToneShaperFrame } from '$lib/api/handlers/toneShaperFrame';
import EQCentralView from '$lib/components/v6/central/views/EQCentralView.svelte';

const TRACK = 'tracks/0';
const DEVICE = `${TRACK}/devices/0`;
const NAME = "Ben's Adaptive Tone Shaper";
const PARAMS: Array<[string, number, number, number]> = [
	['Device On', 0, 1, 1],
	['Amount', 0, 10, 5],
	['Lows', -10, 10, 0],
	['Lo-mids', -10, 10, 0],
	['Hi-mids', -10, 10, 0],
	['Highs', -10, 10, 0],
	['Latency', 0, 1, 1],
	['Quality', 0, 1, 0],
	['Lows Hz', 27, 350, 100],
	['Lo-mids Hz', 62, 1000, 350],
	['Hi-mids Hz', 750, 10000, 3500],
	['Highs Hz', 2500, 20000, 6300]
];

function toneShaper(overrides: Record<number, number> = {}): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	PARAMS.forEach(([name, min, max, value], i) => {
		const paramPath = `${DEVICE}/params/${i}`;
		params.set(paramPath, { paramPath, name, displayName: name, min, max, value: overrides[i] ?? value, unit: '' });
	});
	return { devicePath: DEVICE, name: NAME, className: 'MxDeviceAudioEffect', params, properties: new SvelteMap() };
}

function seed(devices: DeviceRecord[]) {
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

const handles = (container: HTMLElement) =>
	Object.fromEntries(
		Array.from(container.querySelectorAll<HTMLElement>('[data-ts-handle]')).map((h) => [
			h.dataset.tsHandle,
			{ level: h.dataset.tsLevel, hz: h.dataset.tsHz, text: h.textContent }
		])
	);

const frame = (level: (b: number) => number, gain: (b: number) => number) => [
	DEVICE,
	...Array.from({ length: 59 }, (_, b) => level(b)),
	...Array.from({ length: 59 }, (_, b) => gain(b))
];

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
	__resetToneShaperStoreForTests();
});
afterEach(() => cleanup());

describe('EQCentralView Tone Shaper', () => {
	it('draws the four handles, the Amount and the switches from params 1–11', async () => {
		seed([toneShaper({ 1: 7.5, 2: 3, 5: -2.5, 7: 1, 8: 80, 11: 12000 })]);
		const { container } = render(EQCentralView);
		await tick();
		expect(handles(container)).toEqual({
			lows: { level: '3.00', hz: '80', text: '80' },
			lomids: { level: '0.00', hz: '350', text: '350' },
			himids: { level: '0.00', hz: '3500', text: '3.5k' },
			highs: { level: '-2.50', hz: '12000', text: '12k' }
		});
		expect(container.querySelector('[data-ts-amount]')?.getAttribute('aria-valuenow')).toBe('7.5');
		expect(container.querySelector('[data-ts-switch="zero"]')?.getAttribute('aria-pressed')).toBe('true');
		expect(container.querySelector('[data-ts-switch="eco"]')?.getAttribute('aria-pressed')).toBe('true');
		expect(container.querySelector('.ts-group')?.classList.contains('slot-ghost')).toBe(false);
		// The view asks the bridge for this device's frames.
		expect(send).toHaveBeenCalledWith('/toneshaper/watch', [DEVICE]);
	});

	it('dims as a ghost when the track has none: Amount 0, the handles at rest, ZERO on', async () => {
		seed([]);
		const { container } = render(EQCentralView);
		await tick();
		expect(container.querySelector('.ts-group')?.classList.contains('slot-ghost')).toBe(true);
		expect(handles(container)).toEqual({
			lows: { level: '0.00', hz: '100', text: '100' },
			lomids: { level: '0.00', hz: '350', text: '350' },
			himids: { level: '0.00', hz: '3500', text: '3.5k' },
			highs: { level: '0.00', hz: '6300', text: '6.3k' }
		});
		expect(container.querySelector('[data-ts-amount]')?.getAttribute('aria-valuenow')).toBe('0');
		expect(container.querySelector('[data-ts-switch="zero"]')?.getAttribute('aria-pressed')).toBe('true');
		expect(container.querySelector('[data-ts-switch="eco"]')?.getAttribute('aria-pressed')).toBe('false');
		expect(container.querySelector('.spectrum')).toBeNull();
		expect(send).toHaveBeenCalledWith('/toneshaper/watch', ['']);
	});

	it('draws the spectrum and the curve from the device\'s frame', async () => {
		seed([toneShaper()]);
		const { container } = render(EQCentralView);
		await tick();
		expect(container.querySelector('.spectrum')).toBeNull();
		expect(container.querySelector('.curve')).toBeNull();
		handleToneShaperFrame('/toneshaper/frame', frame((b) => -20 - b * 0.5, (b) => (b < 30 ? -3 : 2)));
		await tick();
		expect(container.querySelector('.spectrum')?.getAttribute('d')).toMatch(/^M0 1000L/);
		const boost = container.querySelector('.boost')?.getAttribute('d') ?? '';
		const cut = container.querySelector('.cut')?.getAttribute('d') ?? '';
		// 2 dB up is above the zero line (y 500), -3 dB below it.
		expect(boost).toContain(' 416.7');
		expect(cut).toContain(' 625.0');
		expect(container.querySelector('.curve')).not.toBeNull();
	});

	it('ignores a frame of the wrong shape or for another device', () => {
		expect(applyToneShaperFrame(DEVICE, [1, 2, 3], Array(59).fill(0))).toBe(false);
		handleToneShaperFrame('/toneshaper/frame', [DEVICE, 1, 2]);
		handleToneShaperFrame('/toneshaper/frame', frame(() => -30, () => 0).map((v, i) => (i === 3 ? 'x' : v)));
		expect(applyToneShaperFrame('tracks/4/devices/2', Array(59).fill(-30), Array(59).fill(0))).toBe(true);
		seed([toneShaper()]);
		const { container } = render(EQCentralView);
		expect(container.querySelector('.spectrum')).toBeNull();
	});
});
