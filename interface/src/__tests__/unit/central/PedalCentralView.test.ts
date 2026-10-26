/**
 * The Pedal family's views, one device each since the FX chain overview
 * took over from the grid (2026-10-26): the Pedal (PedalCentralView), the
 * Saturator, the Shifter, Redux, the Guitar rack (GuitarCentralView), the
 * Wah and the Bass Amp. They shared the Pedal view (`part`) until then.
 *
 * The Guitar rack's macros 1-5 are Gain, Spring, Trem Rate, Trem Amount and
 * Room; the Amp Switch (macro 6, Dirty/Clean) has no control since
 * 2026-10-22. The Wah is a slider on Wah.adg's Macro 1, titled with the chain
 * its Macro 2 selects.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import {
	replaceTree,
	applyPropertyValue,
	_resetForTests,
	type TrackRecord,
	type DeviceRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';
import { _refcountForTest } from '$lib/stores/v3/propertySubscriptions.svelte';
import PedalCentralView from '$lib/components/v6/central/views/PedalCentralView.svelte';
import SaturatorCentralView from '$lib/components/v6/central/views/SaturatorCentralView.svelte';
import ShifterCentralView from '$lib/components/v6/central/views/ShifterCentralView.svelte';
import ReduxCentralView from '$lib/components/v6/central/views/ReduxCentralView.svelte';
import GuitarCentralView from '$lib/components/v6/central/views/GuitarCentralView.svelte';
import WahCentralView from '$lib/components/v6/central/views/WahCentralView.svelte';
import BassCentralView from '$lib/components/v6/central/views/BassCentralView.svelte';
import { send } from '$lib/api/simpleClient';

const TRACK = 'tracks/0';
const SAT = `${TRACK}/devices/0`;
const GTR = `${TRACK}/devices/1`;
const WAH = `${TRACK}/devices/2`;
const PEDAL = `${TRACK}/devices/3`;

function pedal(): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i <= 9; i++) {
		const paramPath = `${PEDAL}/params/${i}`;
		params.set(paramPath, { paramPath, name: `P${i}`, displayName: `P${i}`, min: 0, max: 1, value: 0, unit: '' });
	}
	return { devicePath: PEDAL, name: 'Pedal', className: 'Pedal', params, properties: new SvelteMap() };
}

function saturator(values: Record<number, number>): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i <= 11; i++) {
		const paramPath = `${SAT}/params/${i}`;
		params.set(paramPath, { paramPath, name: `P${i}`, displayName: `P${i}`, min: 0, max: 1, value: values[i] ?? 0, unit: '' });
	}
	return { devicePath: SAT, name: 'Saturator', className: 'Saturator', params, properties: new SvelteMap() };
}

function guitarRack(ampSwitch = 0): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	const names = ['Device On', 'Gain', 'Spring', 'Trem Rate', 'Trem Amount', 'Room', 'Amp Switch', 'Room', 'Macro 8'];
	names.forEach((name, i) => {
		const paramPath = `${GTR}/params/${i}`;
		params.set(paramPath, {
			paramPath, name, displayName: name,
			min: 0, max: i === 0 ? 1 : 127, value: i === 6 ? ampSwitch : 0, unit: ''
		});
	});
	return {
		devicePath: GTR, name: 'Guitar', className: 'AudioEffectGroupDevice',
		params, properties: new SvelteMap()
	};
}

function wahRack(pedal = 0, chain = 0): DeviceRecord {
	// Device On plus the two macros the pedal component drives (freq, chain
	// selector) — the shape `Wah.adg` takes once loaded, under the class and
	// name the wah slot matches on.
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i <= 2; i++) {
		const paramPath = `${WAH}/params/${i}`;
		params.set(paramPath, {
			paramPath, name: i === 0 ? 'Device On' : `Macro ${i}`, displayName: i === 0 ? 'Device On' : `Macro ${i}`,
			min: 0, max: i === 0 ? 1 : 127, value: i === 0 ? 1 : i === 1 ? pedal : chain, unit: ''
		});
	}
	return {
		devicePath: WAH, name: 'Wah', className: 'AudioEffectGroupDevice',
		params, properties: new SvelteMap()
	};
}

function seed(devices: DeviceRecord[], audio = false) {
	const t: TrackRecord = {
		trackPath: TRACK, name: 'Keys', color: 0xfff034, mute: false, solo: false, arm: false,
		hasMidiInput: !audio, hasAudioInput: audio, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: '',
		devices: new SvelteMap(devices.map((d) => [d.devicePath, d])), slots: new SvelteMap()
	};
	replaceTree(3, [t]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
}

function slider(container: HTMLElement, title: string): HTMLElement | undefined {
	return Array.from(container.querySelectorAll<HTMLElement>('[role="slider"]')).find((s) =>
		s.getAttribute('aria-label')?.startsWith(`${title}:`)
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => {
	cleanup();
});

const tapOn = (el: HTMLElement) => {
	el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
	el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
};
const loads = () => vi.mocked(send).mock.calls.filter(([addr]) => addr === '/looping/v3/device/load');

beforeEach(() => {
	HTMLElement.prototype.setPointerCapture = vi.fn();
	HTMLElement.prototype.releasePointerCapture = vi.fn();
});

describe('PedalCentralView — the Pedal alone', () => {
	it('carries the Drive slider, the tone pad and the type tabs, and no other device', async () => {
		seed([saturator({}), guitarRack(), wahRack(), pedal()]);
		const { container } = render(PedalCentralView);
		await tick();
		expect(container.querySelector('.pedal-tone .eq-panel')).not.toBeNull();
		expect(container.querySelector('.pedal-tone')?.classList.contains('slot-ghost')).toBe(false);
		expect(container.querySelector('.pedal-drive [role="slider"]')).not.toBeNull();
		expect(container.textContent).toContain('Distort');
		for (const title of ['Output', 'Mix', 'Shifter', 'Wah', 'Gtr']) {
			expect(slider(container, title), title).toBeUndefined();
		}
		expect(container.textContent).not.toMatch(/Spring\/Room|Redux|Drum/);
	});

	it('ghosts the Pedal on a track without one', async () => {
		seed([]);
		const { container } = render(PedalCentralView);
		await tick();
		expect(container.querySelector('.pedal-tone')?.classList.contains('slot-ghost')).toBe(true);
		expect(container.querySelector('.pedal-drive')?.classList.contains('slot-ghost')).toBe(true);
	});

	it('keeps a tap on the tone pad inside this view', async () => {
		seed([pedal()]);
		centralDisplayStore.setView('device', 'pedal');
		const { container } = render(PedalCentralView);
		await tick();
		container.querySelector<HTMLElement>('.pedal-tone .eq-panel')!.click();
		await tick();
		expect(centralDisplayStore.isViewActive('device', 'pedal')).toBe(true);
		expect(loads()).toEqual([]);
	});

	it("drags the Pedal's Bass on the tone pad's left third, in Live's -1..1", async () => {
		seed([pedal()]);
		const { container } = render(PedalCentralView);
		await tick();
		const low = container.querySelector<HTMLElement>('.pedal-tone [data-band="low"]')!;
		low.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 100 }));
		low.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 50, buttons: 1 }));
		low.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 50 }));
		await tick();
		// Bass rests at 0 (flat, the pad's middle); 50px up is half the range: +1.
		expect(send).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([`${PEDAL}/params/4`, 1]));
	});

	it('writes Drive and Dry/Wet together from the one Drive slider', async () => {
		seed([pedal()]);
		const { container } = render(PedalCentralView);
		await tick();
		const drive = container.querySelector<HTMLElement>('.pedal-drive [role="slider"]')!;
		const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
			x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 400, width: 100, height: 400, toJSON: () => ({})
		} as DOMRect);
		const at = (type: string, y: number) =>
			drive.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: 50, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
		at('pointerdown', 300);
		at('pointermove', 280);
		at('pointermove', 100);
		await new Promise((r) => setTimeout(r, 50));
		at('pointerup', 100);
		rect.mockRestore();
		const writes = (index: number) =>
			vi.mocked(send).mock.calls
				.map(([, args]) => args as unknown[])
				.filter((a) => a.includes(`${PEDAL}/params/${index}`))
				.map((a) => a[a.indexOf(`${PEDAL}/params/${index}`) + 1] as number);
		const drv = writes(2);
		expect(drv.length).toBeGreaterThan(0);
		expect(drv.at(-1)).toBeGreaterThan(0);
		expect(writes(9).at(-1)).toBe(drv.at(-1));
	});
});

describe('SaturatorCentralView', () => {
	it("carries the Saturator's Color, Output and Mix, and no Drive (the tile's)", async () => {
		seed([saturator({ 1: 0.75, 8: 0.2, 10: 1, 11: 1 })]);
		const { container } = render(SaturatorCentralView);
		await tick();
		for (const title of ['Color', 'Output', 'Mix']) {
			expect(slider(container, title), title).toBeDefined();
		}
		expect(slider(container, 'Drive')).toBeUndefined();
		expect(container.textContent).not.toMatch(/Shifter|Redux|Drum/);
	});

	it('ghosts the faders on a track without a Saturator', async () => {
		seed([]);
		const { container } = render(SaturatorCentralView);
		await tick();
		const cols = container.querySelectorAll('.slider-col');
		expect(cols.length).toBe(3);
		cols.forEach((c) => expect(c.classList.contains('slot-ghost')).toBe(true));
	});
});

describe('ShifterCentralView', () => {
	it("a tap on a ghost Shifter loads Live's Shifter", async () => {
		seed([]);
		const { container } = render(ShifterCentralView);
		await tick();
		tapOn(slider(container, 'Shifter')!);
		await tick();
		expect(loads().length).toBe(1);
		expect(JSON.stringify(loads()[0][1])).toContain('Shifter');
	});
});

describe('ReduxCentralView', () => {
	it('draws the Redux pad, not a placeholder', async () => {
		seed([]);
		const { container } = render(ReduxCentralView);
		await tick();
		expect(container.querySelector('[data-view="redux"] .device-control')).not.toBeNull();
		expect(container.textContent).not.toContain('No device loaded');
	});
});

describe('GuitarCentralView — the Guitar rack alone', () => {
	it('carries the Gain, the Spring/Room pad over the Tremolo pad, and no Dirty/Clean', async () => {
		seed([saturator({}), guitarRack(), pedal()]);
		const { container } = render(GuitarCentralView);
		await tick();
		const tile = container.querySelector('.gain .device-control');
		expect(tile?.classList.contains('device-ghost')).toBe(false);
		expect(tile?.textContent).toContain('Gtr');
		const pads = Array.from(container.querySelectorAll('.pads .guitar-xy'));
		expect(pads.map((p) => p.textContent)).toEqual([expect.stringContaining('Spring/Room'), expect.stringContaining('Tremolo')]);
		expect(container.textContent).not.toMatch(/Dirty|Clean|Distort|Wah/);
	});

	it('ghosts the Guitar on a track with no amp rack', async () => {
		seed([saturator({})]);
		const { container } = render(GuitarCentralView);
		await tick();
		expect(container.querySelector('.gain .device-control')?.classList.contains('device-ghost')).toBe(true);
	});

	it('keeps a tap on the Gain slider inside this view', async () => {
		seed([guitarRack()]);
		centralDisplayStore.setView('device', 'guitar');
		const { container } = render(GuitarCentralView);
		await tick();
		const el = container.querySelector<HTMLElement>('.gain .device-control [role="slider"]');
		expect(el).not.toBeNull();
		tapOn(el!);
		await tick();
		expect(centralDisplayStore.isViewActive('device', 'guitar')).toBe(true);
	});
});

describe('WahCentralView', () => {
	it("shows the Wah pedal macro's value on its slider, without the pedal switch", async () => {
		seed([wahRack(127)]);
		const { container } = render(WahCentralView);
		await tick();
		expect(slider(container, 'Wah')!.getAttribute('aria-valuenow')).toBe('1');
	});

	it('titles the slider with the chain Macro 2 selects, and subscribes the names', async () => {
		seed([wahRack(0, 64)]);
		const { container } = render(WahCentralView);
		await tick();
		expect(_refcountForTest(WAH, 'chain_names')).toBe(1);
		expect(slider(container, 'Wah')).toBeDefined();
		applyPropertyValue(WAH, 'chain_names', JSON.stringify(['Wah', 'Volume', 'Ring']));
		await tick();
		expect(slider(container, 'Volume')).toBeDefined();
		expect(slider(container, 'Wah')).toBeUndefined();
	});

	it('names the first and last chains at the ends of Macro 2', async () => {
		for (const [chain, name] of [[0, 'Wah'], [127, 'Ring']] as const) {
			seed([wahRack(0, chain)]);
			applyPropertyValue(WAH, 'chain_names', JSON.stringify(['Wah', 'Volume', 'Ring']));
			const { container } = render(WahCentralView);
			await tick();
			expect(slider(container, name), name).toBeDefined();
			cleanup();
		}
	});

	it('a tap on a ghost Wah loads Wah.adg onto the selected track through device/load', async () => {
		seed([]);
		const { container } = render(WahCentralView);
		await tick();
		tapOn(slider(container, 'Wah')!);
		await tick();
		expect(send).toHaveBeenCalledWith('/looping/v3/device/load', [TRACK, '', '', 'place:Vamp Devices', 'Wah/Wah.adg']);
	});
});

describe('BassCentralView', () => {
	it("draws the Bass Amp's one control", async () => {
		seed([], true);
		const { container } = render(BassCentralView);
		await tick();
		expect(slider(container, 'Bass')).toBeDefined();
	});
});
