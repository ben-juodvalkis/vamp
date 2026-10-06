/**
 * PedalCentralView (ADR-431): seven columns — Digital, Redux, the Pedal's
 * XY and its type tabs (since 2026-10-05, when the Saturator's XY became the
 * fx5 grid tile that opens this view), the Saturator's Output and Mix
 * faders, since the ten-column FX-grid cut (2026-09-15) the Guitar amp
 * rack's drive slider, and since ADR-445 (2026-09-19) the Wah button. The
 * Pedal reads its own device and a tap on its pad stays in this view.
 *
 * The Guitar is the opposite case, and the reason it is pinned here: its tap
 * must LEAVE, because this mount is the only door left to GuitarCentralView
 * on a MIDI track once the Gtr tile left the grid.
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
import { HOLD_MS } from '$lib/actions';
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

function guitarRack(): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i <= 8; i++) {
		const paramPath = `${GTR}/params/${i}`;
		params.set(paramPath, {
			paramPath, name: `Macro ${i}`, displayName: `Macro ${i}`,
			min: 0, max: 127, value: 0, unit: ''
		});
	}
	return {
		devicePath: GTR, name: 'Guitar', className: 'AudioEffectGroupDevice',
		params, properties: new SvelteMap()
	};
}

function wahRack(): DeviceRecord {
	// Device On plus the two macros the pedal component drives (freq, chain
	// selector) — the shape `Wah.adg` takes once loaded, under the class and
	// name the wah slot matches on.
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i <= 2; i++) {
		const paramPath = `${WAH}/params/${i}`;
		params.set(paramPath, {
			paramPath, name: i === 0 ? 'Device On' : `Macro ${i}`, displayName: i === 0 ? 'Device On' : `Macro ${i}`,
			min: 0, max: i === 0 ? 1 : 127, value: i === 0 ? 1 : 0, unit: ''
		});
	}
	return {
		devicePath: WAH, name: 'Wah', className: 'AudioEffectGroupDevice',
		params, properties: new SvelteMap()
	};
}

function seed(devices: DeviceRecord[]) {
	const t: TrackRecord = {
		trackPath: TRACK, name: 'Keys', color: 0xfff034, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
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
		expect(container.querySelector('.pedal-xy-column .device-control')).not.toBeNull();
		expect(container.querySelector('.pedal-xy-column .device-control')?.classList.contains('device-ghost')).toBe(false);
		// No Saturator pad here: that is the grid tile.
		expect(container.textContent).not.toContain('Saturator');
		for (const title of ['Output', 'Mix']) {
			expect(slider(container, title), title).toBeDefined();
		}
		// Drive and Color Hi are the tile's two axes, not faders.
		for (const title of ['Drive', 'Color Hi']) {
			expect(slider(container, title), title).toBeUndefined();
		}
		expect(container.textContent).toContain('Distort');
	});

	it('ghosts the Pedal pad and the Saturator faders on a track without either', async () => {
		seed([]);
		const { container } = render(PedalCentralView);
		await tick();
		expect(container.querySelector('.pedal-xy-column .device-control')?.classList.contains('device-ghost')).toBe(true);
		expect((container.querySelector('.saturator-faders') as HTMLElement).style.opacity).toContain('--opacity-ghost');
	});

	it('carries the Guitar rack\'s drive slider as its last column', async () => {
		seed([saturator({}), guitarRack()]);
		const { container } = render(PedalCentralView);
		await tick();
		const tile = container.querySelector('.guitar-column .device-control');
		expect(tile).not.toBeNull();
		// A real device on the track, so the tile is live rather than ghost.
		expect(tile?.classList.contains('device-ghost')).toBe(false);
		expect(tile?.textContent).toContain('Gtr');
	});

	it('ghosts the Guitar column on a track with no amp rack', async () => {
		seed([saturator({})]);
		const { container } = render(PedalCentralView);
		await tick();
		expect(
			container.querySelector('.guitar-column .device-control')?.classList.contains('device-ghost')
		).toBe(true);
	});

	it('lets a tap on the Guitar slider LEAVE for the Guitar view', async () => {
		// The one behaviour that separates it from the Pedal pad:
		// this view is the Pedal's home and only the Guitar's doorway.
		HTMLElement.prototype.setPointerCapture = vi.fn();
		HTMLElement.prototype.releasePointerCapture = vi.fn();
		seed([saturator({}), guitarRack()]);
		centralDisplayStore.setView('device', 'pedal');
		const { container } = render(PedalCentralView);
		await tick();
		const el = container.querySelector<HTMLElement>('.guitar-column [role="slider"]');
		expect(el).not.toBeNull();
		el!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
		el!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
		await tick();
		expect(centralDisplayStore.isViewActive('device', 'guitar')).toBe(true);
	});

	it('carries a Wah button as its last column, ghosted on a track without one', async () => {
		seed([saturator({}), guitarRack()]);
		const { container } = render(PedalCentralView);
		await tick();
		const columns = container.querySelectorAll('.pedal-central-layout > .column');
		expect(columns[columns.length - 1].classList.contains('wah-column')).toBe(true);
		const button = container.querySelector<HTMLButtonElement>('.wah-column .wah-button');
		expect(button).not.toBeNull();
		expect(button!.textContent?.trim()).toBe('Wah');
		expect(button!.classList.contains('active')).toBe(false);
		expect(button!.getAttribute('aria-pressed')).toBe('false');
		expect((container.querySelector('.wah-column') as HTMLElement).style.opacity).toContain('--opacity-ghost');
	});

	it('lights the Wah button while the track carries a wah', async () => {
		seed([saturator({}), guitarRack(), wahRack()]);
		const { container } = render(PedalCentralView);
		await tick();
		const button = container.querySelector<HTMLButtonElement>('.wah-column .wah-button');
		expect(button!.classList.contains('active')).toBe(true);
		expect(button!.getAttribute('aria-pressed')).toBe('true');
		expect((container.querySelector('.wah-column') as HTMLElement).style.opacity).toBe('');
	});

	it('a tap on a ghost Wah loads Wah.adg onto the selected track through device/load', async () => {
		seed([saturator({})]);
		const { container } = render(PedalCentralView);
		await tick();
		const button = container.querySelector<HTMLElement>('.wah-column .wah-button')!;
		button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
		button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
		await tick();
		// The track's path, no pad scope, the wah preset — the FX tiles' own
		// load, so the surface places it at the head of the audio effects.
		expect(send).toHaveBeenCalledWith('/looping/v3/device/load', [TRACK, '', '', 'place:Vamp Devices', 'Wah/Wah.adg']);
		expect(send).not.toHaveBeenCalledWith('/looping/v3/device/delete', expect.anything());
	});

	it('a tap on a present Wah loads nothing; a hold removes it through device/delete', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
		try {
			seed([saturator({}), wahRack()]);
			const { container } = render(PedalCentralView);
			await tick();
			const button = container.querySelector<HTMLElement>('.wah-column .wah-button')!;

			// A tap: the slot is not a ghost, so there is nothing to load.
			button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
			button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
			await tick();
			expect(send).not.toHaveBeenCalled();

			// A hold: the press reports a hold at HOLD_MS while the finger is
			// still down, and the release after it fires no tap.
			button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
			vi.advanceTimersByTime(HOLD_MS + 20);
			expect(send).toHaveBeenCalledWith('/looping/v3/device/delete', [WAH]);
			button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
			await tick();
			expect(send).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps a tap on the Pedal pad inside this view', async () => {
		// jsdom has no pointer capture; the pad asks for it on every press.
		HTMLElement.prototype.setPointerCapture = vi.fn();
		HTMLElement.prototype.releasePointerCapture = vi.fn();
		seed([pedal()]);
		centralDisplayStore.setView('device', 'pedal');
		const { container } = render(PedalCentralView);
		await tick();
		const pad = container.querySelector<HTMLElement>('.pedal-xy-column .xy-container');
		expect(pad).not.toBeNull();
		pad!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
		pad!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
		await tick();
		expect(centralDisplayStore.isViewActive('device', 'pedal')).toBe(true);
	});
});
