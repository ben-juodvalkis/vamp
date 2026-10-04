/**
 * GuitarCentralView's Octave panel: a Helix Native set up as an octave
 * pedal. The device dump of the running plug-in (2026-10-03) lists two
 * knobs, `1: Knob 01 0..1` (the mix) and `2: Knob 02 0..1` (the pitch,
 * -12..+12 semitones; it read `0.791667=0.79` at +7). The pitch is a
 * four-way tab, top to bottom +12 (1), +7 (19/24), -5 (7/24), -12 (0).
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
const HELIX = `${TRACK}/devices/0`;

function helix(pitch: number): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	[['Device On', 1], ['Knob 01', 0], ['Knob 02', pitch]].forEach(([name, value], i) => {
		const paramPath = `${HELIX}/params/${i}`;
		params.set(paramPath, {
			paramPath, name: name as string, displayName: name as string,
			min: 0, max: 1, value: value as number, unit: ''
		});
	});
	return { devicePath: HELIX, name: 'Helix Native', className: 'AuPluginDevice', params, properties: new SvelteMap() };
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
		.filter(([, args]) => Array.isArray(args) && args.includes(`${HELIX}/params/2`))
		.map(([, args]) => (args as unknown[])[1]);
}

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => cleanup());

describe('GuitarCentralView Octave pitch tab', () => {
	it('draws +12, +7, -5, -12 top to bottom and lights the device\'s step', async () => {
		seed(helix(19 / 24));
		const { container } = render(GuitarCentralView);
		await tick();
		expect(tabs(container).map((b) => b.textContent?.trim())).toEqual(['+12', '+7', '-5', '-12']);
		expect(tabs(container).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);
	});

	it('writes each interval\'s value to Knob 02', async () => {
		seed(helix(1));
		const { container } = render(GuitarCentralView);
		await tick();
		for (const b of tabs(container)) await fireEvent.click(b);
		expect(pitchWrites()).toEqual([1, 19 / 24, 7 / 24, 0]);
	});
});
