/**
 * The FX grid under a pad scope (issue #491, 2026-09-10).
 *
 * While a pad is held on the selected track's Drum Rack: the grid wears
 * the scope chip and the pad's frame, every tile carries the pad note,
 * a tile the pad's chain has reads active from presence alone, a
 * ghost tile's first touch loads INTO the pad, and a device that cannot
 * live on a pad dims. Lift, and the grid is the track's again.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/services/trackCommands', () => ({ setTrackName: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { send } from '$lib/api/simpleClient';
// The stores before the grid: `fxGridLayout` imports the tile components,
// which import the stores, which import `fxGridLayout` — a cycle the app
// enters from the store side. Entering from the grid side leaves
// `FX_GRID_LAYOUT` undefined while `slotRegistry` initialises.
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import FXGrid from '$lib/components/v6/device-panel/FXGrid.svelte';
import { FX_GRID_LAYOUT, FX_GRID_COLUMNS, SQUASH_CELL, PITCH_CELL, GLITCH_CELL, GUITAR_CELL, cellFor, type GridCell, type GridTrackKind } from '$lib/config/fxGridLayout';
import { currentInstrumentStore } from '$lib/stores/v6/currentInstrumentStore.svelte';
import { drumPadScope } from '$lib/stores/v6/drumPadScope.svelte';
import { setPropertySender } from '$lib/stores/v3/propertySubscriptions.svelte';
import { DEVICE_PRESETS } from '$lib/config/devicePresets';
import {
	_resetForTests,
	applyPropertyValue,
	mergePadChain,
	replaceTree,
	type DeviceRecord,
	type ParamRecord,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import type { OSCArg } from '$lib/types/osc';

const sendMock = vi.mocked(send);
const propertyWire = vi.fn();
setPropertySender(propertyWire);

const TRACK = 'tracks/0';
const RACK = `${TRACK}/devices/0`;
const PAD = `${RACK}/pads/38`;
const INSTRUMENT = { deviceIndex: 0, className: 'DrumGroupDevice', name: 'Drum Rack', type: 'instrument' as const, devicePath: RACK };

function drums(): TrackRecord {
	const rack: DeviceRecord = {
		devicePath: RACK, name: 'Drum Rack', className: 'DrumGroupDevice',
		params: new SvelteMap(), properties: new SvelteMap<string, OSCArg>()
	};
	return {
		trackPath: TRACK, name: 'Drums', color: 0xff3636, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: 'drum',
		devices: new SvelteMap([[RACK, rack]]), slots: new SvelteMap()
	};
}

const MEMBERS = JSON.stringify({
	padCount: 2, padClasses: { DrumCell: 2 }, hasMacroMappings: false, family: false, functions: {},
	pads: [{ note: 36, name: 'Kick', class: 'DrumCell', color: null }, { note: 38, name: 'Snare 2', class: 'DrumCell', color: 0x85961f }]
});
const PRESENCE = JSON.stringify({
	pads: { '38': [{ index: 0, class: 'DrumCell', name: 'Snare', type: 1 }, { index: 1, class: 'Hybrid', name: 'Reverb', type: 2 }] }
});

function tileFor(container: HTMLElement, title: string): HTMLElement {
	const el = Array.from(container.querySelectorAll<HTMLElement>('.device-control')).find((t) => t.textContent?.includes(title));
	if (!el) throw new Error(`no tile ${title}`);
	return el;
}

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
	drumPadScope.clear();
	replaceTree(3, [drums()]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
	currentInstrumentStore.setInstrument(INSTRUMENT, 'drumrack');
	applyPropertyValue(RACK, 'vm.members', MEMBERS);
	applyPropertyValue(RACK, 'vm.padFx', PRESENCE);
});
afterEach(() => cleanup());

describe('FXGrid — the grid is the held pad\'s', () => {
	it('subscribes the rack\'s presence row while a Drum Rack is the instrument', async () => {
		render(FXGrid);
		await tick();
		const subscribed = propertyWire.mock.calls
			.filter(([a]) => a === '/looping/v3/property/subscribe')
			.map(([, args]) => (args as string[])[1]);
		expect(subscribed).toContain('vm.padFx');
	});

	it('subscribes the held pad\'s chain row for exactly as long as it is held', async () => {
		render(FXGrid);
		await tick();
		const wire = (address: string) =>
			propertyWire.mock.calls.filter(([a]) => a === address).map(([, args]) => (args as string[])[1]);
		expect(wire('/looping/v3/property/subscribe')).not.toContain('vm.padChain.38');

		drumPadScope.press(RACK, 38, 1, 0);
		await tick();
		expect(wire('/looping/v3/property/subscribe')).toContain('vm.padChain.38');
		expect(wire('/looping/v3/property/unsubscribe')).not.toContain('vm.padChain.38');

		// A census re-emit rebuilds the scope object; the row must not churn.
		applyPropertyValue(RACK, 'vm.members', MEMBERS.replace('"padCount":2', '"padCount":2 '));
		await tick();
		expect(wire('/looping/v3/property/subscribe').filter((n) => n === 'vm.padChain.38')).toHaveLength(1);

		drumPadScope.release(1, 'up', 500);
		await tick();
		expect(wire('/looping/v3/property/unsubscribe')).toContain('vm.padChain.38');
	});

	it('wears the chip and scopes every tile to the held pad, and lets go on release', async () => {
		const { container } = render(FXGrid);
		await tick();
		expect(container.querySelector('.fx-scope-chip')).toBeNull();
		expect(container.querySelector('.fx-grid.fx-scoped')).toBeNull();
		expect(tileFor(container, 'Reverb').getAttribute('data-fx-scope')).toBeNull();

		drumPadScope.press(RACK, 38, 1, 0);
		await tick();
		expect(container.querySelector('.fx-scope-chip')?.textContent).toBe('Snare 2');
		expect(container.querySelector('.fx-grid.fx-scoped')).not.toBeNull();
		expect(tileFor(container, 'Reverb').getAttribute('data-fx-scope')).toBe('38');
		// The pad's chain carries a Reverb: active from presence alone, no records yet.
		expect(tileFor(container, 'Reverb').classList.contains('device-ghost')).toBe(false);
		// It carries no Delay: ghost.
		expect(tileFor(container, 'Echo').classList.contains('device-ghost')).toBe(true);
		// Every tile on the grid may live on a pad now (2026-09-11): the amp
		// racks load through the browser and are moved into the chain, the
		// MIDI effects go in at the chain's head, the Drum Buss by name.
		expect(container.querySelectorAll('.device-unscoped').length).toBe(0);
		for (const title of ['Rand Oct', 'Drum', 'Glue']) {
			expect(tileFor(container, title).classList.contains('device-ghost'), title).toBe(true);
		}

		drumPadScope.release(1, 'up', 500);
		await tick();
		expect(container.querySelector('.fx-scope-chip')).toBeNull();
		expect(tileFor(container, 'Reverb').getAttribute('data-fx-scope')).toBeNull();
		expect(tileFor(container, 'Reverb').classList.contains('device-ghost')).toBe(true); // the track has none
	});

	it('stands Squash over Gain in one column, and a pad can scope Squash', async () => {
		const { container } = render(FXGrid);
		await tick();
		expect(container.querySelector('.fx-grid')?.classList.contains('grid-cols-10')).toBe(true);
		const cellOf = (title: string) => {
			const tile = Array.from(container.querySelectorAll<HTMLElement>('.device-control')).find((t) => t.textContent?.includes(title));
			const c = tile!.closest<HTMLElement>('[data-cell]')!;
			return [c.dataset.col, c.dataset.row, c.dataset.span, c.dataset.rowSpan].join('/');
		};
		// col/row/span/rowSpan (2026-10-24): Glue over Gain in the last
		// column, Glitch over Variation inside it; Pitch over the Saturator
		// inside the first; three XYs a row between.
		expect(cellOf('Glue')).toBe('10/1/1/1');
		expect(cellOf('Gain')).toBe('10/2/1/1');
		expect(cellOf('Sat')).toBe('2/2/1/1');
		expect(cellOf('Var')).toBe('9/2/1/1');
		expect(cellOf('Pitch')).toBe('2/1/1/1');
		expect(cellOf('Glitch')).toBe('9/1/1/1');
		expect(cellOf('EQ')).toBe('3/1/2/1');
		expect(cellOf('Tremolo')).toBe('3/2/2/1');
		expect(cellOf('Drum')).toBe('7/1/2/1');
		const titles = Array.from(container.querySelectorAll('.device-control')).map((t) => t.textContent ?? '');
		expect(titles.some((t) => t.includes('Chorus'))).toBe(false);
		// MIDI: Rand Oct over the Gtr (2026-10-23).
		expect(cellOf('Rand Oct')).toBe('1/1/1/1');
		expect(cellOf('Gtr')).toBe('1/2/1/1');
		drumPadScope.press(RACK, 38, 1, 0);
		await tick();
		expect(tileFor(container, 'Glue').getAttribute('data-fx-scope')).toBe('38');
		expect(tileFor(container, 'Glue').classList.contains('device-unscoped')).toBe(false);
		drumPadScope.release(1, 'up', 500);
	});

	it('names an uncoloured pad by its note when the census has no name for it', async () => {
		const { container } = render(FXGrid);
		drumPadScope.press(RACK, 40, 1, 0);
		await tick();
		expect(container.querySelector('.fx-scope-chip')?.textContent).toBe('Pad 40');
	});

	it('shows the PAD device\'s values while the pad is scoped, and keeps them after a write', async () => {
		// The pad's chain: an Auto Filter with cutoff 0.3 / resonance 0.6.
		const padFilter = `${PAD}/devices/1`;
		const params = new SvelteMap<string, ParamRecord>();
		for (const [i, value] of [[0, 1], [1, 0.3], [2, 0.6], [4, 0]] as [number, number][]) {
			const paramPath = `${padFilter}/params/${i}`;
			params.set(paramPath, { paramPath, name: `P${i}`, displayName: `P${i}`, min: 0, max: 1, value, unit: '' });
		}
		mergePadChain(4, PAD, new Map([[padFilter, { devicePath: padFilter, name: 'Auto Filter', className: 'AutoFilter2', params, properties: new SvelteMap() }]]));
		// Presence names the same chain — the surface emits it in the same
		// composite as the bundle, and presence decides which effects exist.
		applyPropertyValue(RACK, 'vm.padFx', JSON.stringify({
			pads: { '38': [{ index: 0, class: 'DrumCell', name: 'Snare', type: 1 }, { index: 1, class: 'AutoFilter2', name: 'Auto Filter', type: 2 }] }
		}));
		const { container } = render(FXGrid);
		await tick();
		// Unscoped: the track has no Auto Filter, so the tile rests at its defaults.
		const label = () => tileFor(container, 'Filter').querySelector('.xy-container')?.getAttribute('aria-label');
		expect(label()).toBe('Filter: X 100%, Y 0%');

		drumPadScope.press(RACK, 38, 1, 0);
		await tick();
		expect(label()).toBe('Filter: X 30%, Y 60%');

		// A write to the pad's device shows, and stays, on the pad's tile.
		selectedTrackStore.setParamValue(`${padFilter}/params/2`, 0.2);
		selectedTrackStore.disarmParamPath(`${padFilter}/params/2`);
		await tick();
		expect(label()).toBe('Filter: X 30%, Y 20%');

		drumPadScope.release(1, 'up', 500);
		await tick();
		expect(label()).toBe('Filter: X 100%, Y 0%');
	});

	it("keeps a loading pad's chain row subscribed after the finger lifts, until the device lands", async () => {
		render(FXGrid);
		await tick();
		const wire = (address: string) =>
			propertyWire.mock.calls.filter(([a]) => a === address).map(([, args]) => (args as string[])[1]);

		drumPadScope.press(RACK, 38, 1, 0);
		await tick();
		fxGrid.loadDevice('echo', PAD);
		await tick();
		drumPadScope.release(1, 'up', 500); // lifted inside the surface's composite window
		await tick();
		expect(wire('/looping/v3/property/unsubscribe')).not.toContain('vm.padChain.38');
		expect(wire('/looping/v3/property/subscribe').filter((n) => n === 'vm.padChain.38')).toHaveLength(1);

		// The composite lands — presence first, then the pad bundle: the load
		// completes, the row is let go.
		applyPropertyValue(RACK, 'vm.padFx', JSON.stringify({
			pads: { '38': [
				{ index: 0, class: 'DrumCell', name: 'Snare', type: 1 },
				{ index: 1, class: 'Hybrid', name: 'Reverb', type: 2 },
				{ index: 2, class: 'Echo', name: 'Echo', type: 2 }
			] }
		}));
		const delay: DeviceRecord = {
			devicePath: `${PAD}/devices/2`, name: 'Echo', className: 'Echo',
			params: new SvelteMap(), properties: new SvelteMap<string, OSCArg>()
		};
		mergePadChain(5, PAD, new Map([[`${PAD}/devices/2`, delay]]));
		await tick();
		expect(selectedTrackStore.getFxGridSlot('echo', PAD).state).toBe('active');
		expect(wire('/looping/v3/property/unsubscribe')).toContain('vm.padChain.38');
	});

	it('loads a ghost tile into the pad on first touch', async () => {
		const { container } = render(FXGrid);
		drumPadScope.press(RACK, 38, 1, 0);
		await tick();
		const delay = tileFor(container, 'Echo');
		const pad = delay.querySelector<HTMLElement>('.device-xy, [role="slider"]');
		expect(pad).not.toBeNull();
		// A first drag frame through the tile's own interaction path.
		fxGrid.loadDevice('echo', PAD);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/device/load', [TRACK, PAD, '', 'native:Echo', 'Echo']);
		expect(selectedTrackStore.getFxGridSlot('echo', PAD).state).toBe('loading');
		expect(selectedTrackStore.getFxGridSlot('echo').state).toBe('ghost');
	});
});

/**
 * The column arithmetic, pinned (2026-10-15, ten columns since the Chorus and Pitch tiles left).
 *
 * The TotalMix status strip's ruler in `layouts/default/Layout.svelte` is hard-coupled to the
 * column count with no shared constant, deliberately, so the count is worth
 * a test on this side. Every cell is placed explicitly, and both track kinds
 * must tile the same ten-by-two grid exactly: no gap, no overlap, no
 * implicit third row. That is what keeps the XY tiles and the ruler still
 * when the selected track changes kind.
 */
