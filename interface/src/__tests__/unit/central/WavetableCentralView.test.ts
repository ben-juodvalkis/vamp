/**
 * Wavetable's face and its own section pages (ADR-510, re-laid 2026-11-06),
 * mounted against the real v3 store holding the device as the rig's Live
 * lists it (docs/reference/instruments/dumps/Wavetable.json).
 *
 * Pins what the shots cannot: the face's sections and the pages they open,
 * that the face carries no oscillator pad (the chain cell's XY is Osc 1's),
 * that the filter type is one tab of all five, and that a page's control
 * writes ITS parameter by name, turning its section on first as the panel
 * pages did.
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
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { replaceTree, _resetForTests, type TrackRecord, type DeviceRecord, type ParamRecord } from '$lib/stores/v3/normalized.svelte';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import WavetableCentralView from '$lib/components/v6/central/views/WavetableCentralView.svelte';
import WAVETABLE from '../../../../../docs/reference/instruments/dumps/Wavetable.json';

const sendMock = vi.mocked(send);
const TRACK = 'tracks/0';
const DEVICE = `${TRACK}/devices/0`;

interface Dump {
	parameters: { index: number; name: string; min: number; max: number; value: number }[];
}
const DUMP = WAVETABLE as Dump;

function track(dump: Dump): TrackRecord {
	const params = new SvelteMap<string, ParamRecord>();
	for (const p of dump.parameters) {
		const paramPath = `${DEVICE}/params/${p.index}`;
		params.set(paramPath, { paramPath, name: p.name, displayName: p.name, min: p.min, max: p.max, value: p.value, unit: '' });
	}
	const device: DeviceRecord = { devicePath: DEVICE, name: 'Wavetable', className: 'InstrumentVector', params, properties: new SvelteMap() };
	return {
		trackPath: TRACK,
		name: 'Wavetable',
		color: 0x9a7cf2,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: 'keys',
		devices: new SvelteMap<string, DeviceRecord>([[DEVICE, device]]),
		slots: new SvelteMap()
	};
}

const instrument = { deviceIndex: 0, className: 'InstrumentVector', name: 'Wavetable', type: 'instrument' as const, devicePath: DEVICE };

/** Each `/looping/v3/param/set` as [param index, value]. */
function paramSets(): [number, number][] {
	return sendMock.mock.calls
		.filter(([addr]) => addr === '/looping/v3/param/set')
		.map(([, args]) => {
			const [path, value] = args as [string, number];
			return [Number(path.split('/').pop()), value];
		});
}

const indexOf = (name: string) => DUMP.parameters.find((p) => p.name === name)!.index;

function el(container: HTMLElement, selector: string): HTMLElement {
	const found = container.querySelector<HTMLElement>(selector);
	if (!found) throw new Error(`nothing matches ${selector}`);
	return found;
}

function button(scope: HTMLElement, label: string): HTMLElement {
	const found = [...scope.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.trim() === label);
	if (!found) throw new Error(`no button ${label}`);
	return found;
}

/** One tile of the full-screen board (ADR-512), by its page id. */
const tile = (container: HTMLElement, id: string) => el(container, `[data-board-tile="${id}"]`);

async function mount(expanded = false) {
	centralDisplayStore.setExpanded(expanded);
	const result = render(WavetableCentralView, { props: { instrument } });
	await tick();
	return result.container;
}

describe('WavetableCentralView — its face and its own pages (ADR-510)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		replaceTree(7, [track(DUMP)]);
		selectedTrackStore.handleTrackSelected(0);
	});
	afterEach(() => {
		cleanup();
		centralDisplayStore.setExpanded(false);
	});

	it('lays its sections in signal order, with no oscillator pad and no page to open', async () => {
		const container = await mount();
		expect(el(container, '[data-face-columns]').dataset.faceColumns).toBe('11');
		// The normal view is one page (2026-11-07): a section's name is its name, not a link.
		expect(container.querySelector('[data-page]')).toBeNull();
		expect(container.querySelector('[data-wavetable-page]')).toBeNull();
		// The chain cell's XY is Osc 1's Effect 2 / Wave Position: the face draws its wave, not a pad.
		expect(container.querySelector('.device-xy')).toBeNull();
		expect(container.querySelector('[data-osc-wave]')).not.toBeNull();
	});

	it('picks the filter type from a tab of all five', async () => {
		const container = await mount();
		const types = el(container, '[data-filter-type]');
		expect([...types.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['LP', 'HP', 'BP', 'Notch', 'Morph']);
		await fireEvent.click(button(types, 'Notch'));
		expect(paramSets()).toEqual([[indexOf('Flt 1 Type'), 3]]);
	});

	it('at full screen draws every page as a tile, writing nothing', async () => {
		const container = await mount(true);
		const tiles = [...container.querySelectorAll<HTMLElement>('[data-board-tile]')].map((t) => t.dataset.boardTile);
		expect(tiles).toEqual(['osc1', 'osc2', 'filter1', 'filter2', 'amp', 'env2', 'env3', 'lfo1', 'lfo2', 'global']);
		expect(paramSets()).toEqual([]);
	});

	it('an oscillator tile carries its pad and its wavetable choosers', async () => {
		const container = await mount(true);
		expect(tile(container, 'osc1').querySelector('.device-xy')).not.toBeNull();
		expect(tile(container, 'osc1').querySelector('[data-wavetable-choosers="1"]')).not.toBeNull();
	});

	it('a Sub control switches the Sub on first, as the panel did', async () => {
		const container = await mount(true);
		await fireEvent.click(button(el(tile(container, 'osc1'), '.panel-choice[data-param="Sub Transpose"]'), '-2'));
		expect(paramSets()).toEqual([
			[indexOf('Sub On'), 1],
			[indexOf('Sub Transpose'), 2]
		]);
	});

	it('a filter tile is a pad, writes by name, and follows the type to its circuit', async () => {
		const container = await mount(true);
		const filter = tile(container, 'filter1');
		expect(filter.querySelector('[data-filter-pad="1"]')).not.toBeNull();
		expect(filter.querySelector('[data-param="Flt 1 LP/HP"]')).not.toBeNull();
		await fireEvent.click(button(el(filter, '.panel-choice[data-param="Flt 1 Slope"]'), '24 dB'));
		expect(paramSets()).toEqual([[indexOf('Flt 1 Slope'), 1]]);
	});

	it('an LFO tile writes its sync by name', async () => {
		const container = await mount(true);
		await fireEvent.click(button(el(tile(container, 'lfo2'), '.panel-choice[data-param="LFO 2 Sync"]'), 'Tempo'));
		expect(paramSets()).toEqual([[indexOf('LFO 2 Sync'), 1]]);
	});
});
