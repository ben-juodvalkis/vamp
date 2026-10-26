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
	for (let i = 0; i <= 16; i++) {
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

	it('the Chord view toggles a shift between its interval and 0', async () => {
		seed([midiDevice('Chord', 'MidiChord', { 1: 0, 5: 24 })]);
		const { getByText } = render(ChordCentralView);
		await tick();
		const plusTwo = getByText('Oct +2');
		expect(plusTwo.classList.contains('active')).toBe(true);
		await fireEvent.click(getByText('Oct +1'));
		expect(sendMock.mock.calls.find(([addr, args]) =>
			addr === '/looping/v3/param/set' && (args as unknown[])[0] === `${DEVICE}/params/1`
		)?.[1]).toEqual(expect.arrayContaining([`${DEVICE}/params/1`, 12]));
		await fireEvent.click(plusTwo);
		expect(sendMock.mock.calls.find(([addr, args]) =>
			addr === '/looping/v3/param/set' && (args as unknown[])[0] === `${DEVICE}/params/5`
		)?.[1]).toEqual(expect.arrayContaining([`${DEVICE}/params/5`, 0]));
	});
});
