/**
 * SamplerCentralView — the Sampler row on one Sampler, by NAME.
 *
 * The view used to write Attack and Release by index (59 / 66). It now
 * resolves every control's parameter by name off the device's own list,
 * maps 0..1 controls through the parameter's LOM range, writes a
 * section's switch with its amount, and dims a control whose parameter
 * (and switch) the device does not list. The fixture lists the Autumn
 * kit's Sampler names with the Osc section ABSENT, so `Ve Attack` sits
 * at a different index than 59 — a write that lands there proves the
 * name, not the number, is what the view follows.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({
	send: vi.fn()
}));

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { OSCArg } from '$lib/types/osc';
import { send } from '$lib/api/simpleClient';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { replaceTree, _resetForTests, type TrackRecord, type DeviceRecord, type ParamRecord } from '$lib/stores/v3/normalized.svelte';
import SamplerCentralView from '$lib/components/v6/central/views/SamplerCentralView.svelte';

const sendMock = send as unknown as ReturnType<typeof vi.fn>;
const GENERATION = 5;
const DEVICE = 'tracks/0/devices/0';
const INSTRUMENT = { deviceIndex: 0, className: 'MultiSampler', name: 'Sampler', type: 'instrument' as const, devicePath: DEVICE };

/** [name, min, max, value] — the Autumn Sampler's ranges (measured 2026-09-07), Osc section absent. */
const PARAMS: [string, number, number, number][] = [
	['Device On', 0, 1, 1],
	['Reverse', 0, 1, 0],
	['Snap', 0, 1, 0],
	['Sample Selector', 0, 127, 0],
	['Osc On', 0, 1, 0],
	['Spread', 0, 100, 25],
	['Key Zone Shift', -48, 48, 0],
	['Transpose', -48, 48, -16],
	['Pe On', 0, 1, 1],
	['Pe < Env', -48, 48, 24],
	['Pe Attack', 0, 1, 0],
	['Pe Decay', 0, 1, 0.72],
	['Volume', -36, 36, 0],
	['Ve Attack', 0, 1, 0.2],
	['Ve Decay', 0, 1, 0.58],
	['Ve Sustain', 0, 1, 1],
	['Ve Release', 0, 1, 0.345],
	// The filter, read off a running Sampler (2026-09-27, 70-parameter
	// variant): resonance tops out at 1.25, not 1.
	['F On', 0, 1, 0],
	['Filter Freq', 0, 1, 0.8],
	['Filter Res', 0, 1.25, 0.25]
];
const INDEX = Object.fromEntries(PARAMS.map(([name], i) => [name, i]));

function samplerTrack(list = PARAMS): TrackRecord {
	const params = new SvelteMap<string, ParamRecord>();
	list.forEach(([name, min, max, value], i) => {
		const paramPath = `${DEVICE}/params/${i}`;
		params.set(paramPath, { paramPath, name, displayName: name, min, max, value, unit: '' });
	});
	const device: DeviceRecord = {
		devicePath: DEVICE,
		name: 'Kick Drum Dampened',
		className: 'MultiSampler',
		params,
		properties: new SvelteMap<string, OSCArg>()
	};
	return {
		trackPath: 'tracks/0',
		name: 'Kick',
		color: 0xff3636,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		devices: new SvelteMap<string, DeviceRecord>([[DEVICE, device]]),
		slots: new SvelteMap()
	};
}

function slider(container: HTMLElement, title: string): HTMLElement {
	const el = Array.from(container.querySelectorAll<HTMLElement>('[role="slider"]')).find((s) =>
		s.getAttribute('aria-label')?.startsWith(`${title}:`)
	);
	if (!el) throw new Error(`no slider titled ${title}`);
	return el;
}

const SLIDER_HEIGHT = 200;
function pointer(el: HTMLElement, type: string, clientX: number, clientY: number) {
	const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
	Object.defineProperty(ev, 'pointerId', { value: 1 });
	el.dispatchEvent(ev);
}
function drag(el: HTMLElement, from: [number, number], to: [number, number]) {
	pointer(el, 'pointerdown', from[0], from[1]);
	pointer(el, 'pointermove', to[0], to[1]);
	pointer(el, 'pointerup', to[0], to[1]);
}
function paramSets(): unknown[][] {
	return sendMock.mock.calls.filter(([addr]) => addr === '/looping/v3/param/set').map(([, args]) => args as unknown[]);
}

