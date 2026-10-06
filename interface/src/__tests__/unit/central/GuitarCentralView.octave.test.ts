/**
 * GuitarCentralView's Octave panel: Ben's Polyphonic Pitch Shifter, saved
 * as Octave.amxd. The device dump of the running device (2026-10-05) lists
 * `1: Semitones -12..12` (labels `-12 st` .. `+12 st`) and `2: Mix 0..100`.
 * The pitch is a four-way tab, top to bottom +12, +7, -5, -12, written as
 * raw semitones.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { replaceTree, _resetForTests, type TrackRecord, type DeviceRecord, type ParamRecord } from '$lib/stores/v3/normalized.svelte';
import GuitarCentralView from '$lib/components/v6/central/views/GuitarCentralView.svelte';
import { send } from '$lib/api/simpleClient';

const TRACK = 'tracks/0';
const OCTAVE = `${TRACK}/devices/0`;

function octaveDevice(pitch: number): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	([['Device On', 0, 1, 1], ['Semitones', -12, 12, pitch], ['Mix', 0, 100, 50]] as const).forEach(([name, min, max, value], i) => {
		const paramPath = `${OCTAVE}/params/${i}`;
		params.set(paramPath, { paramPath, name, displayName: name, min, max, value, unit: '' });
	});
	return { devicePath: OCTAVE, name: 'Octave', className: 'MxDeviceAudioEffect', params, properties: new SvelteMap() };
}

function seed(device: DeviceRecord) {
	const t: TrackRecord = {
		trackPath: TRACK, name: 'Bass', color: 0xff8040, mute: false, solo: false, arm: false,
		hasMidiInput: false, hasAudioInput: true, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: '',
		devices: new SvelteMap([[device.devicePath, device]]), slots: new SvelteMap()
	};
	replaceTree(3, [t]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
}

const tabs = (container: HTMLElement) =>
	Array.from(container.querySelectorAll<HTMLButtonElement>('.pitch-step'));

function pitchWrites(): unknown[] {
	return vi.mocked(send).mock.calls
		.filter(([, args]) => Array.isArray(args) && args.includes(`${OCTAVE}/params/1`))
		.map(([, args]) => (args as unknown[])[1]);
}

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => cleanup());

describe('GuitarCentralView Octave pitch tab', () => {
	it('draws +12, +7, -5, -12 top to bottom and lights the device\'s step', async () => {
		seed(octaveDevice(7));
		const { container } = render(GuitarCentralView);
		await tick();
		expect(tabs(container).map((b) => b.textContent?.trim())).toEqual(['+12', '+7', '-5', '-12']);
		expect(tabs(container).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);
	});

	it('writes each interval to Semitones as raw semitones', async () => {
		seed(octaveDevice(12));
		const { container } = render(GuitarCentralView);
		await tick();
		for (const b of tabs(container)) await fireEvent.click(b);
		expect(pitchWrites()).toEqual([12, 7, -5, -12]);
	});
});