describe("the Drum cell is the Drum's only on a drum track", () => {
	const fx6 = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-cell="fx6"]')!;

	it('draws the Drum on a track filed under Drum, and under Perc', async () => {
		const { container } = render(FXGrid);
		await tick();
		expect(fx6(container).textContent).toContain('Drum');
		expect(fx6(container).textContent).not.toContain('Chorus');

		replaceTree(3, [{ ...drums(), role: 'perc' }]);
		await tick();
		expect(fx6(container).textContent).not.toContain('Chorus');
	});

	it('draws the Chorus there on any other track, even one holding a Drum Rack', async () => {
		replaceTree(3, [{ ...drums(), role: 'synth' }]);
		const { container } = render(FXGrid);
		await tick();
		expect(fx6(container).textContent).toContain('Chorus');
	});

	it('draws the Chorus on an audio track, even one filed under Drum', async () => {
		replaceTree(3, [{ ...drums(), role: 'drum', hasMidiInput: false, hasAudioInput: true, devices: new SvelteMap() }]);
		const { container } = render(FXGrid);
		await tick();
		expect(fx6(container).textContent).toContain('Chorus');
	});

	it('falls back to the instrument when the track records no category', async () => {
		replaceTree(3, [{ ...drums(), role: '' }]);
		const { container } = render(FXGrid);
		await tick();
		expect(fx6(container).textContent).not.toContain('Chorus');

		replaceTree(3, [{ ...drums(), role: '', devices: new SvelteMap() }]);
		await tick();
		expect(fx6(container).textContent).toContain('Chorus');
	});
});

