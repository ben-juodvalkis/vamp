/**
 * useDrumVm — the one rule for "this function's value and state, for the
 * kit or for the held pad" (issue #491 E0), exercised on its own.
 *
 * The Drum Rack view's render tests cover the rule through the DOM; the
 * FX grid's Pitch slider and the pad pane share the hook without a test
 * of their own, so the hook's contract is pinned here directly, under an
 * `$effect.root` (code review, 2026-09-12): the scoped pad's value once
 * read and the kit's before; `none` for a held pad whose row read nil;
 * writes refused where the census says nothing can move; the pad rows
 * opened for the selected, held and on-screen pads and released with the
 * scope; and the kit rows following the device path. Runes compile only
 * in `.svelte.ts`, so the root and the movable path come from the shared
 * harness.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { flushSync } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { OSCArg } from '$lib/types/osc';
import { send } from '$lib/api/simpleClient';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import {
	replaceTree,
	applyPropertyValue,
	_resetForTests,
	type TrackRecord,
	type DeviceRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';
import { setPropertySender } from '$lib/stores/v3/propertySubscriptions.svelte';
import { drumPadScope } from '$lib/stores/v6/drumPadScope.svelte';
import { VM_FUNCTIONS } from '$lib/services/drumVirtualMacros';
import { useDrumVm, type DrumVmHandle } from '$lib/components/v6/central/useDrumVm.svelte';
import { mountRune, stateBox } from '../../helpers/runeHarness.svelte';

const sendMock = vi.mocked(send);
const propertyWire = vi.fn();
setPropertySender(propertyWire);

const RACK = 'tracks/0/devices/0';
// Pressed at t=0 and released at t=5 s: a hold, not a tap — a tap latches
// the pad (ADR-427), which is the one thing these tests must not do.

function census(functions: Record<string, { members: number; held: number }>, pads: { note: number; name: string }[] = []) {
	const fns: Record<string, { members: number; held: number }> = {};
	for (const fn of VM_FUNCTIONS) fns[fn] = functions[fn] ?? { members: 0, held: 0 };
	return JSON.stringify({
		family: false,
		functions: fns,
		hasMacroMappings: Object.values(fns).some((f) => f.held > 0),
		padClasses: { DrumCell: 24 },
		padCount: 24,
		pads: pads.map((p) => ({ ...p, class: 'DrumCell', color: 0x85961f }))
	});
}
const LIVE = { members: 24, held: 0 };
const KIT = census(
	{ pitch: LIVE, attack: LIVE, decay: LIVE, start: LIVE, fx1: LIVE, fx2: LIVE, fxType: LIVE, gain: LIVE },
	[{ note: 36, name: 'Kick' }, { note: 38, name: 'Snare' }]
);
const PITCH_HELD = census({ pitch: { members: 24, held: 24 }, decay: LIVE });

function drumTrack(devicePath = RACK): TrackRecord {
	const params = new SvelteMap<string, ParamRecord>();
	const device: DeviceRecord = {
		devicePath,
		name: 'Drum Rack',
		className: 'DrumGroupDevice',
		params,
		properties: new SvelteMap<string, OSCArg>()
	};
	return {
		trackPath: 'tracks/0',
		name: 'Drums',
		color: 0xff3636,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: 'drum',
		devices: new SvelteMap<string, DeviceRecord>([[devicePath, device]]),
		slots: new SvelteMap()
	};
}

const wire = (address: string) =>
	propertyWire.mock.calls.filter(([a]) => a === address).map(([, args]) => (args as string[]).join(' '));
const setsOf = (property: string) =>
	sendMock.mock.calls
		.filter(([address, args]) => address === '/looping/v3/property/set' && (args as OSCArg[])[1] === property)
		.map(([, args]) => (args as OSCArg[])[2]);

let dispose: (() => void) | null = null;
const path = stateBox<string | undefined>(RACK);

function mount(options: Parameters<typeof useDrumVm>[1] = {}): DrumVmHandle {
	const mounted = mountRune(() => useDrumVm(() => path.value, options));
	dispose = mounted.stop;
	flushSync();
	return mounted.handle;
}

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
	drumPadScope.clear();
	path.value = RACK;
	replaceTree(3, [drumTrack()]);
	selectedTrackStore.handleTrackSelected(0);
	applyPropertyValue(RACK, 'vm.members', KIT);
	applyPropertyValue(RACK, 'vm.decay', 0.4);
	applyPropertyValue(RACK, 'vm.pitch', 5);
	flushSync();
});
afterEach(() => {
	dispose?.();
	dispose = null;
});

describe('useDrumVm — value and state under the pad scope', () => {
	it("shows the kit's value until a pad is held and its row has been read, then the pad's own", () => {
		const vm = mount();
		expect(vm.value('decay')).toBe(0.4);
		expect(vm.scopeNote).toBeNull();
		drumPadScope.press(RACK, 38, 1, 0);
		flushSync();
		expect(vm.scopeNote).toBe(38);
		expect(vm.scopedPad?.name).toBe('Snare');
		expect(vm.value('decay')).toBe(0.4); // the row has not landed: the kit's
		applyPropertyValue(RACK, 'vm.pad.38.decay', 0.9);
		flushSync();
		expect(vm.value('decay')).toBe(0.9);
		drumPadScope.release(1, 'up', 5_000);
		flushSync();
		expect(vm.value('decay')).toBe(0.4);
	});

	it("reads `none` for a held pad whose row read nil, and the census's state otherwise", () => {
		const vm = mount();
		expect(vm.state('decay')).toBe('live');
		drumPadScope.press(RACK, 38, 1, 0);
		applyPropertyValue(RACK, 'vm.pad.38.decay', null as unknown as OSCArg); // the wire's nil
		flushSync();
		expect(vm.state('decay')).toBe('none');
		expect(vm.value('decay')).toBe(0.4); // nothing of the pad's to show; the kit's number stays
		drumPadScope.release(1, 'up', 5_000);
		flushSync();
		expect(vm.state('decay')).toBe('live');
	});

	it('writes the kit row when nothing is held, the held pad absolutely when one is', () => {
		const vm = mount();
		vm.write('decay', 0.7);
		expect(setsOf('vm.decay')).toEqual([0.7]);
		drumPadScope.press(RACK, 38, 1, 0);
		applyPropertyValue(RACK, 'vm.pad.38.decay', 0.2);
		flushSync();
		vm.write('decay', 0.6);
		expect(setsOf('vm.decay')).toEqual([0.7]); // the kit row untouched
		expect(setsOf('vm.pad.38.decay')).toEqual([0.6]);
	});

	it('refuses a write the census says can move nothing — held everywhere or absent', () => {
		applyPropertyValue(RACK, 'vm.members', PITCH_HELD);
		flushSync();
		const vm = mount();
		expect(vm.state('pitch')).toBe('held');
		expect(vm.state('fx1')).toBe('none');
		vm.write('pitch', 12);
		vm.write('fx1', 0.5);
		vm.write('decay', 0.3);
		expect(setsOf('vm.pitch')).toEqual([]);
		expect(setsOf('vm.fx1')).toEqual([]);
		expect(setsOf('vm.decay')).toEqual([0.3]);
	});
});

describe('useDrumVm — the rows it opens', () => {
	it('opens the kit rows for the device path and moves them when the path changes', () => {
		mount({ kitFunctions: ['pitch'] });
		expect(wire('/looping/v3/property/subscribe')).toEqual([
			`${RACK} vm.pitch`,
			`${RACK} vm.members`,
			`${RACK} vm.selectedPad`
		]);
		path.value = 'tracks/0/devices/1';
		flushSync();
		expect(wire('/looping/v3/property/unsubscribe')).toEqual([
			`${RACK} vm.pitch`,
			`${RACK} vm.members`,
			`${RACK} vm.selectedPad`
		]);
		expect(wire('/looping/v3/property/subscribe').slice(3)).toEqual([
			'tracks/0/devices/1 vm.pitch',
			'tracks/0/devices/1 vm.members',
			'tracks/0/devices/1 vm.selectedPad'
		]);
	});

	it("opens the pad rows for the held pad and the caller's on-screen pads, for the functions it draws, and lets them go with the hold", () => {
		mount({ kitFunctions: ['pitch'], functions: () => ['pitch'], padNotes: () => [36] });
		expect(wire('/looping/v3/property/subscribe')).toContain(`${RACK} vm.pad.36.pitch`);
		drumPadScope.press(RACK, 38, 1, 0);
		flushSync();
		expect(wire('/looping/v3/property/subscribe').filter((s) => s.includes('vm.pad.'))).toEqual([
			`${RACK} vm.pad.36.pitch`,
			`${RACK} vm.pad.36.pitch`,
			`${RACK} vm.pad.38.pitch`
		]);
		expect(wire('/looping/v3/property/unsubscribe')).toEqual([`${RACK} vm.pad.36.pitch`]); // re-keyed, refcount kept it open
		drumPadScope.release(1, 'up', 5_000);
		flushSync();
		expect(wire('/looping/v3/property/unsubscribe').filter((s) => s.includes('38'))).toEqual([`${RACK} vm.pad.38.pitch`]);
	});

	it("opens Live's selected pad's rows, so a hold has its values the instant the finger lands", () => {
		mount({ kitFunctions: ['pitch'], functions: () => ['pitch', 'decay'] });
		applyPropertyValue(RACK, 'vm.selectedPad', 40);
		flushSync();
		expect(wire('/looping/v3/property/subscribe').filter((s) => s.includes('vm.pad.'))).toEqual([
			`${RACK} vm.pad.40.pitch`,
			`${RACK} vm.pad.40.decay`
		]);
	});
});
