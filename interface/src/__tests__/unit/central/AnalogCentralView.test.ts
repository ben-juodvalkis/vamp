/**
 * AnalogCentralView — one Voice switch flips the whole half of Analog.
 *
 * The fixture is the rig's own "106 Bass 01" patch, all 172 parameters as
 * the running Live reported them on 2026-10-22 (`device_dump.js`), shared
 * with the screenshot mock. Live's own labels from that dump are quoted in
 * the params tests below, so they assert Live's strings rather than a guess.
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
import { instrumentService } from '$lib/services/instrumentService';
import AnalogCentralView from '$lib/components/v6/central/views/AnalogCentralView.svelte';
import {
	ANALOG_VOICE,
	ANALOG_FILTER_TYPES,
	ANALOG_DRIVES,
	ANALOG_SHAPES,
	filterTypeForFamily,
	driveForAmount,
	driveToggleAsym,
	routeOf,
	nextRouteBalance
} from '$lib/components/v6/central/views/analogParams';
import BASS_106 from '../../../../../scripts/shot/fixtures/analog-106-bass.json';

const sendMock = vi.mocked(send);
const TRACK = 'tracks/0';
const DEVICE = `${TRACK}/devices/0`;
const INSTRUMENT = {
	deviceIndex: 0,
	className: 'UltraAnalog',
	name: '106 Bass 01',
	type: 'instrument' as const,
	devicePath: DEVICE
};

function analogTrack(): TrackRecord {
	const params = new SvelteMap<string, ParamRecord>();
	(BASS_106 as [string, number, number, number][]).forEach(([name, min, max, value], i) => {
		const paramPath = `${DEVICE}/params/${i}`;
		params.set(paramPath, { paramPath, name, displayName: name, min, max, value, unit: '' });
	});
	const device: DeviceRecord = {
		devicePath: DEVICE,
		name: '106 Bass 01',
		className: 'UltraAnalog',
		params,
		properties: new SvelteMap()
	};
	return {
		trackPath: TRACK,
		name: '106 Bass',
		color: 0xff8244,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: 'bass',
		devices: new SvelteMap<string, DeviceRecord>([[DEVICE, device]]),
		slots: new SvelteMap()
	};
}

/** Each `/looping/v3/param/set` as [param index, value]. */
function paramSets(): [number, number][] {
	return sendMock.mock.calls
		.filter(([addr]) => addr === '/looping/v3/param/set')
		.map(([, args]) => {
			const [path, value] = args as [string, number];
			return [Number(path.split('/').pop()), value];
		});
}

function button(container: HTMLElement, label: string): HTMLElement {
	const el = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
	if (!el) throw new Error(`no control labeled ${label}`);
	return el;
}

describe('Analog — the class Live reports', () => {
	it('reads UltraAnalog as the analog view', () => {
		expect(instrumentService.identifyInstrumentType({ ...INSTRUMENT, className: 'UltraAnalog' })).toBe('analog');
	});
});