describe('the FX grid layout is ten columns wide', () => {
	function occupancy(kind: GridTrackKind) {
		const cells: Array<[string, GridCell]> = FX_GRID_LAYOUT.filter((s) => !s.hidden).map((s) => [s.deviceType as string, cellFor(s, kind)]);
		cells.push(['squash', SQUASH_CELL], ['pitch', PITCH_CELL], ['glitch', GLITCH_CELL]);
		cells.push(['guitar', GUITAR_CELL]);
		const grid: string[][] = [0, 1].map(() => Array(FX_GRID_COLUMNS).fill(''));
		for (const [name, c] of cells) {
			for (let r = c.row; r < c.row + c.rowSpan; r++) {
				for (let col = c.col; col < c.col + c.span; col++) {
					expect(r, `${kind} ${name} row`).toBeLessThanOrEqual(2);
					expect(col, `${kind} ${name} col`).toBeLessThanOrEqual(FX_GRID_COLUMNS);
					expect(grid[r - 1][col - 1], `${kind} ${name} overlaps at ${r}/${col}`).toBe('');
					grid[r - 1][col - 1] = name;
				}
			}
		}
		return grid;
	}

	it('draws Main as an audio track: the Bass over the Gtr (2026-10-24)', async () => {
		selectedTrackStore.handleTrackSelected(-1);
		const { container } = render(FXGrid);
		await tick();
		const cell = (name: string) => container.querySelector<HTMLElement>(`[data-cell="${name}"]`);
		expect(cell('fx1')?.textContent).toContain('Bass');
		expect(cell('fx1')?.textContent).not.toContain('Rand Oct');
		expect(cell('guitar')?.textContent).toContain('Gtr');
		expect([cell('fx1')?.dataset.row, cell('fx1')?.dataset.rowSpan]).toEqual(['1', '1']);
	});

	it('tiles both rows exactly on MIDI, with Rand Oct over the Guitar and Squash over Gain', () => {
		const grid = occupancy('midi');
		expect(grid.flat().every(Boolean)).toBe(true);
		expect([grid[0][0], grid[1][0]]).toEqual(['random', 'guitar']);
		// The user's order (2026-10-24): sliders inside the outer columns,
		// three XYs a row between.
		expect([grid[0][1], grid[1][1]]).toEqual(['pitch', 'saturator']);
		expect(grid[0].slice(2, 8).filter((_, i) => i % 2 === 0)).toEqual(['eq', 'filter', 'drum']);
		expect(grid[1].slice(2, 8).filter((_, i) => i % 2 === 0)).toEqual(['tremolo', 'echo', 'reverb']);
		expect([grid[0][8], grid[1][8]]).toEqual(['glitch', 'variation']);
		expect([grid[0][9], grid[1][9]]).toEqual(['squash', 'utility']);
	});

	it('tiles both rows exactly on audio: the Bass over the Guitar, Squash over Gain', () => {
		const grid = occupancy('audio');
		expect(grid.flat().every(Boolean)).toBe(true);
		// fx1's slot holds the Bass on audio.
		expect([grid[0][0], grid[1][0]]).toEqual(['random', 'guitar']);
		expect([grid[0][9], grid[1][9]]).toEqual(['squash', 'utility']);
	});

	it('keeps every XY tile in the same place on both kinds', () => {
		for (const s of FX_GRID_LAYOUT.filter((slot) => slot.span === 2)) {
			expect(cellFor(s, 'audio'), s.deviceType).toEqual(cellFor(s, 'midi'));
		}
	});

	it('has no Guitar layout entry: FXGrid places it from GUITAR_CELL', () => {
		expect(FX_GRID_LAYOUT.some((s) => s.deviceType === 'guitar')).toBe(false);
	});
});
