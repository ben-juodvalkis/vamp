/**
 * DriftCentralView — the level mixer aims the oscillator card.
 *
 * One card is switched between OSC 1 and OSC 2, and the level mixer holds
 * both oscillators' gains side by side. Touching either one brings that
 * oscillator's card up (user, 2026-09-16), so balancing the sources and
 * shaping the one you are holding are the same reach rather than two.
 *
 * The switch rides `DeviceSlider`'s `onDown` — TRUE finger-down — so a
 * press that rests on the fader without moving still lands it; `onTap`
 * (under 200ms, under 5px) and `onInteraction` (a finger that moved) each
 * leave that case unanswered. It is view state only: the touch alone
 * writes nothing to Drift.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { OSCArg } from '$lib/types/osc';
import { send } from '$lib/api/simpleClient';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import {
	replaceTree,
	_resetForTests,
	type TrackRecord,
	type DeviceRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';
import DriftCentralView from '$lib/components/v6/central/views/DriftCentralView.svelte';

const sendMock = vi.mocked(send);
const GENERATION = 7;
const TRACK = 'tracks/0';
const DEVICE = `${TRACK}/devices/0`;
const INSTRUMENT = {
	deviceIndex: 0,
	className: 'InstrumentVectorDevice',
	name: 'Drift',
	type: 'instrument' as const,
	devicePath: DEVICE
};

/** Drift's own indices matter to the view; the fixture just fills the rail. */
function driftTrack(): TrackRecord {
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i <= 63; i++) {
		const paramPath = `${DEVICE}/params/${i}`;
		params.set(paramPath, {
			paramPath,
			name: `P${i}`,
			displayName: `P${i}`,
			min: 0,
			max: 1,
			// 31 / 32 are the two oscillator switches and both ship on.
			value: i === 31 || i === 32 ? 1 : 0.5,
			unit: ''
		});
	}
	const device: DeviceRecord = {
		devicePath: DEVICE,
		name: 'Drift',
		className: 'InstrumentVectorDevice',
		params,
		properties: new SvelteMap<string, OSCArg>()
	};
	return {
		trackPath: TRACK,
		name: 'Keys',
		color: 0x5ec8ff,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: 'synth',
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

function pointer(el: HTMLElement, type: string, clientX: number, clientY: number) {
	const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
	Object.defineProperty(ev, 'pointerId', { value: 1 });
	el.dispatchEvent(ev);
}

/** A finger that lands and rests — no move, and no release inside the tap window. */
async function touchDown(el: HTMLElement) {
	pointer(el, 'pointerdown', 50, 100);
	await tick();
}

/** Which oscillator the card is showing, read off the badge it lives in. */
function shownOsc(container: HTMLElement): number {
	const label = container.querySelector('.osc-badge')?.getAttribute('aria-label') ?? '';
	return Number(/Oscillator (\d)/.exec(label)?.[1]);
}

function paramSets(): unknown[][] {
	return sendMock.mock.calls
		.filter(([addr]) => addr === '/looping/v3/param/set')
		.map(([, args]) => args as unknown[]);
}

describe('DriftCentralView — the level mixer aims the oscillator card', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		replaceTree(GENERATION, [driftTrack()]);
		selectedTrackStore.handleTrackSelected(0);
		HTMLElement.prototype.setPointerCapture = vi.fn();
		HTMLElement.prototype.releasePointerCapture = vi.fn();
	});
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it('opens on OSC 1, with its seven waveforms', async () => {
		const { container } = render(DriftCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(shownOsc(container)).toBe(1);
		expect(container.querySelectorAll('.wave-button')).toHaveLength(7);
	});

	it('brings OSC 2 up when the Osc 2 level is touched, and back on Osc 1', async () => {
		const { container } = render(DriftCentralView, { props: { instrument: INSTRUMENT } });
		await tick();

		await touchDown(slider(container, 'Osc 2'));
		expect(shownOsc(container)).toBe(2);
		// OSC 2 lists five waveforms to OSC 1's seven — the card really swapped.
		expect(container.querySelectorAll('.wave-button')).toHaveLength(5);

		await touchDown(slider(container, 'Osc 1'));
		expect(shownOsc(container)).toBe(1);
		expect(container.querySelectorAll('.wave-button')).toHaveLength(7);
	});

	it('switches on the touch alone — no movement, no release, nothing written to Drift', async () => {
		const { container } = render(DriftCentralView, { props: { instrument: INSTRUMENT } });
		await tick();

		await touchDown(slider(container, 'Osc 2'));

		expect(shownOsc(container)).toBe(2);
		expect(paramSets()).toHaveLength(0);
	});

	it('leaves the card alone when Noise is touched — it is a source, not an oscillator', async () => {
		const { container } = render(DriftCentralView, { props: { instrument: INSTRUMENT } });
		await tick();

		await touchDown(slider(container, 'Osc 2'));
		await touchDown(slider(container, 'Noise'));

		expect(shownOsc(container)).toBe(2);
	});
});
