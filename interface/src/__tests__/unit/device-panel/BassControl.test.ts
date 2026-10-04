/**
 * BassControl — the whole of fx1 on AUDIO tracks.
 *
 * fx1 is the grid's one row-1 single-column slot, and the Bass is what
 * audio puts in it: Rand Oct is a MIDI-effect control and can do nothing
 * on a track with no MIDI. The column was split between clip pitch and the
 * Bass for one day (2026-09-14 → 2026-09-15); the ten-column cut took the
 * split with it, and clip pitch was the half to lose because
 * ClipCentralView already draws the same slider on the same store and the
 * same setter.
 *
 * Three things have to hold, and each has a matching defect in this
 * codebase's history:
 *   - the registry has to ALIAS `bass` to the Guitar view, or the tap
 *     resolves to the placeholder (a830a7a for `random`, the 2026-09-12
 *     review for `ott`);
 *   - a browser load lands at the END of the chain, so a load from here
 *     has to be followed by a move to its head, exactly as the Bass panel
 *     in `GuitarCentralView` does;
 *   - and that move must be armed ONLY by a gesture that can load, or a
 *     latch left standing fires on the next bass device to arrive from
 *     anywhere.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
// enters from the store side (see FXGrid.scope.test.ts).
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import FXGrid from '$lib/components/v6/device-panel/FXGrid.svelte';
import BassControl from '$lib/components/v6/device-panel/BassControl.svelte';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import { CENTRAL_VIEW_REGISTRY, resolveViewComponent } from '$lib/components/v6/central/viewRegistry';
import { DEVICE_PRESETS } from '$lib/config/devicePresets';
import {
	_resetForTests,
	replaceTree,
	type DeviceRecord,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import type { OSCArg } from '$lib/types/osc';

const sendMock = vi.mocked(send);
const SLIDER_HEIGHT = 200;

const TRACK = 'tracks/0';
const BASS_PATH = `${TRACK}/devices/2`;

/** An AUDIO track: no MIDI in, audio in — `trackType === 'audio'`. */
function audioTrack(): TrackRecord {
	return {
		trackPath: TRACK, name: 'Gtr', color: 0xff3636, mute: false, solo: false, arm: false,
		hasMidiInput: false, hasAudioInput: true, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: 'inst',
		devices: new SvelteMap<string, DeviceRecord>(), slots: new SvelteMap()
	};
}

/** The Bass Amp rack the `bass` slot matches on: className + name. */
function bassAmp(): DeviceRecord {
	return {
		devicePath: BASS_PATH,
		name: DEVICE_PRESETS.bass.defaultName,
		className: DEVICE_PRESETS.bass.expectedClassName!,
		params: new SvelteMap(),
		properties: new SvelteMap<string, OSCArg>()
	};
}

/** Land a Bass device on the track, the way a load's `state/full` would. */
function bassArrives(): void {
	const track = audioTrack();
	track.devices.set(BASS_PATH, bassAmp());
	replaceTree(4, [track]);
}

function pointer(el: HTMLElement, type: string, clientY: number) {
	const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY });
	Object.defineProperty(ev, 'pointerId', { value: 1 });
	el.dispatchEvent(ev);
}

function slider(root: HTMLElement): HTMLElement {
	const el = root.querySelector<HTMLElement>('[role="slider"]');
	if (!el) throw new Error('no Bass slider');
	return el;
}

