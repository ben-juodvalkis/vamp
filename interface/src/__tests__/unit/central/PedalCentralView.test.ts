/**
 * PedalCentralView (ADR-431): seven columns — Digital, Redux, the Pedal's
 * XY and its type tabs (since 2026-10-05, when the Saturator's XY became the
 * fx5 grid tile that opens this view), the Saturator's Output and Mix
 * faders, since the ten-column FX-grid cut (2026-09-15) the Guitar amp
 * rack's drive slider, and since ADR-445 (2026-09-19) the Wah button. The
 * Pedal reads its own device and a tap on its pad stays in this view.
 *
 * Since 2026-10-05 the Guitar rack's whole face is here too (GuitarCentralView
 * is gone): Gain (the tile, MIDI tracks only — on audio the grid's Gtr column
 * draws it), Spring, the Tremolo pad, Room and Dirty/Clean, on Guitar.adg's
 * macros 1-6.
 *
 * The Wah has no tile and no view of its own — the expression pedal plays
 * it — so this button is its only door on the iPad: a tap loads Wah.adg onto
 * the selected track through `device/load`, a hold removes it through
 * `device/delete`, and it is lit while the track carries one.
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
	_resetForTests,
	type TrackRecord,
	type DeviceRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';
import PedalCentralView from '$lib/components/v6/central/views/PedalCentralView.svelte';
import { send } from '$lib/api/simpleClient';
import { DEVICE_PRESETS } from '$lib/config/devicePresets';
import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';

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

function wahRack(pedal = 0): DeviceRecord {
	// Device On plus the two macros the pedal component drives (freq, chain
	// selector) — the shape `Wah.adg` takes once loaded, under the class and
	// name the wah slot matches on.
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i <= 2; i++) {
		const paramPath = `${WAH}/params/${i}`;
		params.set(paramPath, {
			paramPath, name: i === 0 ? 'Device On' : `Macro ${i}`, displayName: i === 0 ? 'Device On' : `Macro ${i}`,
			min: 0, max: i === 0 ? 1 : 127, value: i === 0 ? 1 : i === 1 ? pedal : 0, unit: ''
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
	// The rig: the Wah exists only while the expression pedal is switched on
	// (PedalCentralView.features.test.ts covers it switched off).
	bridgeStatus.updateFeatures(
		JSON.stringify({ expressionPedal: { enabled: true, available: true, reason: '' } })
	);
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => {
	cleanup();
	bridgeStatus.updateFeatures('{}');
});

describe('PedalCentralView', () => {
	it('carries the Pedal pad and tabs, and only the Saturator\'s Output and Mix faders', async () => {
		seed([saturator({ 1: 0.75, 8: 0.2, 10: 1, 11: 1 }), pedal()]);
		const { container } = render(PedalCentralView);
		await tick();
		expect(container.querySelector('.pedal-column .pedal-tone .eq-panel')).not.toBeNull();
		expect(container.querySelector('.pedal-column .pedal-tone')?.classList.contains('slot-ghost')).toBe(false);
		expect(container.querySelector('.pedal-column .pedal-drive [role="slider"]')).not.toBeNull();
		// No Saturator pad here: that is the grid tile.
		expect(container.textContent).not.toContain('Saturator');
		for (const title of ['Output', 'Mix']) {
			expect(slider(container, title), title).toBeDefined();
		}
		// Drive and Color Hi are the tile's two axes, not faders.
		const satFaders = container.querySelector<HTMLElement>('.saturator-faders')!;
		for (const title of ['Drive', 'Color Hi']) {
			expect(slider(satFaders, title), title).toBeUndefined();
		}
		expect(container.textContent).toContain('Distort');
	});

	it('carries a Shifter fader in place of the Digital pad', async () => {
		seed([]);
		const { container } = render(PedalCentralView);
		await tick();
		expect(container.textContent).not.toContain('Digital');
		// Shifter, then Output · Mix over Redux, close the view on the right (2026-10-05).
		const columns = container.querySelectorAll('.pedal-central-layout > .column');
		expect(columns[columns.length - 2].classList.contains('shifter-column')).toBe(true);
		const last = columns[columns.length - 1];
		expect(last.classList.contains('sat-redux-column')).toBe(true);
		expect(last.children[0].classList.contains('saturator-faders')).toBe(true);
		expect(last.children[1].classList.contains('redux-column')).toBe(true);
		expect(slider(container, 'Shifter')).toBeDefined();
	});

	it('a tap on a ghost Shifter loads Live\'s Shifter', async () => {
		HTMLElement.prototype.setPointerCapture = vi.fn();
		HTMLElement.prototype.releasePointerCapture = vi.fn();
		seed([]);
		const { container } = render(PedalCentralView);
		await tick();
		const el = slider(container, 'Shifter')!;
		el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
		el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
		await tick();
		const loads = vi.mocked(send).mock.calls.filter(([addr]) => addr === '/looping/v3/device/load');
		expect(loads.length).toBe(1);
		expect(JSON.stringify(loads[0][1])).toContain('Shifter');
	});

	it('ghosts the Pedal pad and the Saturator faders on a track without either', async () => {
		seed([]);
		const { container } = render(PedalCentralView);
		await tick();
		expect(container.querySelector('.pedal-column .pedal-tone')?.classList.contains('slot-ghost')).toBe(true);
		expect(container.querySelector('.pedal-column .pedal-drive')?.classList.contains('slot-ghost')).toBe(true);
		expect((container.querySelector('.saturator-faders') as HTMLElement).style.opacity).toContain('--opacity-ghost');
	});

	it('carries the Guitar rack: Gain, the Spring/Room pad over the Tremolo pad, and Dirty/Clean', async () => {
		seed([saturator({}), guitarRack()]);
		const { container } = render(PedalCentralView);
		await tick();
		const tile = container.querySelector('.left-stack .device-control');
		expect(tile?.classList.contains('device-ghost')).toBe(false);
		expect(tile?.textContent).toContain('Gtr');
		const pads = Array.from(container.querySelectorAll('.guitar-xy-stack .guitar-xy'));
		expect(pads.map((p) => p.textContent)).toEqual([expect.stringContaining('Spring/Room'), expect.stringContaining('Tremolo')]);
		const tone = Array.from(container.querySelectorAll<HTMLButtonElement>('.guitar-section .tone-btn'));
		expect(tone.map((b) => b.textContent?.trim())).toEqual(['Dirty', 'Clean']);
		expect(tone.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
	});

	it('leaves Gain out on an audio track, where the grid draws it', async () => {
		seed([saturator({}), guitarRack()], true);
		const { container } = render(PedalCentralView);
		await tick();
		expect(container.querySelector('.left-stack .device-control')).toBeNull();
		expect(container.querySelectorAll('.guitar-xy-stack .guitar-xy').length).toBe(2);
	});

	it('lights Clean above the midpoint, and Dirty writes macro 6 to 0', async () => {
		seed([saturator({}), guitarRack(127)]);
		const { container } = render(PedalCentralView);
		await tick();
		const tone = Array.from(container.querySelectorAll<HTMLButtonElement>('.guitar-section .tone-btn'));
		expect(tone[1].getAttribute('aria-pressed')).toBe('true');
		tone[0].click();
		await tick();
		expect(send).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([`${GTR}/params/6`, 0]));
	});

	it('ghosts the Guitar section on a track with no amp rack', async () => {
		seed([saturator({})]);
		const { container } = render(PedalCentralView);
		await tick();
		expect(
			container.querySelector('.left-stack .device-control')?.classList.contains('device-ghost')
		).toBe(true);
	});

	it('keeps a tap on the Gain slider inside this view', async () => {
		HTMLElement.prototype.setPointerCapture = vi.fn();
		HTMLElement.prototype.releasePointerCapture = vi.fn();
		seed([saturator({}), guitarRack()]);
		centralDisplayStore.setView('device', 'pedal');
		const { container } = render(PedalCentralView);
		await tick();
		const el = container.querySelector<HTMLElement>('.left-stack .device-control [role="slider"]');
		expect(el).not.toBeNull();
		el!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
		el!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
		await tick();
		expect(centralDisplayStore.isViewActive('device', 'pedal')).toBe(true);
	});

	it('heads the Guitar group with Dirty/Clean, then the Gain over the Wah, after the Pedal', async () => {
		seed([saturator({}), guitarRack()]);
		const { container } = render(PedalCentralView);
		await tick();
		const columns = container.querySelectorAll('.pedal-central-layout > .column');
		expect(columns[0].classList.contains('pedal-column')).toBe(true);
		const group = container.querySelector('.guitar-section')!.children;
		expect(group[0].classList.contains('tone-stack')).toBe(true);
		const stack = group[1];
		expect(stack.classList.contains('left-stack')).toBe(true);
		const cells = stack.querySelectorAll('.left-cell');
		expect(cells.length).toBe(2);
		expect(cells[0].textContent).toContain('Gtr');
		expect(cells[1].classList.contains('wah-cell')).toBe(true);
		expect(slider(container, 'Wah')).toBeDefined();
	});

	it('leaves the Wah alone in the left column on an audio track', async () => {
		seed([saturator({})], true);
		const { container } = render(PedalCentralView);
		await tick();
		const cells = container.querySelectorAll('.left-stack .left-cell');
		expect(cells.length).toBe(1);
		expect(cells[0].classList.contains('wah-cell')).toBe(true);
	});

	it('shows the Wah pedal macro\'s value on its slider', async () => {
		seed([saturator({}), wahRack(127)]);
		const { container } = render(PedalCentralView);
		await tick();
		expect(slider(container, 'Wah')!.getAttribute('aria-valuenow')).toBe('1');
	});

	it('a tap on a ghost Wah loads Wah.adg onto the selected track through device/load', async () => {
		HTMLElement.prototype.setPointerCapture = vi.fn();
		HTMLElement.prototype.releasePointerCapture = vi.fn();
		seed([saturator({})]);
		const { container } = render(PedalCentralView);
		await tick();
		const el = slider(container, 'Wah')!;
		el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
		el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
		await tick();
		expect(send).toHaveBeenCalledWith('/looping/v3/device/load', [TRACK, '', '', 'place:Vamp Devices', 'Wah/Wah.adg']);
	});

	it('keeps a tap on the Pedal tone pad inside this view', async () => {
		// jsdom has no pointer capture; the pad asks for it on every press.
		HTMLElement.prototype.setPointerCapture = vi.fn();
		HTMLElement.prototype.releasePointerCapture = vi.fn();
		seed([pedal()]);
		centralDisplayStore.setView('device', 'pedal');
		const { container } = render(PedalCentralView);
		await tick();
		const pad = container.querySelector<HTMLElement>('.pedal-tone .eq-panel');
		expect(pad).not.toBeNull();
		pad!.click();
		await tick();
		expect(centralDisplayStore.isViewActive('device', 'pedal')).toBe(true);
		expect(vi.mocked(send).mock.calls.filter(([addr]) => addr === '/looping/v3/device/load')).toEqual([]);
	});

	it('drags the Pedal\'s Bass on the tone pad\'s left third, in Live\'s -1..1', async () => {
		HTMLElement.prototype.setPointerCapture = vi.fn();
		HTMLElement.prototype.releasePointerCapture = vi.fn();
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