describe('SamplerCentralView — the Sampler row by name', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		replaceTree(GENERATION, [samplerTrack()]);
		selectedTrackStore.handleTrackSelected(0);
		HTMLElement.prototype.setPointerCapture = vi.fn();
		HTMLElement.prototype.releasePointerCapture = vi.fn();
		vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
			x: 0, y: 0, top: 0, left: 0, right: 100, bottom: SLIDER_HEIGHT,
			width: 100, height: SLIDER_HEIGHT, toJSON: () => ({})
		} as DOMRect);
	});
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it('reads each control through its parameter range, by name', async () => {
		const { container } = render(SamplerCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		// The amp envelope is four sliders in its own card since 2026-09-12,
		// labelled one letter each; A and R carry what the Time pad's axes did.
		expect(slider(container, 'A').getAttribute('aria-valuenow')).toBe('0.2'); // Ve Attack
		expect(slider(container, 'R').getAttribute('aria-valuenow')).toBe('0.345'); // Ve Release
		expect(slider(container, 'Pitch').getAttribute('aria-label')).toBe('Pitch: X 0%, Y 75%'); // Pe Attack 0 across, +24 st on ±48 up
		expect(slider(container, 'Spread').getAttribute('aria-valuenow')).toBe('0.25'); // 25 of 100
		expect(slider(container, 'S').getAttribute('aria-valuenow')).toBe('1'); // Ve Sustain
		expect(slider(container, 'Trnsp').getAttribute('aria-valuenow')).toBe('-16');
		expect(container.querySelectorAll('.midi-wheel')).toHaveLength(2);
		// Gain and Filter, as a kit draws them (2026-09-27).
		expect(slider(container, 'Gain').getAttribute('aria-valuenow')).toBe('0.5'); // Volume 0 dB on ±36
		expect(slider(container, 'Filter').getAttribute('aria-label')).toBe('Filter: X 80%, Y 20%'); // 0.25 of 1.25 up
	});

	it('a Gain drag writes Volume in dB; a Filter drag turns F On on and writes cutoff and resonance through their ranges', async () => {
		const { container } = render(SamplerCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		drag(slider(container, 'Gain'), [50, 100], [50, 40]);
		const volume = paramSets().filter((a) => a[0] === `${DEVICE}/params/${INDEX['Volume']}`);
		expect(volume.length).toBeGreaterThan(0);
		expect(volume.at(-1)![1] as number).toBeGreaterThan(0); // dragged up from 0 dB
		expect(volume.at(-1)![1] as number).toBeLessThanOrEqual(36);

		sendMock.mockClear();
		// Down and to the left, to the floor: the switch still only turns on.
		drag(slider(container, 'Filter'), [50, 100], [0, 200]);
		const on = paramSets().filter((a) => a[0] === `${DEVICE}/params/${INDEX['F On']}`);
		expect(on.length).toBeGreaterThan(0);
		expect(on.every((a) => a[1] === 1)).toBe(true);
		const res = paramSets().filter((a) => a[0] === `${DEVICE}/params/${INDEX['Filter Res']}`);
		expect(res.length).toBeGreaterThan(0);
		for (const a of res) {
			expect(a[1] as number).toBeGreaterThanOrEqual(0);
			expect(a[1] as number).toBeLessThanOrEqual(1.25);
		}
		expect(paramSets().some((a) => a[0] === `${DEVICE}/params/${INDEX['Filter Freq']}`)).toBe(true);
	});

	it('ghosts the Filter pad on a Sampler that lists no filter', async () => {
		cleanup();
		_resetForTests();
		replaceTree(GENERATION, [samplerTrack(PARAMS.filter(([name]) => !name.startsWith('F')))]);
		selectedTrackStore.handleTrackSelected(0);
		const { container } = render(SamplerCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(container.querySelector('[data-vm-function="filterFreq|filterRes"]')?.getAttribute('data-vm-state')).toBe('none');
		expect(container.querySelector('[data-vm-function="gain"]')?.getAttribute('data-vm-state')).toBe('live');
	});

	it('keeps the Osc pad live on its switch alone when the section is not listed, and dims nothing else', async () => {
		const { container } = render(SamplerCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		const osc = container.querySelector('[data-vm-function="oscAmount|oscCoarse"]');
		// The amount is unlisted (none) but the switch is (live): the pad stays live.
		expect(osc?.getAttribute('data-vm-state')).toBe('live');
		expect(container.querySelectorAll('.vm-slot.vm-none')).toHaveLength(0);
	});

	it('the A and R sliders write Ve Attack and Ve Release at their own indices, not 59 and 66', async () => {
		const { container } = render(SamplerCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		drag(slider(container, 'A'), [50, 100], [50, 40]);
		drag(slider(container, 'R'), [50, 100], [50, 40]);
		const paths = paramSets().map((a) => a[0]);
		expect(paths).toContain(`${DEVICE}/params/${INDEX['Ve Attack']}`);
		expect(paths).toContain(`${DEVICE}/params/${INDEX['Ve Release']}`);
		expect(paths).not.toContain(`${DEVICE}/params/59`);
		for (const a of paramSets()) {
			expect(a[1] as number).toBeGreaterThanOrEqual(0);
			expect(a[1] as number).toBeLessThanOrEqual(1);
		}
	});

	it('an Osc drag writes the section switch on, and the amount only once it is listed', async () => {
		const { container } = render(SamplerCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		drag(slider(container, 'Osc'), [50, 100], [80, 40]);
		const sets = paramSets();
		const oscOn = sets.filter((a) => a[0] === `${DEVICE}/params/${INDEX['Osc On']}`);
		expect(oscOn.length).toBeGreaterThan(0);
		expect(oscOn.every((a) => a[1] === 1)).toBe(true);
		// `O Volume` and `O Coarse` are not listed on this device: nothing else written.
		expect(sets.every((a) => a[0] === `${DEVICE}/params/${INDEX['Osc On']}`)).toBe(true);
	});

	it('a Pitch drag writes Pe On, Pe < Env through the ±48 range and Pe Attack; Trnsp writes whole semitones', async () => {
		const { container } = render(SamplerCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		// The whole height downward and to the right: the amount to its floor (−48 st), attack up.
		drag(slider(container, 'Pitch'), [50, 0], [80, 200]);
		const env = paramSets().filter((a) => a[0] === `${DEVICE}/params/${INDEX['Pe < Env']}`);
		expect(env.length).toBeGreaterThan(0);
		for (const a of env) {
			expect(a[1] as number).toBeGreaterThanOrEqual(-48);
			expect(a[1] as number).toBeLessThanOrEqual(48);
		}
		expect(env.at(-1)![1]).toBe(-48);
		expect(paramSets().some((a) => a[0] === `${DEVICE}/params/${INDEX['Pe Attack']}`)).toBe(true);
		expect(paramSets().some((a) => a[0] === `${DEVICE}/params/${INDEX['Pe Decay']}`)).toBe(false);
		// The envelope's switch only ever turns on: the floor of a bipolar amount is not "off".
		const peOn = paramSets().filter((a) => a[0] === `${DEVICE}/params/${INDEX['Pe On']}`);
		expect(peOn.length).toBeGreaterThan(0);
		expect(peOn.every((a) => a[1] === 1)).toBe(true);

		sendMock.mockClear();
		drag(slider(container, 'Trnsp'), [10, 150], [10, 50]);
		const trnsp = paramSets().filter((a) => a[0] === `${DEVICE}/params/${INDEX['Transpose']}`);
		expect(trnsp.length).toBeGreaterThan(0);
		expect(trnsp.every((a) => Number.isInteger(a[1]))).toBe(true);
		expect(trnsp.at(-1)![1]).toBeGreaterThan(-16);
	});
});
