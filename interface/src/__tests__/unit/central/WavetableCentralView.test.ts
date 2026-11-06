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

const page = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-wavetable-page]')?.dataset.wavetablePage ?? null;

async function mount() {
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
	afterEach(() => cleanup());

	it('lays its sections in signal order, with no oscillator pad', async () => {
		const container = await mount();
		expect(el(container, '[data-face-columns]').dataset.faceColumns).toBe('11');
		const links = [...container.querySelectorAll<HTMLElement>('[data-page]')].map((l) => l.dataset.page);
		expect(links).toEqual(['osc1', 'filter1', 'mod', 'global']);
		// The chain cell's XY is Osc 1's Effect 2 / Wave Position: the face draws its wave, not a pad.
		expect(container.querySelector('.device-xy')).toBeNull();
		expect(container.querySelector('[data-osc-wave]')).not.toBeNull();
	});

	it('opens each section\'s page and comes back to the face, writing nothing', async () => {
		const container = await mount();
		for (const p of ['osc1', 'filter1', 'mod', 'global']) {
			expect(page(container)).toBeNull();
			await fireEvent.click(el(container, `[data-page="${p}"]`));
			expect(page(container)).toBe(p);
			await fireEvent.click(el(container, '.page-back'));
		}
		expect(page(container)).toBeNull();
		expect(paramSets()).toEqual([]);
	});

	it('reaches every modulation source from the mod page, and leads back to it', async () => {
		const container = await mount();
		await fireEvent.click(el(container, '[data-page="mod"]'));
		for (const p of ['amp', 'env2', 'env3', 'lfo1', 'lfo2']) {
			await fireEvent.click(el(container, `.page-link[data-page="${p}"]`));
			expect(page(container)).toBe(p);
			await fireEvent.click(el(container, '.page-back'));
			expect(page(container)).toBe('mod');
		}
		expect(paramSets()).toEqual([]);
	});

	it('picks the filter type from a tab of all five', async () => {
		const container = await mount();
		const types = el(container, '[data-filter-type]');
		expect([...types.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['LP', 'HP', 'BP', 'Notch', 'Morph']);
		await fireEvent.click(button(types, 'Notch'));
		expect(paramSets()).toEqual([[indexOf('Flt 1 Type'), 3]]);
	});

	it('the oscillator page carries its pad', async () => {
		const container = await mount();
		await fireEvent.click(el(container, '[data-page="osc1"]'));
		expect(container.querySelector('.device-xy')).not.toBeNull();
	});

	it('a Sub control switches the Sub on first, as the panel did', async () => {
		const container = await mount();
		await fireEvent.click(el(container, '[data-page="osc1"]'));
		await fireEvent.click(button(el(container, '.panel-choice[data-param="Sub Transpose"]'), '-2'));
		expect(paramSets()).toEqual([
			[indexOf('Sub On'), 1],
			[indexOf('Sub Transpose'), 2]
		]);
	});

	it('the filter page writes by name, and follows the type to its circuit', async () => {
		const container = await mount();
		await fireEvent.click(el(container, '[data-page="filter1"]'));
		expect(container.querySelector('[data-param="Flt 1 LP/HP"]')).not.toBeNull();
		await fireEvent.click(button(el(container, '.panel-choice[data-param="Flt 1 Slope"]'), '24 dB'));
		expect(paramSets()).toEqual([[indexOf('Flt 1 Slope'), 1]]);
	});

	it('an LFO page writes its sync by name', async () => {
		const container = await mount();
		await fireEvent.click(el(container, '[data-page="mod"]'));
		await fireEvent.click(el(container, '.page-link[data-page="lfo2"]'));
		await fireEvent.click(button(el(container, '.panel-choice[data-param="LFO 2 Sync"]'), 'Tempo'));
		expect(paramSets()).toEqual([[indexOf('LFO 2 Sync'), 1]]);
	});

	it('an envelope page writes its loop mode by name', async () => {
		const container = await mount();
		await fireEvent.click(el(container, '[data-page="mod"]'));
		await fireEvent.click(el(container, '.page-link[data-page="env3"]'));
		await fireEvent.click(button(el(container, '.panel-choice[data-param="Env 3 Loop Mode"]'), 'Trigger'));
		expect(paramSets()).toEqual([[indexOf('Env 3 Loop Mode'), 1]]);
	});
});
