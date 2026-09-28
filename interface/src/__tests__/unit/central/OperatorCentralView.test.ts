/**
 * OperatorCentralView — the Time and Tone sliders (2026-09-07).
 *
 * Mounts the real view against the real v3 store and pins the two things
 * a reader of the file cannot see:
 *
 * 1. READS — Time (param 120, -100..100) and Tone (param 8, 0..1) render
 *    the store's RAW Live units; nothing in the view rescales them.
 * 2. WRITES — a drag on either slider sends `/looping/v3/param/set` for
 *    the right parameter path, in raw units: the bipolar Time slider
 *    resolves a drag to a value on its -100..100 rail, not 0..1.
 *
 * The indices were read off the running device (`parameters[i].name`
 * over the LOM probe), not the `.adv` — Operator's XML nests every
 * section, so document order is not LOM order.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({
	send: vi.fn()
}));

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { send } from '$lib/api/simpleClient';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import {
	replaceTree,
	_resetForTests,
	type TrackRecord,
	type DeviceRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';
import OperatorCentralView from '$lib/components/v6/central/views/OperatorCentralView.svelte';

const sendMock = send as unknown as ReturnType<typeof vi.fn>;

const GENERATION = 3;
const DEVICE = 'tracks/0/devices/0';
const INSTRUMENT = {
	deviceIndex: 0,
	className: 'Operator',
	name: 'Operator',
	type: 'instrument' as const,
	devicePath: DEVICE
};

// LOM order as the running device reports it (2026-09-07); only the five
// the view reads are named, the rest are filler so the indices line up.
const NAMED: Record<number, { name: string; min: number; max: number }> = {
	8: { name: 'Tone', min: 0, max: 1 },
	26: { name: 'Osc-A Feedb', min: 0, max: 100 },
	29: { name: 'Ae Attack', min: 0, max: 1 },
	34: { name: 'Ae Release', min: 0, max: 1 },
	120: { name: 'Time', min: -100, max: 100 }
};

function operatorTrack(values: Record<number, number>): TrackRecord {
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i <= 120; i++) {
		const paramPath = `${DEVICE}/params/${i}`;
		const meta = NAMED[i] ?? { name: `P${i}`, min: 0, max: 1 };
		params.set(paramPath, {
			paramPath,
			name: meta.name,
			displayName: meta.name,
			min: meta.min,
			max: meta.max,
			value: values[i] ?? 0,
			unit: ''
		});
	}
	const device: DeviceRecord = {
		devicePath: DEVICE,
		name: 'Operator',
		className: 'Operator',
		params,
		properties: new SvelteMap()
	};
	return {
		trackPath: 'tracks/0',
		name: 'Operator',
		color: 0xff9a36,
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

function seed(values: Record<number, number>) {
	replaceTree(GENERATION, [operatorTrack(values)]);
	selectedTrackStore.handleTrackSelected(0);
}

function slider(container: HTMLElement, title: string): HTMLElement {
	const el = Array.from(container.querySelectorAll<HTMLElement>('[role="slider"]')).find((s) =>
		s.getAttribute('aria-label')?.startsWith(`${title}:`)
	);
	if (!el) throw new Error(`no slider titled ${title}`);
	return el;
}

// DeviceSlider drags are relative to the pointer-down position, in
// fractions of the slider's box; jsdom has no layout, so give it one.
const SLIDER_HEIGHT = 200;

function pointer(el: HTMLElement, type: string, clientY: number) {
	const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY });
	Object.defineProperty(ev, 'pointerId', { value: 1 });
	el.dispatchEvent(ev);
}

function drag(el: HTMLElement, fromY: number, toY: number) {
	pointer(el, 'pointerdown', fromY);
	pointer(el, 'pointermove', toY);
	pointer(el, 'pointerup', toY);
}

function paramSets(paramIndex: number) {
	return sendMock.mock.calls
		.filter(([addr, args]) => addr === '/looping/v3/param/set' && args[0] === `${DEVICE}/params/${paramIndex}`)
		.map(([, args]) => args);
}

describe('OperatorCentralView — Time and Tone', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
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

	it('shows the empty state when the track has no Operator', async () => {
		const { container } = render(OperatorCentralView, { props: { instrument: null } });
		await tick();
		expect(container.textContent).toContain('Load Operator');
		expect(container.querySelectorAll('[role="slider"]')).toHaveLength(0);
	});

	it('reads Time and Tone in raw Live units off the store', async () => {
		seed({ 120: 25, 8: 0.7, 26: 40 });
		const { container } = render(OperatorCentralView, { props: { instrument: INSTRUMENT } });
		await tick();

		const time = slider(container, 'Time');
		expect(time.getAttribute('aria-valuenow')).toBe('25');
		expect(time.getAttribute('aria-valuemin')).toBe('-100');
		expect(time.getAttribute('aria-valuemax')).toBe('100');

		const tone = slider(container, 'Tone');
		expect(tone.getAttribute('aria-valuenow')).toBe('0.7');
		expect(tone.getAttribute('aria-valuemin')).toBe('0');
		expect(tone.getAttribute('aria-valuemax')).toBe('1');

		// The pre-existing Feedback slider still normalizes 0..100 to 0..1.
		expect(slider(container, 'Feedback').getAttribute('aria-valuenow')).toBe('0.4');
	});

	it('a drag on Time writes param 120 on its -100..100 rail', async () => {
		seed({ 120: 25, 8: 0.7 });
		const { container } = render(OperatorCentralView, { props: { instrument: INSTRUMENT } });
		await tick();

		// Up by a quarter of the box: 25 → normalized 0.625 + 0.25 → 75.
		drag(slider(container, 'Time'), 100, 100 - SLIDER_HEIGHT / 4);
		const writes = paramSets(120);
		expect(writes.length).toBeGreaterThan(0);
		const [, value, generation] = writes[writes.length - 1];
		expect(value).toBeCloseTo(75, 6);
		expect(generation).toBe(GENERATION);
		expect(paramSets(8)).toHaveLength(0);
	});

	it('a drag on Tone writes param 8 on its 0..1 rail', async () => {
		seed({ 120: 0, 8: 0.7 });
		const { container } = render(OperatorCentralView, { props: { instrument: INSTRUMENT } });
		await tick();

		// Down by a fifth of the box: 0.7 → 0.5.
		drag(slider(container, 'Tone'), 100, 100 + SLIDER_HEIGHT / 5);
		const writes = paramSets(8);
		expect(writes.length).toBeGreaterThan(0);
		const [, value] = writes[writes.length - 1];
		expect(value).toBeCloseTo(0.5, 6);
		expect(paramSets(120)).toHaveLength(0);
	});
});
