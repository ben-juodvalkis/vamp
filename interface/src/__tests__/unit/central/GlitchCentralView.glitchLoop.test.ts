/**
 * GlitchCentralView's GlitchLoop (2026-10-15): the device's Play page —
 * the preset bank, the macro pads and the FX (Clock and Mix are the
 * tile's) — found by
 * parameter NAME. The fixture is the 153-parameter build measured on the
 * rig; one case shifts every index to show the names, not the positions,
 * decide. Presets come from `GET /api/glitchloop/presets` (stubbed fetch)
 * and a press writes them in one `device/params/set`.
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
import GlitchCentralView from '$lib/components/v6/central/views/GlitchCentralView.svelte';
import { matchingPreset, glitchLoopIndex, type GlitchLoopPresets } from '$lib/components/v6/device-panel/glitchLoopParams';
import { send } from '$lib/api/simpleClient';

const TRACK = 'tracks/0';
const GL = `${TRACK}/devices/0`;

const AT = { clock: 13, dryWet: 19, freeze: 132, segL: 136, routing: 135 };

function glitchLoop(values: Partial<Record<keyof typeof AT, number>> = {}, shift = 0): DeviceRecord {
	const named: Record<number, [string, number, number, number]> = {
		[AT.clock + shift]: ['Clock', values.clock ?? 5, 0, 10],
		[AT.dryWet + shift]: ['Dry/Wet', values.dryWet ?? 0, 0, 100],
		[AT.freeze + shift]: ['Freeze', values.freeze ?? 0, 0, 1],
		[AT.routing + shift]: ['Routing', values.routing ?? 2, 0, 2],
		[AT.segL + shift]: ['Segment L', values.segL ?? 7, 0.1, 50]
	};
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i < 153 + shift; i++) {
		const paramPath = `${GL}/params/${i}`;
		const [name, value, min, max] = named[i] ?? [`P${i}`, 0, 0, 100];
		params.set(paramPath, { paramPath, name, displayName: name, min, max, value, unit: '' });
	}
	return { devicePath: GL, name: 'GlitchLoop', className: 'MxDeviceAudioEffect', params, properties: new SvelteMap() };
}

function seed(device: DeviceRecord) {
	const t: TrackRecord = {
		trackPath: TRACK, name: 'Keys', color: 0xff8040, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: '',
		devices: new SvelteMap([[device.devicePath, device]]), slots: new SvelteMap()
	};
	replaceTree(3, [t]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
}

const PRESETS: GlitchLoopPresets = {
	bank: ['Memories', 'Bloop Steps'],
	presets: {
		Memories: { 'Segment L': 7, Routing: 2 },
		'Bloop Steps': { 'Segment L': 12, Routing: 1 }
	},
	untouched: ['Dry/Wet', 'Clock', 'Freeze']
};

const written = (i: number) =>
	vi.mocked(send).mock.calls
		.filter(([addr, args]) => addr === '/looping/v3/param/set' && Array.isArray(args) && args[0] === `${GL}/params/${i}`)
		.map(([, args]) => (args as unknown[])[1]);

const buttons = (container: HTMLElement, selector: string) =>
	Array.from(container.querySelectorAll<HTMLButtonElement>(selector));

async function settle() {
	for (let i = 0; i < 5; i++) await tick();
	await new Promise((r) => setTimeout(r, 0));
	await tick();
}

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
	vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => PRESETS })));
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('GlitchCentralView GlitchLoop', () => {
	it('leaves Clock and Mix to the tile, and has no Freeze or Mod Hold', async () => {
		seed(glitchLoop());
		const { container } = render(GlitchCentralView);
		await settle();
		expect(container.querySelector('[aria-label^="Mix:"]')).toBeNull();
		expect(container.textContent).not.toMatch(/Clock|Freeze|Hold/);
	});

	it('lists the bank and lights the preset the device matches', async () => {
		seed(glitchLoop({ segL: 7, routing: 2 }));
		const { container } = render(GlitchCentralView);
		await settle();
		const presets = buttons(container, '.preset-btn');
		expect(presets.map((b) => b.textContent?.trim())).toEqual(['Memories', 'Bloop Steps']);
		expect(presets.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
	});

	it('writes a preset in one device/params/set, by name', async () => {
		seed(glitchLoop());
		const { container } = render(GlitchCentralView);
		await settle();
		await fireEvent.click(buttons(container, '.preset-btn')[1]);
		const calls = vi.mocked(send).mock.calls.filter(([addr]) => addr === '/looping/v3/device/params/set');
		expect(calls).toHaveLength(1);
		const [path, values] = calls[0][1] as [string, string, number];
		expect(path).toBe(GL);
		expect(JSON.parse(values)).toEqual({ 'Segment L': 12, Routing: 1 });
	});
});

describe('glitchLoopIndex', () => {
	it('finds a parameter by name wherever the build put it, else the measured index', () => {
		const names = Array.from({ length: 160 }, (_, i) => `P${i}`);
		names[29] = 'Duck';
		expect(glitchLoopIndex(names, 'duck')).toBe(29);
		expect(glitchLoopIndex([], 'duck')).toBe(20);
	});
});

describe('matchingPreset', () => {
	const read = (held: Record<string, number>) => (name: string) =>
		name in held ? { value: held[name], min: 0, max: 100 } : undefined;

	it('matches within 1e-5 of the range and not beyond', () => {
		expect(matchingPreset(PRESETS, read({ 'Segment L': 12.0005, Routing: 1 }))).toBe(1);
		expect(matchingPreset(PRESETS, read({ 'Segment L': 12.01, Routing: 1 }))).toBe(-1);
	});

	it('matches nothing when a preset\'s parameter is missing', () => {
		expect(matchingPreset(PRESETS, read({ 'Segment L': 7 }))).toBe(-1);
	});
});
