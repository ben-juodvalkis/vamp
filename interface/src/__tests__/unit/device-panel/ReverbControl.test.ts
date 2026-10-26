/**
 * The Reverb tile draws what the reverb sounds like behind its pad once
 * there is one (ADR-477): an algorithm's tail, or the loaded IR's waveform.
 * An empty slot keeps the plain pad.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
// The IR's waveform: one decaying shape for any file, 2 s long.
vi.mock('$lib/services/clipWaveformService', () => ({
	getPeaks: vi.fn(async () => ({
		peaks: Array.from({ length: 16 }, (_, i) => [-(1 - i / 16), 1 - i / 16]),
		bins: 16,
		seconds: 2
	})),
	cancelPeaks: vi.fn()
}));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
// The stores before the grid (see BassControl.test.ts).
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import ReverbControl from '$lib/components/v6/device-panel/ReverbControl.svelte';
import { getSlotByDeviceType } from '$lib/config/fxGridLayout';
import { DEVICE_PRESETS } from '$lib/config/devicePresets';
import { LIVE_DEFAULTS } from '$lib/components/v6/device-panel/hybridReverbParams';
import {
	_resetForTests,
	replaceTree,
	type DeviceRecord,
	type ParamRecord,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import type { OSCArg } from '$lib/types/osc';

const TRACK = 'tracks/0';
const DEVICE = `${TRACK}/devices/0`;
const MAX: Record<number, number> = { 3: 16, 6: 4, 21: 29, 36: 9, 46: 9, 48: 3, 50: 4 };

function reverb(values: Record<number, number> = {}, properties: Record<string, OSCArg> = {}): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i <= 53; i++) {
		const paramPath = `${DEVICE}/params/${i}`;
		const value = values[i] ?? LIVE_DEFAULTS[i] ?? 0;
		params.set(paramPath, { paramPath, name: `P${i}`, displayName: `P${i}`, min: 0, max: MAX[i] ?? 1, value, unit: '' });
	}
	return {
		devicePath: DEVICE,
		name: DEVICE_PRESETS.reverb.defaultName,
		className: DEVICE_PRESETS.reverb.expectedClassName!,
		params,
		properties: new SvelteMap(Object.entries(properties))
	};
}

function track(devices: DeviceRecord[]): TrackRecord {
	return {
		trackPath: TRACK, name: 'Pad', color: 0x36a2ff, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: 'synth',
		devices: new SvelteMap(devices.map((d) => [d.devicePath, d])), slots: new SvelteMap()
	};
}

async function mountTile(devices: DeviceRecord[]): Promise<HTMLElement> {
	replaceTree(3, [track(devices)]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
	// The device the tile is handed, as the chain cell resolves it.
	const device = devices.find((d) => d.className === 'Hybrid') ?? null;
	const { container } = render(ReverbControl, { props: { device, position: getSlotByDeviceType('reverb')!.position } });
	await tick();
	const tile = Array.from(container.querySelectorAll<HTMLElement>('.device-control')).find((t) =>
		t.textContent?.includes('Reverb')
	);
	if (!tile) throw new Error('no Reverb tile');
	return tile;
}

const SPRING: Record<string, OSCArg> = {
	ir_category_list: JSON.stringify(['Early_Reflections', 'Real_Places', 'Chambers_and_Large_Rooms', 'Made_for_Drums', 'Halls', 'Plates', 'Springs']),
	ir_file_list: JSON.stringify(['Awesome Stereo Spring']),
	ir_category_index: 6,
	ir_file_index: 0,
	ir_attack_time: 0,
	ir_decay_time: 20,
	ir_size_factor: 1,
	ir_time_shaping_on: 1
};

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
		x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 150, width: 200, height: 150, toJSON: () => ({})
	} as DOMRect);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('the Reverb tile', () => {
	it('draws the plain pad while the slot is empty', async () => {
		const tile = await mountTile([]);
		expect(tile.querySelector('[data-reverb-portrait]')).toBeNull();
		expect(tile.querySelector('.ir-display')).toBeNull();
	});

	it('draws the tail behind its pad while the reverb runs an algorithm', async () => {
		const tile = await mountTile([reverb({ 48: 2, 6: 0 })]);
		expect(tile.querySelector('[data-reverb-portrait="darkHall"]')).not.toBeNull();
		expect(tile.querySelectorAll('[data-reverb-portrait] .ridge-line').length).toBeGreaterThan(0);
		// A tile's size: the picture and the title, no readouts.
		expect(tile.querySelector('[data-reverb-portrait]')?.classList.contains('compact')).toBe(true);
		expect(tile.textContent).toContain('Reverb');
	});

	it('draws the loaded IR’s waveform while the reverb runs an IR', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ files: [{ channel: 'mono', path: '/ir.aif' }] })));
		vi.stubGlobal('fetch', fetchMock);
		const tile = await mountTile([reverb({ 48: 3 }, SPRING)]);
		expect(tile.querySelector('[data-reverb-portrait]')).toBeNull();
		expect(fetchMock).toHaveBeenCalledWith('/api/reverb-ir?category=Springs&file=Awesome%20Stereo%20Spring');
		await vi.waitFor(() => expect(tile.querySelectorAll('.ir-display path').length).toBeGreaterThan(0));
	});
});
