/**
 * deviceViewRouter — where "open this effect's view" goes (issue #491).
 *
 * No scope: the top-level device view, as sixteen tiles used to do
 * directly, and a no-op when it is already up. A pad scoped on the
 * selected track's Drum Rack: the Drum Rack view's pane, plus the Drum
 * Rack view itself when another top-level view is showing — a pane nobody
 * can see is no answer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));

import { SvelteMap } from 'svelte/reactivity';
import { openDeviceView, activeDrumRackScope, selectedDrumRack, openScopedPermutePane, PANE_PERMUTE } from '$lib/services/deviceViewRouter.svelte';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import { currentInstrumentStore } from '$lib/stores/v6/currentInstrumentStore.svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { drumPadScope } from '$lib/stores/v6/drumPadScope.svelte';
import {
	_resetForTests,
	applyPropertyValue,
	replaceTree,
	type DeviceRecord,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import type { OSCArg } from '$lib/types/osc';
import { FX_GRID_LAYOUT } from '$lib/config/fxGridLayout';
import { CENTRAL_VIEW_REGISTRY, resolveViewComponent } from '$lib/components/v6/central/viewRegistry';

const RACK = 'tracks/0/devices/0';
const INSTRUMENT = { deviceIndex: 0, className: 'DrumGroupDevice', name: 'Drum Rack', type: 'instrument' as const, devicePath: RACK };

function drums(): TrackRecord {
	const rack: DeviceRecord = { devicePath: RACK, name: 'Drum Rack', className: 'DrumGroupDevice', params: new SvelteMap(), properties: new SvelteMap<string, OSCArg>() };
	return {
		trackPath: 'tracks/0', name: 'Drums', color: 0, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: 'drum',
		devices: new SvelteMap([[RACK, rack]]), slots: new SvelteMap()
	};
}

beforeEach(() => {
	_resetForTests();
	drumPadScope.clear();
	replaceTree(3, [drums()]);
	selectedTrackStore.handleTrackSelected(0);
	currentInstrumentStore.setInstrument(INSTRUMENT, 'drumrack');
	centralDisplayStore.setView('clip');
});

describe('openDeviceView', () => {
	it('swaps the top-level view with nothing scoped, once', () => {
		openDeviceView('reverb', { device: null });
		expect(centralDisplayStore.view.type).toBe('device');
		expect(centralDisplayStore.view.subType).toBe('reverb');
		const before = centralDisplayStore.view;
		openDeviceView('reverb', { device: null });
		expect(centralDisplayStore.view).toBe(before); // already up: untouched
	});

	it('sets the pane under a scope, and brings the Drum Rack view back if another is up', () => {
		drumPadScope.press(RACK, 38, 1, 0);
		openDeviceView('reverb');
		expect(drumPadScope.pane(RACK)).toBe('reverb');
		expect(centralDisplayStore.view.type).toBe('instrument');
		expect(centralDisplayStore.view.subType).toBe('drumrack');
		// The Drum Rack view already showing: only the pane changes.
		const view = centralDisplayStore.view;
		openDeviceView('echo');
		expect(drumPadScope.pane(RACK)).toBe('echo');
		expect(centralDisplayStore.view).toBe(view);
	});

	it("opens a registered view for every grid tile's type, never the placeholder", () => {
		// Sixteen tiles used to name their view themselves and now hand the
		// router their own type; the Rand Oct tile's is `random`, which had
		// no registry entry and opened the default view (review of #491).
		const types = [...new Set([...FX_GRID_LAYOUT.map((entry) => entry.deviceType), 'squash'])];
		for (const type of types) {
			expect(resolveViewComponent('device', type), type).not.toBe(CENTRAL_VIEW_REGISTRY.default);
		}
		openDeviceView('random', { device: null });
		expect(centralDisplayStore.view.subType).toBe('random');
		drumPadScope.press(RACK, 38, 1, 0);
		openDeviceView('random');
		expect(drumPadScope.pane(RACK)).toBe('random');
	});

	it('routes to the top level when the scope is on a rack that is not the selected instrument', () => {
		drumPadScope.press('tracks/5/devices/0', 38, 1, 0);
		openDeviceView('reverb');
		expect(centralDisplayStore.view.type).toBe('device');
		expect(drumPadScope.pane('tracks/5/devices/0')).toBeNull();
	});
});

describe("openScopedPermutePane — the strip's Permute tap under a pad scope (ADR-435)", () => {
	it('answers false with nothing scoped and leaves the view alone', () => {
		const before = centralDisplayStore.view;
		expect(openScopedPermutePane()).toBe(false);
		expect(centralDisplayStore.view).toBe(before);
		expect(drumPadScope.pane(RACK)).toBeNull();
	});

	it("opens the pad's Permute as the Drum Rack view's pane under a scope, and the pane goes with the hold", () => {
		drumPadScope.press(RACK, 38, 1, 0);
		expect(openScopedPermutePane()).toBe(true);
		expect(drumPadScope.pane(RACK)).toBe(PANE_PERMUTE);
		expect(centralDisplayStore.view.type).toBe('instrument');
		expect(centralDisplayStore.view.subType).toBe('drumrack');
		// The pane type is the registry's top-level Permute view, not a device view.
		expect(resolveViewComponent(PANE_PERMUTE)).toBe(CENTRAL_VIEW_REGISTRY.permute);
		drumPadScope.release(1, 'up', 1000); // a hold: momentary, the scope and its pane go
		expect(drumPadScope.pane(RACK)).toBeNull();
	});

	it('answers false when the scope is on a rack that is not the selected instrument', () => {
		drumPadScope.press('tracks/5/devices/0', 38, 1, 0);
		expect(openScopedPermutePane()).toBe(false);
		expect(drumPadScope.pane('tracks/5/devices/0')).toBeNull();
	});
});

describe('a track change clears the scope', () => {
	it('arrives at a track unscoped even when a pad was latched, and stays unscoped coming back', () => {
		drumPadScope.press(RACK, 38, 1, 0);
		drumPadScope.release(1, 'up', 100); // a tap: latched
		expect(drumPadScope.latchedNote(RACK)).toBe(38);
		selectedTrackStore.handleTrackSelected(1);
		expect(drumPadScope.latchedNote(RACK)).toBeNull();
		expect(activeDrumRackScope()).toBeNull();
		selectedTrackStore.handleTrackSelected(0);
		expect(drumPadScope.latchedNote(RACK)).toBeNull();
		expect(activeDrumRackScope()).toBeNull();
	});
});

describe('activeDrumRackScope', () => {
	it('is null with nothing held, and names the pad with its colour and name when one is', () => {
		expect(activeDrumRackScope()).toBeNull();
		applyPropertyValue(RACK, 'vm.members', JSON.stringify({
			padCount: 1, padClasses: { DrumCell: 1 }, hasMacroMappings: false, family: false, functions: {},
			pads: [{ note: 38, name: 'Snare 2', class: 'DrumCell', color: 0x85961f }]
		}));
		drumPadScope.press(RACK, 38, 1, 0);
		expect(activeDrumRackScope()).toEqual({ rackPath: RACK, note: 38, padPath: `${RACK}/pads/38`, color: 0x85961f, name: 'Snare 2' });
		drumPadScope.press(RACK, 40, 2, 0); // an unnamed pad: still a scope
		expect(activeDrumRackScope()).toMatchObject({ note: 40, color: null, name: '' });
	});

	it('is null when the selected instrument is not a Drum Rack', () => {
		currentInstrumentStore.setInstrument({ ...INSTRUMENT, className: 'OriginalSimpler' }, 'simpler');
		drumPadScope.press(RACK, 38, 1, 0);
		expect(selectedDrumRack()).toBeNull();
		expect(activeDrumRackScope()).toBeNull();
	});
});