const loads = () => sendMock.mock.calls.filter(([addr]) => addr === '/looping/v3/device/load');
const moves = () => sendMock.mock.calls.filter(([addr]) => addr === '/looping/v3/device/move_to_top');

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
	replaceTree(3, [audioTrack()]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
	centralDisplayStore.setView('default');
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

describe('the audio track\'s fx1 column', () => {
	it('is the Guitar full height, then the Bass over Variation, with no clip-pitch slider', async () => {
		const { container } = render(FXGrid);
		await tick();

		const bassTile = Array.from(container.querySelectorAll<HTMLElement>('.device-control'))
			.find((t) => t.textContent?.includes('Bass'));
		expect(bassTile).toBeDefined();

		// Audio puts the Guitar full height in column 1 and the Bass over
		// Variation in column 2 (2026-09-15). col/row/span/rowSpan:
		const cell = (el: Element) => {
			const c = el.closest<HTMLElement>('[data-cell]')!;
			return [c.dataset.col, c.dataset.row, c.dataset.span, c.dataset.rowSpan].join('/');
		};
		expect(cell(bassTile!)).toBe('2/1/1/1');
		const tiles = Array.from(container.querySelectorAll<HTMLElement>('.device-control'));
		const gtr = tiles.find((t) => t.textContent?.includes('Gtr'));
		expect(gtr).toBeDefined();
		expect(cell(gtr!)).toBe('1/1/1/2');
		expect(cell(tiles.find((t) => t.textContent?.includes('Var'))!)).toBe('2/2/1/1');

		// The clip-pitch slider went with the split — it lives in the Clip
		// view, which the strip's Clip band opens in one tap.
		expect(container.textContent).not.toContain('Pitch');

		// Rand Oct is the MIDI track's tile, never audio's.
		const titles = Array.from(container.querySelectorAll<HTMLElement>('.device-control'))
			.map((t) => t.textContent ?? '');
		expect(titles.some((t) => t.includes('Rand Oct'))).toBe(false);

		// Twelve columns on audio as on MIDI; the TotalMix ruler rides on it.
		expect(container.querySelector('.fx-grid')?.classList.contains('grid-cols-12')).toBe(true);
	});

	it('does not draw on a MIDI track, which keeps Rand Oct in that slot', async () => {
		const midi = audioTrack();
		midi.hasMidiInput = true;
		midi.hasAudioInput = false;
		replaceTree(4, [midi]);
		selectedTrackStore.handleTrackSelected(0);
		fxGrid.resetForTrackChange();

		const { container } = render(FXGrid);
		await tick();
		const titles = Array.from(container.querySelectorAll<HTMLElement>('.device-control'))
			.map((t) => t.textContent ?? '');
		expect(titles.some((t) => t.includes('Rand Oct'))).toBe(true);
		expect(titles.some((t) => t.includes('Bass'))).toBe(false);
		expect(titles.some((t) => t.includes('Gtr'))).toBe(false);
	});
});

describe('BassControl', () => {
	it('opens the Guitar view on a tap — the registry aliases `bass` to it', async () => {
		// The reason the alias has to exist: an unregistered type resolves to
		// the placeholder, which would swap the view out from under the tile.
		expect(resolveViewComponent('device', 'bass')).not.toBe(CENTRAL_VIEW_REGISTRY.default);
		expect(CENTRAL_VIEW_REGISTRY.device['bass']).toBeDefined();

		const { container } = render(BassControl);
		await tick();
		const el = slider(container);
		pointer(el, 'pointerdown', 100);
		pointer(el, 'pointerup', 100); // a tap: no travel, well under the 200 ms
		await tick();
		expect(centralDisplayStore.isViewActive('device', 'bass')).toBe(true);
	});

	it('rests at the floor, like every other fill tile on the grid', async () => {
		// It shipped reading 1.0 — what the Bass preset itself stores — which
		// as an ordinary coloured fill painted the whole cell solid orange at
		// rest (user, 2026-09-15). Cold read only: a slot with a device shows
		// whatever Live has.
		const { container } = render(BassControl);
		await tick();
		expect(slider(container).getAttribute('aria-valuenow')).toBe('0');
	});

	it('draws an ordinary coloured fill, not Gain\'s split handle line', async () => {
		// Gtr and Bass had borrowed GAIN's line, which reads in a grammar the
		// rest of the grid doesn't. Gain cannot do otherwise — its cell is the
		// track's meter, so its fill is spoken for — and these two can.
		const { container } = render(BassControl);
		await tick();
		expect(container.querySelector('.slider-handle-segment')).toBeNull();
		expect(container.querySelector('.slider-fill')).not.toBeNull();
	});

	it('loads the Bass preset on the first drag, not on a tap', async () => {
		const { container } = render(BassControl);
		await tick();
		const el = slider(container);

		pointer(el, 'pointerdown', 100);
		pointer(el, 'pointerup', 100);
		await tick();
		expect(loads()).toHaveLength(0);

		pointer(el, 'pointerdown', 100);
		pointer(el, 'pointermove', 60);
		pointer(el, 'pointerup', 60);
		await tick();
		expect(loads()).toHaveLength(1);
		expect((loads()[0][1] as unknown[])[2]).toBe(DEVICE_PRESETS.bass.presetPath);
		expect(selectedTrackStore.getFxGridSlot('bass').state).toBe('loading');
	});

	it('moves the loaded Bass to the head of the chain when it arrives', async () => {
		const { container } = render(BassControl);
		await tick();
		const el = slider(container);
		pointer(el, 'pointerdown', 100);
		pointer(el, 'pointermove', 60);
		pointer(el, 'pointerup', 60);
		await tick();
		expect(moves()).toHaveLength(0); // nothing to move yet — the load is async

		bassArrives();
		await tick();
		expect(moves()).toHaveLength(1);
		expect((moves()[0][1] as unknown[])[0]).toBe(BASS_PATH);
	});

	it('does not arm that move on a tap, which loads nothing', async () => {
		// A latch set by a gesture that cannot load is never spent, so it
		// would fire on the next bass device to arrive from anywhere — one
		// the user dragged into the chain by hand, in the place they meant.
		const { container } = render(BassControl);
		await tick();
		const el = slider(container);
		pointer(el, 'pointerdown', 100);
		pointer(el, 'pointerup', 100);
		await tick();

		bassArrives();
		await tick();
		expect(moves()).toHaveLength(0);
	});

	it('leaves a Bass the track already has where it is', async () => {
		bassArrives();
		fxGrid.resetForTrackChange();
		const { container } = render(BassControl);
		await tick();
		expect(selectedTrackStore.getFxGridSlot('bass').state).not.toBe('ghost');

		const el = slider(container);
		pointer(el, 'pointerdown', 100);
		pointer(el, 'pointermove', 60);
		pointer(el, 'pointerup', 60);
		await tick();
		expect(loads()).toHaveLength(0);
		expect(moves()).toHaveLength(0);
		// The drag writes the mix straight at the device it found.
		const writes = sendMock.mock.calls.filter(([addr]) => addr === '/looping/v3/param/set');
		expect(writes.length).toBeGreaterThan(0);
		expect((writes[0][1] as unknown[])[0]).toBe(`${BASS_PATH}/params/1`);
	});
});
