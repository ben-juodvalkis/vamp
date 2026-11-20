/**
 * Two of one device on a track are two chain cells, and each cell's slider
 * is its own device's. The Rand Oct and Bass tiles dropped the device their
 * cell handed them and resolved the type's slot instead, so both cells read
 * and wrote the same device: a slide on one moved both (2026-10-27).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
// The stores before the grid (see BassControl.test.ts).
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import ChainOverview from '$lib/components/v6/device-panel/ChainOverview.svelte';
import {
	_resetForTests,
	replaceTree,
	type DeviceRecord,
	type ParamRecord,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import { send } from '$lib/api/simpleClient';
import { fxChainStore } from '$lib/stores/v6/fxChainStore.svelte';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';

const TRACK = 'tracks/0';

function device(index: number, name: string, className: string): DeviceRecord {
	const devicePath = `${TRACK}/devices/${index}`;
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i <= 12; i++) {
		const paramPath = `${devicePath}/params/${i}`;
		// Device On, and everything else at rest.
		params.set(paramPath, { paramPath, name: `P${i}`, displayName: `P${i}`, min: 0, max: 1, value: i === 0 ? 1 : 0, unit: '' });
	}
	return { devicePath, name, className, params, properties: new SvelteMap() };
}

function track(devices: DeviceRecord[], midi: boolean): TrackRecord {
	return {
		trackPath: TRACK, name: 'Keys', color: 0x36a2ff, mute: false, solo: false, arm: false,
		hasMidiInput: midi, hasAudioInput: !midi, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: 'synth',
		devices: new SvelteMap(devices.map((d) => [d.devicePath, d])), slots: new SvelteMap()
	};
}

async function slideSecond(devices: DeviceRecord[], midi: boolean) {
	replaceTree(3, [track(devices, midi)]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
	const { container } = render(ChainOverview, { props: {} });
	await tick();
	const sliders = Array.from(container.querySelectorAll<HTMLElement>('.chain-cell .slider-container'));
	expect(sliders).toHaveLength(2);
	const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
	await fireEvent.pointerDown(sliders[1], { clientX: 50, clientY: 150, pointerId: 1 });
	await fireEvent.pointerMove(sliders[1], { clientX: 50, clientY: 50, pointerId: 1 });
	await frame();
	await fireEvent.pointerUp(sliders[1], { clientX: 50, clientY: 50, pointerId: 1 });
	await tick();
	const writes = vi
		.mocked(send)
		.mock.calls.filter(([address]) => address === '/looping/v3/param/set')
		.map(([, args]) => String((args as unknown[])[0]));
	const fills = sliders.map((s) => s.innerHTML.match(/height: ([0-9.]+)%/)?.[1]);
	return { writes, fills };
}

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
		x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 200, width: 100, height: 200, toJSON: () => ({})
	} as DOMRect);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('two of one device in the chain', () => {
	it.each([
		['Rand Oct', 'Random', 'MidiRandom', true],
		['Bass', 'Bass Amp', 'AudioEffectGroupDevice', false],
		['Saturator', 'Saturator', 'Saturator', false]
	])('a slide on the second %s writes and moves only that one', async (_label, name, className, midi) => {
		const { writes, fills } = await slideSecond(
			[device(0, name, className), device(1, name, className)],
			midi
		);
		expect(writes.length).toBeGreaterThan(0);
		expect(writes.every((p) => p.startsWith(`${TRACK}/devices/1/`))).toBe(true);
		expect(Number(fills[1])).toBeGreaterThan(0);
		expect(Number(fills[0])).toBe(0);
	});
});

describe("REC's recorder in the chain", () => {
	it('draws no cell for Vamp-Capture, and the devices around it keep theirs', async () => {
		replaceTree(3, [
			track([device(0, 'Saturator', 'Saturator'), device(1, 'Vamp-Capture', 'MxDeviceAudioEffect'), device(2, 'Saturator', 'Saturator')], false)
		]);
		selectedTrackStore.handleTrackSelected(0);
		fxGrid.resetForTrackChange();
		const { container } = render(ChainOverview, { props: {} });
		await tick();
		const cells = Array.from(container.querySelectorAll('.chain-cell'));
		expect(cells).toHaveLength(2);
		expect(container.textContent).not.toContain('Vamp-Capture');
	});
});

describe('an Instrument Rack at the head of the chain', () => {
	it('draws its named macros as Live\'s panel, not its first macro alone', async () => {
		const rack = device(0, 'Wurly Blender', 'InstrumentGroupDevice');
		const names = ['Device On', 'Amp Volume', 'Drive', 'Tone', 'Tremolo', 'Macro 5', 'Macro 6', 'Macro 7', 'Macro 8'];
		names.forEach((name, i) => {
			const p = rack.params.get(`${rack.devicePath}/params/${i}`)!;
			rack.params.set(p.paramPath, { ...p, name, displayName: name, max: i === 0 ? 1 : 127 });
		});
		replaceTree(3, [track([rack], true)]);
		selectedTrackStore.handleTrackSelected(0);
		fxGrid.resetForTrackChange();
		const { container } = render(ChainOverview, { props: {} });
		await tick();
		const face = container.querySelector('[data-device-path="tracks/0/devices/0"] .rack-face');
		expect(face).not.toBeNull();
		const named = Array.from(face!.querySelectorAll('.macro:not(.dim)')).map((m) => m.textContent?.trim());
		expect(named).toEqual(expect.arrayContaining(['Amp Volume', 'Drive', 'Tone', 'Tremolo']));
	});
});

describe('the lit cell', () => {
	async function renderChain() {
		replaceTree(3, [track([device(0, 'Operator', 'Operator'), device(1, 'Saturator', 'Saturator')], true)]);
		selectedTrackStore.handleTrackSelected(0);
		fxGrid.resetForTrackChange();
		const { container } = render(ChainOverview, { props: {} });
		await tick();
		const lit = () => Array.from(container.querySelectorAll('.chain-cell.appointed')).map((c) => c.getAttribute('data-device-path'));
		return lit;
	}

	it('is the instrument while its view is open and Live\'s hand is on nothing in the chain', async () => {
		fxChainStore.observeAppointed('tracks/9/devices/0');
		centralDisplayStore.setView('instrument', 'operator');
		const lit = await renderChain();
		expect(lit()).toEqual(['tracks/0/devices/0']);
	});

	it('is the device Live\'s hand is on, whatever view is open', async () => {
		fxChainStore.observeAppointed('tracks/0/devices/1');
		centralDisplayStore.setView('instrument', 'operator');
		const lit = await renderChain();
		expect(lit()).toEqual(['tracks/0/devices/1']);
	});

	it('is nothing outside the instrument view when the hand is elsewhere', async () => {
		fxChainStore.observeAppointed(null);
		centralDisplayStore.setView('clip');
		const lit = await renderChain();
		expect(lit()).toEqual([]);
	});
});

describe("the palette bar's chevron", () => {
	async function renderBar() {
		replaceTree(3, [track([device(0, 'Saturator', 'Saturator')], false)]);
		selectedTrackStore.handleTrackSelected(0);
		fxGrid.resetForTrackChange();
		const { container } = render(ChainOverview, { props: {} });
		await tick();
		const chevron = container.querySelector<HTMLElement>('[data-debug="chain-add"]')!;
		const open = () => container.querySelector('[data-debug="chain-palette"]')?.getAttribute('data-palette-open');
		return { container, chevron, open };
	}
	const down = (el: HTMLElement, id: number, y = 5) => fireEvent.pointerDown(el, { clientX: 5, clientY: y, pointerId: id, button: 0 });
	const up = (el: HTMLElement, id: number, y = 5) => fireEvent.pointerUp(el, { clientX: 5, clientY: y, pointerId: id, button: 0 });

	it('latches the bar open on a tap, and a second tap closes it', async () => {
		const { chevron, open } = await renderBar();
		await down(chevron, 1);
		await tick();
		expect(open()).toBe('true');
		await up(chevron, 1);
		await tick();
		expect(open()).toBe('true');
		await down(chevron, 2);
		await up(chevron, 2);
		await tick();
		expect(open()).toBe('false');
	});

	it('opens the bar only while held', async () => {
		vi.useFakeTimers();
		try {
			const { chevron, open } = await renderBar();
			await down(chevron, 1);
			await tick();
			expect(open()).toBe('true');
			vi.advanceTimersByTime(400);
			await up(chevron, 1);
			await tick();
			expect(open()).toBe('false');
		} finally {
			vi.useRealTimers();
		}
	});

	it('slides down onto a chip and loads it on release, then closes', async () => {
		const { container, chevron, open } = await renderBar();
		await down(chevron, 1);
		await tick();
		const chip = container.querySelector<HTMLElement>('[data-debug="chain-palette"] [data-chip-id^="2:"]');
		expect(chip).not.toBeNull();
		document.elementFromPoint = () => chip;
		await fireEvent.pointerMove(window, { clientX: 5, clientY: 60, pointerId: 1 });
		await tick();
		expect(open()).toBe('true');
		await fireEvent.pointerUp(window, { clientX: 5, clientY: 60, pointerId: 1 });
		await tick();
		expect(open()).toBe('false');
		const loads = vi.mocked(send).mock.calls.filter(([address]) => String(address).includes('device'));
		expect(loads.length).toBeGreaterThan(0);
	});
});