describe('AnalogCentralView — the Voice switch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		replaceTree(7, [analogTrack()]);
		selectedTrackStore.handleTrackSelected(0);
	});
	afterEach(() => cleanup());

	it('opens on Voice 1 with the patch as saved: Saw lit, octave 0, Filter 1 a 24 dB low-pass', async () => {
		const { container } = render(AnalogCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(button(container, 'Voice 1 of 2 — switch to voice 2')).toBeTruthy();
		expect(button(container, 'Osc 1 shape Saw').getAttribute('aria-pressed')).toBe('true');
		expect(button(container, 'Osc 1 octave 0').getAttribute('aria-pressed')).toBe('true');
		expect(button(container, 'Filter 1 Low-pass 24dB/oct').getAttribute('aria-pressed')).toBe('true');
		expect(button(container, 'Filter 1 drive Asym2').getAttribute('aria-pressed')).toBe('true');
		expect(button(container, 'Osc 1 to F1')).toBeTruthy();
	});

	it('flips oscillator, filter and envelope to Voice 2 together', async () => {
		const { container } = render(AnalogCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		await fireEvent.click(button(container, 'Voice 1 of 2 — switch to voice 2'));

		// Osc 2 sits an octave down in this patch; Filter 2 drives Sym1 and follows F1.
		expect(button(container, 'Osc 2 octave -1').getAttribute('aria-pressed')).toBe('true');
		expect(button(container, 'Filter 2 drive Sym1').getAttribute('aria-pressed')).toBe('true');
		expect(container.querySelector('.slave-chip')?.getAttribute('aria-pressed')).toBe('true');

		// A write now lands on Voice 2's indices, not Voice 1's.
		await fireEvent.click(button(container, 'Osc 2 shape Rect'));
		expect(paramSets()).toEqual([[ANALOG_VOICE[2].shape, 2]]);
	});

	it('writes nothing to Live when the switch is flipped', async () => {
		const { container } = render(AnalogCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		await fireEvent.click(button(container, 'Voice 1 of 2 — switch to voice 2'));
		expect(paramSets()).toEqual([]);
	});

	it('flips the slope on a second tap of the lit filter family, keeps it on a new one', async () => {
		const { container } = render(AnalogCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		// LP24 lit: a second tap flips it to LP12; HP then keeps the 12.
		await fireEvent.click(button(container, 'Filter 1 Low-pass 24dB/oct'));
		await fireEvent.click(button(container, 'Filter 1 High-pass 12dB/oct'));
		expect(paramSets()).toEqual([
			[ANALOG_VOICE[1].filterType, 0],
			[ANALOG_VOICE[1].filterType, 6]
		]);
	});
});

describe('analogParams — Live’s own tables', () => {
	const dumped = BASS_106 as [string, number, number, number][];

	it('pins the indices to the names Live reports', () => {
		const names = (v: 1 | 2) => Object.values(ANALOG_VOICE[v]).map((i) => dumped[i][0]);
		expect(names(1)).toEqual([
			'OSC1 On/Off', 'OSC1 Shape', 'OSC1 Octave', 'OSC1 Mode', 'OSC1 PW', 'O1 Sub/Sync', 'OSC1 Balance',
			'OSC1 Level', 'F1 On/Off', 'F1 Type', 'F1 Drive', 'F1 Freq', 'F1 Resonance', 'F1 Freq < Env', 'FEG1 Attack',
			'FEG1 Decay', 'FEG1 Sustain', 'FEG1 Rel', 'AMP1 Level', 'AEG1 Attack', 'AEG1 Decay', 'AEG1 Sustain', 'AEG1 Rel'
		]);
		expect(names(2)).toEqual(names(1).map((n) => n.replace(/1/, '2')));
	});

	it('names the shapes, filter types and drives as Live labels them', () => {
		expect(ANALOG_SHAPES).toEqual(['Sine', 'Saw', 'Rect', 'Noise']);
		expect(ANALOG_FILTER_TYPES[1]).toBe('Low-pass 24dB/oct');
		expect(ANALOG_FILTER_TYPES[4]).toBe('Notch 2-pole');
		expect(ANALOG_FILTER_TYPES[9]).toBe('Formant 12dB/oct');
		expect(ANALOG_DRIVES).toEqual(['Off', 'Sym1', 'Sym2', 'Sym3', 'Asym1', 'Asym2', 'Asym3']);
	});

	it('moves between filter families and drives without losing the other half', () => {
		expect(filterTypeForFamily(1, 3)).toBe(7); // LP24 → HP24
		expect(filterTypeForFamily(7, 3)).toBe(6); // HP24 → HP12
		expect(driveForAmount(5, 1)).toBe(4); // Asym2 → Asym1
		expect(driveForAmount(2, 3)).toBe(3); // Sym2 → Sym3
		expect(driveToggleAsym(2)).toBe(5); // Sym2 → Asym2
		expect(driveToggleAsym(0)).toBe(4); // Off → Asym1
	});

	it('reads Balance as Live’s F1 / F2 ends and cycles the route chip', () => {
		expect(routeOf(1)).toBe('F1');
		expect(routeOf(0)).toBe('F2');
		expect(routeOf(0.5)).toBe('F1+F2');
		expect([1, 0.5, 0].map(nextRouteBalance)).toEqual([0.5, 0, 1]);
	});
});
