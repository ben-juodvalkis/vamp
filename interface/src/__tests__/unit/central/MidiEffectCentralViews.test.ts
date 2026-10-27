/**
 * The MIDI-effect views, one per device (ADR-478): the Arpeggiator view
 * used to draw Velocity, Chord and Note Chance past seams, and the
 * `random` type opened it too. Each now draws only its own device.
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
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import {
	replaceTree,
	_resetForTests,
	type TrackRecord,
	type DeviceRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';
import ArpeggiatorCentralView from '$lib/components/v6/central/views/ArpeggiatorCentralView.svelte';
import VelocityCentralView from '$lib/components/v6/central/views/VelocityCentralView.svelte';
import ChordCentralView from '$lib/components/v6/central/views/ChordCentralView.svelte';
import ChanceCentralView from '$lib/components/v6/central/views/ChanceCentralView.svelte';
import RandomCentralView from '$lib/components/v6/central/views/RandomCentralView.svelte';

const sendMock = vi.mocked(send);
const TRACK = 'tracks/0';
const DEVICE = `${TRACK}/devices/0`;

function midiDevice(name: string, className: string, values: Record<number, number>): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i <= 28; i++) {
		const paramPath = `${DEVICE}/params/${i}`;
		params.set(paramPath, { paramPath, name: `P${i}`, displayName: `P${i}`, min: -48, max: 127, value: values[i] ?? 0, unit: '' });
	}
	return { devicePath: DEVICE, name, className, params, properties: new SvelteMap() };
}

function seed(devices: DeviceRecord[]) {
	const track: TrackRecord = {
		trackPath: TRACK, name: 'Keys', color: 0xff3636, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: 'keys',
		devices: new SvelteMap(devices.map((d) => [d.devicePath, d])), slots: new SvelteMap()
	};
	replaceTree(3, [track]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
}

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => cleanup());

describe('MIDI-effect central views (ADR-478)', () => {
	it('the Arpeggiator view draws only the Arpeggiator', async () => {
		seed([]);
		const { container } = render(ArpeggiatorCentralView);
		await tick();
		const text = container.textContent ?? '';
		expect(text).toContain('Pattern');
		expect(text).toContain('Sync');
		for (const gone of ['Rand Vel', 'Oct +1', 'Chance']) expect(text).not.toContain(gone);
	});

	it('the Velocity view draws Rand Vel', async () => {
		seed([]);
		const { container } = render(VelocityCentralView);
		await tick();
		expect(container.textContent).toContain('Rand Vel');
	});

	it('the Chance view draws the Chance slider', async () => {
		seed([]);
		const { container } = render(ChanceCentralView);
		await tick();
		expect(container.textContent).toContain('Chance');
	});

	it('the Random view draws the Rand Oct slider', async () => {
		seed([]);
		const { container } = render(RandomCentralView);
		await tick();
		expect(container.textContent).toContain('Rand Oct');
	});

	it('the Random view draws Choices, Interval, Sign, Mode and Scale, lit from the device, and writes them', async () => {
		// Measured: 2 Choices, 3 Interval, 4 Sign (Add Sub Bi), 5 Mode (Rnd Alt), 6 Use Current Scale.
		seed([midiDevice('Random', 'MidiRandom', { 1: 0.5, 2: 1, 3: 12, 4: 2, 5: 1, 6: 0 })]);
		const { container, getByText } = render(RandomCentralView);
		await tick();
		const sliders = Array.from(container.querySelectorAll('[role="slider"]')).map((s) => s.getAttribute('aria-label')?.split(':')[0]);
		expect(sliders).toEqual(expect.arrayContaining(['Choices 1', 'Interval 12']));
		expect(getByText('Bi').classList.contains('active')).toBe(true);
		expect(getByText('Alt').classList.contains('active')).toBe(true);
		const wrote = (param: number) =>
			sendMock.mock.calls.filter(([addr, args]) => addr === '/looping/v3/param/set' && (args as unknown[])[0] === `${DEVICE}/params/${param}`).map(([, args]) => (args as unknown[])[1]);
		await fireEvent.click(getByText('Sub'));
		await fireEvent.click(getByText('Rnd'));
		await fireEvent.click(getByText('Scale'));
		expect(wrote(4)).toEqual([1]);
		expect(wrote(5)).toEqual([0]);
		expect(wrote(6)).toEqual([1]);
	});

	it('the Chord view draws two notes and the strum, and its Scale switch shows the shifts in scale degrees', async () => {
		// Measured: note n's Shift 4n - 3, Scale Degrees 4n - 2, Velocity 4n - 1, Chance 4n; 28 Use Current Scale.
		const labels = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="slider"]')).map((s) => s.getAttribute('aria-label')?.split(':')[0]);
		seed([midiDevice('Chord', 'MidiChord', { 1: 12, 3: 0.8, 4: 1, 5: 7, 7: 1.2, 8: 0.5, 28: 0 })]);
		const { container, getByText } = render(ChordCentralView);
		await tick();
		expect(labels(container)).toEqual(['+12 st', '80 %', '100 %', '+7 st', '120 %', '50 %', 'Strum', 'Tension', 'Crescendo']);
		await fireEvent.click(getByText('Scale'));
		expect(sendMock.mock.calls.find(([addr, args]) =>
			addr === '/looping/v3/param/set' && (args as unknown[])[0] === `${DEVICE}/params/28`
		)?.[1]).toEqual(expect.arrayContaining([`${DEVICE}/params/28`, 1]));
		cleanup();
		seed([midiDevice('Chord', 'MidiChord', { 1: 12, 2: 3, 28: 1 })]);
		const scaled = render(ChordCentralView);
		await tick();
		expect(labels(scaled.container)[0]).toBe('+3 sd');
	});
});
