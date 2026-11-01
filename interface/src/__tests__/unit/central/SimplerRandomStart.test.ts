/**
 * The Simpler view's Random slider and Random Start (2026-11-01, Ben).
 *
 * Random Start is no longer put ahead of every Simpler. The slider is always
 * drawn, a ghost until the track has the device; its first drag loads it
 * through `device/load` from the Vamp Devices Place, once however many
 * frames follow, and the value the drag reached is written as soon as the
 * device shows up (it arrives at its own default of 50 %).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { OSCArg } from '$lib/types/osc';
import { send } from '$lib/api/simpleClient';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { replaceTree, _resetForTests, type TrackRecord, type DeviceRecord, type ParamRecord } from '$lib/stores/v3/normalized.svelte';
import SimplerCentralView from '$lib/components/v6/central/views/SimplerCentralView.svelte';

const sendMock = vi.mocked(send);
const TRACK = 'tracks/0';

function device(index: number, name: string, className: string, paramNames: string[]): DeviceRecord {
	const devicePath = `${TRACK}/devices/${index}`;
	const params = new SvelteMap<string, ParamRecord>();
	paramNames.forEach((n, i) => {
		const paramPath = `${devicePath}/params/${i}`;
		params.set(paramPath, { paramPath, name: n, displayName: n, min: 0, max: n === 'Random Amount' ? 100 : 1, value: n === 'Random Amount' ? 50 : 0, unit: '' });
	});
	return { devicePath, name, className, params, properties: new SvelteMap<string, OSCArg>() };
}

function track(devices: DeviceRecord[]): TrackRecord {
	return {
		trackPath: TRACK, name: 'Clap', color: 0x5ec8ff, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: 'perc',
		devices: new SvelteMap(devices.map((d) => [d.devicePath, d])), slots: new SvelteMap()
	};
}

const simplerParams = Array.from({ length: 40 }, (_, i) => `P${i}`);
const randomStart = (index: number) => device(index, 'random-start', 'MxDeviceMidiEffect', ['Device On', 'Random Amount']);

function randomSlider(container: HTMLElement): HTMLElement {
	const el = Array.from(container.querySelectorAll<HTMLElement>('[role="slider"]')).find((s) =>
		s.getAttribute('aria-label')?.startsWith('Random')
	);
	if (!el) throw new Error('no Random slider');
	return el;
}

async function drag(el: HTMLElement, fromY: number, toY: number) {
	const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
	await fireEvent.pointerDown(el, { clientX: 50, clientY: fromY, pointerId: 1 });
	await fireEvent.pointerMove(el, { clientX: 50, clientY: (fromY + toY) / 2, pointerId: 1 });
	await frame();
	await fireEvent.pointerMove(el, { clientX: 50, clientY: toY, pointerId: 1 });
	await frame();
	await fireEvent.pointerUp(el, { clientX: 50, clientY: toY, pointerId: 1 });
	await tick();
}

const calls = (address: string) => sendMock.mock.calls.filter(([a]) => a === address).map(([, args]) => args as unknown[]);

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

describe("the Simpler view's Random slider", () => {
	it('is a ghost on a Simpler with no Random Start, loads it on the first drag only, and writes the dragged value when it arrives', async () => {
		replaceTree(3, [track([device(0, 'Clap', 'OriginalSimpler', simplerParams)])]);
		selectedTrackStore.handleTrackSelected(0);
		const instrument = { deviceIndex: 0, className: 'OriginalSimpler', name: 'Clap', type: 'instrument' as const, devicePath: `${TRACK}/devices/0` };
		const { container } = render(SimplerCentralView, { props: { instrument } });
		await tick();

		const slider = randomSlider(container);
		expect(slider.closest('.slider-container')?.classList.contains('ghost') ?? slider.classList.contains('ghost')).toBe(true);

		await drag(slider, 180, 60);
		await drag(slider, 180, 40);
		const loads = calls('/looping/v3/device/load');
		expect(loads).toEqual([[TRACK, '', '', 'place:Vamp Devices', 'random-start/random-start.amxd']]);
		expect(calls('/looping/v3/param/set')).toEqual([]);

		// Live puts the MIDI effect ahead of the Simpler.
		replaceTree(4, [track([randomStart(0), device(1, 'Clap', 'OriginalSimpler', simplerParams)])]);
		await tick();
		const sets = calls('/looping/v3/param/set');
		expect(sets).toHaveLength(1);
		expect(sets[0][0]).toBe(`${TRACK}/devices/0/params/1`);
		expect(Number(sets[0][1])).toBeGreaterThan(50);
	});

	it('writes straight to Random Start when the track already has it, with no load', async () => {
		replaceTree(3, [track([randomStart(0), device(1, 'Clap', 'OriginalSimpler', simplerParams)])]);
		selectedTrackStore.handleTrackSelected(0);
		const instrument = { deviceIndex: 1, className: 'OriginalSimpler', name: 'Clap', type: 'instrument' as const, devicePath: `${TRACK}/devices/1` };
		const { container } = render(SimplerCentralView, { props: { instrument } });
		await tick();
		await drag(randomSlider(container), 180, 60);
		expect(calls('/looping/v3/device/load')).toEqual([]);
		expect(calls('/looping/v3/param/set').every(([p]) => p === `${TRACK}/devices/0/params/1`)).toBe(true);
		expect(calls('/looping/v3/param/set').length).toBeGreaterThan(0);
	});
});
