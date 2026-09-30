/**
 * DrumRackCentralView — mode and control states from the `vm.members`
 * census (ADR-428, Milestone 1b).
 *
 * The first component render test in the suite. It mounts the real view
 * against the real v3 store and asserts the three things the milestone
 * added, which a pure test of `drumVirtualMacros.ts` cannot see:
 *
 * 1. PROFILE — a plugin-pad census swaps the seven controls for the macro
 *    grid; a DrumCell census (and no census) shows the seven controls; a
 *    Simpler or Sampler census shows the kit-class card and Trnsp only.
 * 2. STATES — a function with no member renders dimmed (`vm-none`), one
 *    every member of which is held renders read-only with the "macro"
 *    badge (`vm-held`), a partially held one stays live with the count;
 *    no census renders everything live (the Milestone 1 picture).
 * 3. WRITES — a held or absent function sends nothing; a live one writes
 *    `property/set`.
 * 4. RACK MACROS (2026-09-07) — a nested-rack census lays the kit out as
 *    one control per pad-rack macro name (Pitch Attack + Pitch Amount
 *    paired), subscribes `vm.macro.<name>` per name and releases them when
 *    the kit changes, holds a macro-held name read-only, badges a name
 *    only some pads carry, and a slider drag writes `vm.macro.<name>`.
 *
 * The census changes are applied through `applyPropertyValue`, the same
 * path the `property/value` handler uses, so the view is exercised the
 * way the wire drives it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({
	send: vi.fn()
}));

vi.mock('$lib/services/clipNotesService', () => ({
	requestNotes: vi.fn(() => Promise.resolve([])),
	subscribeNotesChanged: vi.fn(() => () => {})
}));

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { OSCArg } from '$lib/types/osc';
import { send } from '$lib/api/simpleClient';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import {
	replaceTree,
	applyPropertyValue,
	mergePadChain,
	_resetForTests,
	type TrackRecord,
	type DeviceRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';
import { setPropertySender } from '$lib/stores/v3/propertySubscriptions.svelte';
import { uiPrefsStore } from '$lib/stores/v6/uiPrefsStore.svelte';
import { drumPadScope } from '$lib/stores/v6/drumPadScope.svelte';
import { VM_FUNCTIONS, PAD_FLASH_MS } from '$lib/services/drumVirtualMacros';
import { requestNotes } from '$lib/services/clipNotesService';
import {
	applyPlayingSlot,
	applyPlayhead,
	__resetPlayingClipsStoreForTests
} from '$lib/stores/v6/playingClipsStore.svelte';
import DrumRackCentralView from '$lib/components/v6/central/views/DrumRackCentralView.svelte';

const sendMock = send as unknown as ReturnType<typeof vi.fn>;
// The subscription manager writes through a sender simpleClient wires at
// app start, not through `send` directly — give it one we can read.
const propertyWire = vi.fn();
setPropertySender(propertyWire);

const GENERATION = 3;
const DEVICE = 'tracks/0/devices/0';

beforeEach(() => {
	uiPrefsStore.showFxGrid = false;
	drumPadScope.clear();
	mockClock();
});
const INSTRUMENT = {
	deviceIndex: 0,
	className: 'DrumGroupDevice',
	name: 'Drum Rack',
	type: 'instrument' as const,
	devicePath: DEVICE
};

// `held` is a pad's own macro holding a parameter; the Drum Rack's own
// macros are unmapped unless `mappedMacros` names some.
function census(
	padClasses: Record<string, number>,
	functions: Record<string, { members: number; held: number }>,
	mappedMacros: number[] = []
) {
	const fns: Record<string, { members: number; held: number }> = {};
	for (const fn of VM_FUNCTIONS) fns[fn] = functions[fn] ?? { members: 0, held: 0 };
	return JSON.stringify({
		family: false,
		functions: fns,
		hasMacroMappings: mappedMacros.length > 0,
		mappedMacros,
		padClasses,
		padCount: Object.values(padClasses).reduce((a, b) => a + b, 0)
	});
}

const LIVE_24 = { members: 24, held: 0 };
const DRUMCELL = census({ DrumCell: 24 }, Object.fromEntries(VM_FUNCTIONS.map((fn) => [fn, LIVE_24])));
const JAZZ = census(
	{ OriginalSimpler: 31, MultiSampler: 1 },
	{
		pitch: { members: 32, held: 32 },
		attack: { members: 32, held: 0 },
		decay: { members: 32, held: 0 },
		start: { members: 31, held: 0 },
		gain: { members: 32, held: 0 }
	}
);
const KOMPLETE = census({ AuPluginDevice: 16 }, {}, [1, 2]);
// `Ethnic Drums` as the rig reads it: every pad a nested Instrument Rack
// with seven named macros; pitch binds through Transpose (live), Room on
// 20 of the 32 pads only. Release is held here to exercise the badge.
const ETHNIC_MACROS = [
	{ name: 'Attack', members: 32, held: 0 },
	{ name: 'Release', members: 32, held: 32 },
	{ name: 'Transpose', members: 32, held: 0 },
	{ name: 'Osc', members: 32, held: 0 },
	{ name: 'Pitch Attack', members: 32, held: 0 },
	{ name: 'Pitch Amount', members: 32, held: 0 },
	{ name: 'Room', members: 20, held: 0 }
];
const ETHNIC = JSON.stringify({
	// Gain on a nested-rack kit is every pad's own CHAIN volume, so it is
	// live where every fixed function but pitch is absent (2026-09-08).
	...JSON.parse(census({ InstrumentGroupDevice: 32 }, {
		pitch: { members: 32, held: 0 },
		gain: { members: 32, held: 0 }
	})),
	macros: ETHNIC_MACROS,
	pitchMacro: 'Transpose'
});
const ETHNIC_VALUES = {
	'vm.members': ETHNIC,
	'vm.pitch': -7,
	'vm.macro.Attack': 0.18,
	'vm.macro.Release': 0.55,
	'vm.macro.Transpose': 0.5,
	'vm.macro.Osc': 0.72,
	'vm.macro.Pitch Attack': 0.35,
	'vm.macro.Pitch Amount': 0.64,
	'vm.macro.Room': 0.4
};
// Every section on, as on the rig's `50s Autumn Brushes`: the switch and
// the amount both count, so an amount function reads 64 members.
const SAMPLER_ROW_LIVE = {
	pitch: { members: 32, held: 0 },
	attack: { members: 32, held: 0 },
	decay: { members: 32, held: 0 },
	release: { members: 32, held: 0 },
	sustain: { members: 32, held: 0 },
	oscAmount: { members: 64, held: 0 },
	oscCoarse: { members: 32, held: 0 },
	pitchEnvAmount: { members: 64, held: 0 },
	pitchEnvAttack: { members: 32, held: 0 },
	spread: { members: 32, held: 0 },
	gain: { members: 32, held: 0 },
	filterFreq: { members: 64, held: 0 }, // the switch and the amount, like oscAmount
	filterRes: { members: 32, held: 0 }
};
const AUTUMN_UNMAPPED = census({ MultiSampler: 32 }, SAMPLER_ROW_LIVE);
// The Autumn kit still mapped the Abbey Road way: its Release macro holds
// every pad's Ve Release, Transpose is free.
const AUTUMN_RELEASE_HELD = census({ MultiSampler: 32 }, { ...SAMPLER_ROW_LIVE, release: { members: 32, held: 32 } });
// A DrumCell-dominant census with functions missing and held, to exercise
// the full layout's dimmed and read-only renderings without a Simpler kit.
const CELL_MIXED_STATES = census(
	{ DrumCell: 24 },
	{
		pitch: { members: 24, held: 24 },
		attack: LIVE_24,
		decay: LIVE_24,
		start: LIVE_24,
		gain: LIVE_24
	}
);
// The mapped Jazz kit as the rig reads it: Live's Transpose macro maps the
// 31 Simplers and leaves the Sampler pad free.
const JAZZ_RIG = census(
	{ OriginalSimpler: 31, MultiSampler: 1 },
	{
		pitch: { members: 32, held: 31 },
		attack: { members: 32, held: 0 },
		decay: { members: 32, held: 0 },
		start: { members: 31, held: 0 },
		gain: { members: 32, held: 0 }
	}
);

function drumTrack(properties: Record<string, OSCArg>): TrackRecord {
	const params = new SvelteMap<string, ParamRecord>();
	['Device On', 'FX1', 'FX2', 'Macro 3'].forEach((name, i) => {
		const paramPath = `${DEVICE}/params/${i}`;
		params.set(paramPath, { paramPath, name, displayName: name, min: 0, max: 127, value: 0, unit: '' });
	});
	const device: DeviceRecord = {
		devicePath: DEVICE,
		name: 'Drum Rack',
		className: 'DrumGroupDevice',
		params,
		properties: new SvelteMap<string, OSCArg>(Object.entries(properties))
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
		// Protocol 3.7.0: the persisted rail; nothing recorded.
		role: '',
		devices: new SvelteMap<string, DeviceRecord>([[DEVICE, device]]),
		slots: new SvelteMap()
	};
}

function seed(properties: Record<string, OSCArg>) {
	replaceTree(GENERATION, [drumTrack(properties)]);
	selectedTrackStore.handleTrackSelected(0);
}

function stateOf(container: HTMLElement, title: string): string | null {
	// Every control sits in a `.vm-slot` carrying its state; find it by the
	// control's own label (the slider / pad title).
	const labels = Array.from(container.querySelectorAll('.vm-slot'));
	for (const slot of labels) {
		if (slot.textContent?.includes(title)) return slot.getAttribute('data-vm-state');
	}
	return null;
}

async function setCensus(value: string) {
	applyPropertyValue(DEVICE, 'vm.members', value);
	await tick();
}

describe('DrumRackCentralView — mode from the census', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
	});
	afterEach(() => cleanup());

	it('shows the virtual-macro controls before any census arrives (Milestone 1 picture)', async () => {
		seed({ 'vm.pitch': 0 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		const root = container.querySelector('[data-vm-mode]');
		expect(root?.getAttribute('data-vm-mode')).toBe('full');
		expect(container.querySelectorAll('.vm-slot')).toHaveLength(6); // FX, Time, Start, Trnsp, Filter, Gain
		for (const slot of Array.from(container.querySelectorAll('.vm-slot'))) {
			expect(slot.getAttribute('data-vm-state')).toBe('unknown');
			expect(slot.classList.contains('vm-none')).toBe(false);
			expect(slot.classList.contains('vm-held')).toBe(false);
		}
		expect(container.querySelector('.vm-held-badge')).toBeNull();
	});

	it('swaps to the macro grid when the pads are plugin-hosted, and back when they are not', async () => {
		seed({ 'vm.members': KOMPLETE });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(container.querySelector('[data-vm-mode]')?.getAttribute('data-vm-mode')).toBe('macro-grid');
		expect(container.querySelectorAll('.vm-slot')).toHaveLength(0);
		// The macro grid draws the rack's mapped macros: FX1 and FX2.
		expect(container.querySelectorAll('.device-slider')).toHaveLength(2);

		await setCensus(DRUMCELL);
		expect(container.querySelector('[data-vm-mode]')?.getAttribute('data-vm-mode')).toBe('full');
		expect(container.querySelectorAll('.vm-slot')).toHaveLength(6);
	});

	it('shows a slider for each mapped macro of the rack and nothing else, whatever the macro is named', async () => {
		seed({ 'vm.members': census({ DrumCell: 24 }, Object.fromEntries(VM_FUNCTIONS.map((fn) => [fn, LIVE_24])), [1, 3]) });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(container.querySelector('[data-vm-mode]')?.getAttribute('data-vm-mode')).toBe('macro-grid');
		// No virtual-macro controls: no Gain, Trnsp, FX or Filter.
		expect(container.querySelectorAll('.vm-slot')).toHaveLength(0);
		const titles = Array.from(container.querySelectorAll('.device-slider')).map((el) => el.textContent?.trim());
		expect(titles).toHaveLength(2);
		expect(titles[0]).toContain('FX1');
		expect(titles[1]).toContain('Macro 3'); // mapped but never renamed: still drawn

		// Unmapped in Live: the census re-emits and the kit's own controls return.
		await setCensus(DRUMCELL);
		expect(container.querySelector('[data-vm-mode]')?.getAttribute('data-vm-mode')).toBe('full');
	});

	it('shows an Operator kit its class and Trnsp only, a Simpler kit the Simpler row, and a Sampler kit the Sampler row', async () => {
		seed({ 'vm.members': census({ Operator: 4 }, { pitch: { members: 0, held: 0 } }), 'vm.pitch': 0 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(container.querySelector('[data-vm-mode]')?.getAttribute('data-vm-mode')).toBe('pitch-only');
		expect(container.querySelector('.vm-kit-class')?.textContent).toBe('Operator');
		expect(container.querySelector('.vm-kit-detail')?.textContent).toBe('4 pads');
		// Gain, Trnsp and Filter: an Operator kit binds neither Gain nor
		// Filter, so they are there but ghosted — the posture of any absent
		// function.
		const slots = Array.from(container.querySelectorAll('.vm-slot'));
		expect(slots).toHaveLength(3);
		expect(slots[0].getAttribute('data-vm-function')).toBe('gain');
		expect(slots[0].getAttribute('data-vm-state')).toBe('none');
		expect(slots[1].textContent).toContain('Trnsp');
		expect(slots[2].getAttribute('data-vm-function')).toBe('filterFreq|filterRes');
		expect(slots[2].getAttribute('data-vm-state')).toBe('none');
		expect(container.querySelectorAll('.vm-controls button')).toHaveLength(0); // no FX type grid

		await setCensus(JAZZ);
		expect(container.querySelector('[data-vm-mode]')?.getAttribute('data-vm-mode')).toBe('simpler');
		expect(container.querySelector('.vm-kit-card')).toBeNull();
		expect(Array.from(container.querySelectorAll('.vm-slot')).map((s) => s.getAttribute('data-vm-function'))).toEqual([
			'gain',
			'pitch',
			'attack|release',
			'filterFreq|filterRes'
		]);
		expect(stateOf(container, 'Trnsp')).toBe('held'); // the shipped Jazz kit's Transpose macro

		await setCensus(AUTUMN_UNMAPPED);
		expect(container.querySelector('[data-vm-mode]')?.getAttribute('data-vm-mode')).toBe('sampler');
		expect(container.querySelector('.vm-kit-card')).toBeNull();
		expect(container.querySelectorAll('.vm-slot')).toHaveLength(8); // the Sampler row on a kit: Gain, Osc, Pitch, A, R, Spread, Trnsp, Filter
		expect(stateOf(container, 'A')).toBe('live');
		expect(stateOf(container, 'R')).toBe('live');
		expect(stateOf(container, 'Trnsp')).toBe('live');
	});

	it('subscribes the seven functions and the census for the device', async () => {
		seed({});
		render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		const subscribed = propertyWire.mock.calls
			.filter(([addr]) => addr === '/looping/v3/property/subscribe')
			.map(([, args]) => (args as string[])[1]);
		expect(subscribed.sort()).toEqual(
			[
				'vm.attack',
				'vm.decay',
				'vm.fx1',
				'vm.fx2',
				'vm.filterFreq',
				'vm.filterRes',
				'vm.fxType',
				'vm.gain',
				'vm.members',
				'vm.oscAmount',
				'vm.oscCoarse',
				// Effect presence per pad (issue #491): what the FX grid flips its
				// tiles on at touch-down, opened here so the pane works with the
				// grid section off.
				'vm.padFx',
				'vm.pitch',
				'vm.pitchEnvAmount',
				'vm.pitchEnvAttack',
				'vm.release',
				'vm.selectedPad',
				'vm.spread',
				'vm.start',
				'vm.sustain'
			].sort()
		);
	});
});

describe('DrumRackCentralView — control states on the Jazz kit', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
	});
	afterEach(() => cleanup());

	it('holds Trnsp read-only on the Jazz kit as shipped', async () => {
		seed({ 'vm.members': JAZZ, 'vm.pitch': 0 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(stateOf(container, 'Trnsp')).toBe('held');
		const held = container.querySelector('[data-vm-function="pitch"].vm-held');
		expect(held?.querySelector('.vm-held-badge')?.textContent?.trim()).toBe('macro');
		expect(held?.querySelector('.ghost')).toBeNull();
	});

	it('dims a function with no member and holds a fully held one in the full layout', async () => {
		seed({ 'vm.members': CELL_MIXED_STATES, 'vm.pitch': 0, 'vm.start': 0.1, 'vm.attack': 0.2, 'vm.decay': 0.6 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();

		expect(container.querySelector('.fx-type-button')?.getAttribute('data-vm-state')).toBe('none'); // the FX-type button
		expect(stateOf(container, 'Time')).toBe('live');
		expect(stateOf(container, 'Start')).toBe('live');
		expect(stateOf(container, 'Trnsp')).toBe('held');

		const none = Array.from(container.querySelectorAll('.vm-slot.vm-none'));
		expect(none).toHaveLength(2); // the FX XY and Filter; the type button ghosts itself, and this census binds gain
		const held = Array.from(container.querySelectorAll('.vm-slot.vm-held'));
		expect(held).toHaveLength(1);
		expect(held[0].textContent).toContain('Trnsp');
		expect(held[0].querySelector('.vm-held-badge')?.getAttribute('aria-label')).toBe('held by macro');
		expect(held[0].querySelector('.vm-held-badge')?.textContent?.trim()).toBe('macro');
		// A dimmed slot ghosts its control; a held one keeps the ink (no ghost).
		expect(none.every((slot) => slot.querySelector('.ghost') !== null || slot.querySelector('button') !== null)).toBe(true);
		expect(held[0].querySelector('.ghost')).toBeNull();
	});

	it('keeps a partially held Trnsp live and says how many pads sit still (31/32)', async () => {
		seed({ 'vm.members': JAZZ_RIG, 'vm.pitch': 0 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(stateOf(container, 'Trnsp')).toBe('live');
		expect(container.querySelectorAll('.vm-slot.vm-held')).toHaveLength(0);
		const badge = container.querySelector('.vm-held-badge');
		expect(badge?.textContent?.trim()).toBe('31/32 macro');
		expect(badge?.closest('.vm-slot')?.textContent).toContain('Trnsp');
	});

	it('un-dims when the surface re-emits a census with the kit unmapped', async () => {
		seed({ 'vm.members': JAZZ });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(stateOf(container, 'Trnsp')).toBe('held');

		await setCensus(
			census(
				{ OriginalSimpler: 31, MultiSampler: 1 },
				{
					pitch: { members: 32, held: 0 },
					attack: { members: 32, held: 0 },
					decay: { members: 32, held: 0 },
					start: { members: 31, held: 0 }
				}
			)
		);
		expect(stateOf(container, 'Trnsp')).toBe('live');
		expect(container.querySelector('.vm-held-badge')).toBeNull();
		expect(stateOf(container, 'Stretch')).toBeNull(); // a Simpler kit has no FX controls at all
	});

	it('draws the Simpler row on a Simpler kit: the Time pad (Attack across, Release up) and Trnsp', async () => {
		// `Acuff Kit`: 16 Simplers, unmapped.
		const acuff = census(
			{ OriginalSimpler: 16 },
			{
				pitch: { members: 16, held: 0 },
				attack: { members: 16, held: 0 },
				release: { members: 16, held: 0 },
				decay: { members: 16, held: 0 },
				start: { members: 16, held: 0 },
				gain: { members: 16, held: 0 },
				filterFreq: { members: 32, held: 0 }, // the switch and the amount
				filterRes: { members: 16, held: 0 }
			}
		);
		seed({ 'vm.members': acuff, 'vm.attack': 0.2, 'vm.release': 0.8, 'vm.pitch': -5 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(container.querySelector('[data-vm-mode]')?.getAttribute('data-vm-mode')).toBe('simpler');
		expect(container.querySelectorAll('.vm-slot')).toHaveLength(4); // Time, Trnsp, Filter, Gain
		expect(slider(container, 'Time').getAttribute('aria-label')).toBe('Time: X 20%, Y 80%'); // Attack across, Release up
		expect(slider(container, 'Trnsp').getAttribute('aria-valuenow')).toBe('-5');
		expect(container.querySelectorAll('.vm-controls button')).toHaveLength(0);
		for (const slot of Array.from(container.querySelectorAll('.vm-slot'))) {
			expect(slot.getAttribute('data-vm-state')).toBe('live');
		}
	});
});

describe('DrumRackCentralView — writes follow the states', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
	});
	afterEach(() => cleanup());

	function propertySets() {
		return sendMock.mock.calls
			.filter(([addr]) => addr === '/looping/v3/property/set')
			.map(([, args]) => args);
	}

	it('the FX type is one round button naming the current type; its picker writes vm.fxType and closes; a kit without the function ghosts it', async () => {
		seed({ 'vm.members': DRUMCELL, 'vm.fxType': 0 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		const button = container.querySelector<HTMLButtonElement>('.fx-type-button')!;
		expect(button.textContent?.trim()).toBe('Stretch');
		expect(container.querySelector('.fx-type-picker')).toBeNull();
		expect(container.querySelectorAll('.vm-controls .physical-button')).toHaveLength(1); // no 3×3 grid in the row
		tap(button);
		await tick();
		const picker = container.querySelector('.fx-type-picker')!;
		expect(picker).not.toBeNull();
		const options = Array.from(picker.querySelectorAll<HTMLButtonElement>('.fx-type-option'));
		expect(options.map((o) => o.textContent?.trim())).toEqual(['Stretch', 'Loop', 'Pitch', 'Punch', '8-Bit', 'FM', 'Ring', 'Sub', 'Noise']);
		tap(options[3]);
		await tick();
		expect(propertySets()).toEqual([[DEVICE, 'vm.fxType', 3, GENERATION]]);
		expect(container.querySelector('.fx-type-picker')).toBeNull(); // a choice closes it
		expect(button.textContent?.trim()).toBe('Punch'); // the optimistic write shows at once
		// The scrim closes it without a write.
		tap(button);
		await tick();
		tap(container.querySelector('.fx-type-scrim')); // the press-catcher behind the grid
		await tick();
		expect(container.querySelector('.fx-type-picker')).toBeNull();
		expect(propertySets()).toHaveLength(1);

		await setCensus(CELL_MIXED_STATES);
		expect(button.getAttribute('aria-disabled')).toBe('true');
		expect(button.classList.contains('fx-type-none')).toBe(true);
		tap(button);
		await tick();
		expect(container.querySelector('.fx-type-picker')).toBeNull(); // no member: nothing to pick
		expect(propertySets()).toHaveLength(1);
	});
});

// --- rack macros: a kit of nested Instrument Racks (2026-09-07) -------------

function slider(container: HTMLElement, title: string): HTMLElement {
	const el = Array.from(container.querySelectorAll<HTMLElement>('[role="slider"]')).find((s) =>
		s.getAttribute('aria-label')?.startsWith(`${title}:`)
	);
	if (!el) throw new Error(`no slider titled ${title}`);
	return el;
}

// DeviceSlider drags are relative to the pointer-down position, in
// fractions of the slider's box; jsdom has no layout, so give it one.
const SLIDER_HEIGHT = 200;

function pointer(el: HTMLElement, type: string, clientY: number) {
	const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY });
	Object.defineProperty(ev, 'pointerId', { value: 1 });
	el.dispatchEvent(ev);
}

function drag(el: HTMLElement, fromY: number, toY: number) {
	pointer(el, 'pointerdown', fromY);
	pointer(el, 'pointermove', toY);
	pointer(el, 'pointerup', toY);
}

/**
 * A tap on a `use:press` control (ADR-427): down and up under one pointer,
 * as a finger on the glass — `.click()` reaches an `onclick` and nothing
 * else, and these controls have none since 2026-09-12 (the picker and the
 * pane are worked with a pad held under another finger).
 */
function tap(el: Element | null | undefined) {
	if (!el) throw new Error('nothing to tap');
	pointer(el as HTMLElement, 'pointerdown', 10);
	pointer(el as HTMLElement, 'pointerup', 10);
}

function propertyWireCalls(address: string): string[] {
	return propertyWire.mock.calls.filter(([addr]) => addr === address).map(([, args]) => (args as string[])[1]);
}

describe('DrumRackCentralView — rack macros on a nested-rack kit', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
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

	it('lays the kit out as one slider per macro name, Trnsp in the transpose macro\'s place', async () => {
		seed(ETHNIC_VALUES);
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(container.querySelector('[data-vm-mode]')?.getAttribute('data-vm-mode')).toBe('rack-macros');
		const slots = Array.from(container.querySelectorAll('.vm-slot'));
		expect(slots.map((s) => s.getAttribute('data-vm-macro'))).toEqual([
			null, // Gain — the pads' chain volumes, outside the macro row
			null, // Trnsp — first, beside Gain, as on every kit
			'Attack',
			'Release',
			'Osc',
			'Pitch Attack',
			'Pitch Amount',
			'Room',
			null // Filter — no member on a nested-rack kit, so ghosted
		]);
		expect(container.querySelectorAll('.device-slider')).toHaveLength(8); // six macros + Trnsp + Gain
		expect(container.querySelector('[data-vm-function="pitch"]')?.textContent).toContain('Trnsp');
		expect(stateOf(container, 'Trnsp')).toBe('live');
		expect(slider(container, 'Trnsp').getAttribute('aria-valuenow')).toBe('-7');
		expect(container.querySelector('.vm-kit-card')).toBeNull();
		expect(container.querySelectorAll('.vm-controls button')).toHaveLength(0); // no FX type grid
		// Values arrive as t and paint as they are.
		expect(slider(container, 'Attack').getAttribute('aria-valuenow')).toBe('0.18');
	});

	it('leaves Trnsp out when the racks carry no transpose-named macro', async () => {
		seed({ 'vm.members': JSON.stringify({ ...JSON.parse(ETHNIC), pitchMacro: null }) });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(container.querySelector('[data-vm-function="pitch"]')).toBeNull();
		expect(Array.from(container.querySelectorAll('.vm-slot')).map((s) => s.getAttribute('data-vm-macro'))).toContain('Transpose');
	});

	it('holds a macro-held name read-only and says how many pads a partial name reaches', async () => {
		seed(ETHNIC_VALUES);
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(stateOf(container, 'Release')).toBe('held');
		expect(stateOf(container, 'Attack')).toBe('live');
		expect(stateOf(container, 'Room')).toBe('live');
		expect(stateOf(container, 'Pitch Amount')).toBe('live');
		const held = container.querySelector('.vm-slot.vm-held');
		expect(held?.getAttribute('data-vm-macro')).toBe('Release');
		expect(held?.querySelector('.vm-held-badge')?.textContent?.trim()).toBe('macro');
		const room = container.querySelector('[data-vm-macro="Room"]');
		expect(room?.querySelector('.vm-coverage-badge')?.textContent?.trim()).toBe('20/32 pads');
		expect(room?.querySelector('.vm-coverage-badge')?.getAttribute('aria-label')).toBe('pads reached');
		expect(container.querySelectorAll('.vm-coverage-badge')).toHaveLength(1);
		expect(container.querySelectorAll('.vm-slot.vm-none')).toHaveLength(1); // Filter: a nested-rack kit binds none
	});

	it('subscribes vm.macro.<name> per name once the census lands, and releases them when the kit changes', async () => {
		seed({});
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		const macroSubs = () => propertyWireCalls('/looping/v3/property/subscribe').filter((n) => n.startsWith('vm.macro.'));
		expect(macroSubs()).toEqual([]);

		await setCensus(ETHNIC);
		expect(container.querySelector('[data-vm-mode]')?.getAttribute('data-vm-mode')).toBe('rack-macros');
		expect(macroSubs().sort()).toEqual(ETHNIC_MACROS.map((m) => `vm.macro.${m.name}`).sort());

		await setCensus(DRUMCELL);
		expect(container.querySelector('[data-vm-mode]')?.getAttribute('data-vm-mode')).toBe('full');
		const released = propertyWireCalls('/looping/v3/property/unsubscribe').filter((n) => n.startsWith('vm.macro.'));
		expect(released.sort()).toEqual(ETHNIC_MACROS.map((m) => `vm.macro.${m.name}`).sort());
	});

	it('a slider drag writes vm.macro.<name> as t, and a held name writes nothing', async () => {
		seed(ETHNIC_VALUES);
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		const sets = () =>
			sendMock.mock.calls.filter(([addr]) => addr === '/looping/v3/property/set').map(([, args]) => args as unknown[]);

		// Half the slider's height upward: +0.5 on top of 0.18.
		drag(slider(container, 'Attack'), 150, 50);
		const last = sets().at(-1)!;
		expect(last[0]).toBe(DEVICE);
		expect(last[1]).toBe('vm.macro.Attack');
		expect(last[2] as number).toBeCloseTo(0.68, 5);
		expect(last[3]).toBe(GENERATION);

		const before = sets().length;
		drag(slider(container, 'Release'), 150, 50);
		expect(sets()).toHaveLength(before); // held everywhere: refused in the view

		// Trnsp writes vm.pitch in whole semitones, like every other profile.
		drag(slider(container, 'Trnsp'), 150, 50);
		const pitch = sets().at(-1)!;
		expect(pitch[1]).toBe('vm.pitch');
		expect(Number.isInteger(pitch[2])).toBe(true);
		expect(pitch[2]).toBeGreaterThan(-7);
	});
});

// --- the Sampler row on a Sampler kit (2026-09-07) ---------------------------

describe('DrumRackCentralView — the Sampler row on a Sampler kit', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
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

	it('draws the Sampler row on a kit: Osc and Pitch pads, the A/R envelope card, Spread, Trnsp — Decay and Sustain hidden', async () => {
		seed({
			'vm.members': AUTUMN_UNMAPPED,
			'vm.oscAmount': 0.3,
			'vm.oscCoarse': 0.06,
			'vm.pitchEnvAmount': 0.75,
			'vm.pitchEnvAttack': 0.72,
			'vm.attack': 0.2,
			'vm.release': 0.66,
			'vm.decay': 0.58,
			'vm.sustain': 1,
			'vm.spread': 0.25,
			'vm.pitch': 3
		});
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		// DOM order; the lead grid draws them Gain · Trnsp · Spread · Osc /
		// Pitch · A R · Filter, on the DrumCell kit's cells.
		expect(Array.from(container.querySelectorAll('.vm-slot')).map((s) => s.getAttribute('data-vm-function'))).toEqual([
			'gain',
			'oscAmount|oscCoarse',
			'pitchEnvAmount|pitchEnvAttack',
			'attack',
			'release',
			'spread',
			'pitch',
			'filterFreq|filterRes'
		]);
		// Every pad: the amount up, the time or tune across.
		expect(slider(container, 'Osc').getAttribute('aria-label')).toBe('Osc: X 6%, Y 30%');
		expect(slider(container, 'Pitch').getAttribute('aria-label')).toBe('Pitch: X 72%, Y 75%');
		// The amp envelope is a card of one-letter sliders since 2026-09-12.
		expect(container.querySelector('[data-envelope-group]')).not.toBeNull();
		expect(slider(container, 'A').getAttribute('aria-valuenow')).toBe('0.2');
		expect(slider(container, 'R').getAttribute('aria-valuenow')).toBe('0.66');
		// Decay and Sustain are hidden on a kit (user's call, 2026-09-08); the single-Sampler view keeps them.
		expect(container.querySelector('[data-vm-function="decay"]')).toBeNull();
		expect(container.querySelector('[data-vm-function="sustain"]')).toBeNull();
		expect(slider(container, 'Spread').getAttribute('aria-valuenow')).toBe('0.25');
		expect(slider(container, 'Trnsp').getAttribute('aria-valuenow')).toBe('3');
		expect(container.querySelectorAll('.midi-wheel')).toHaveLength(0); // a kit is not played with the wheels
		expect(container.querySelectorAll('.vm-controls button')).toHaveLength(0); // no FX type grid
		for (const slot of Array.from(container.querySelectorAll('.vm-slot'))) {
			expect(slot.getAttribute('data-vm-state')).toBe('live');
		}
	});

	it('dims the controls a DrumCell-shaped census has no member for', async () => {
		// A Sampler kit whose census says the oscillator section has no member on any pad.
		seed({
			'vm.members': census(
				{ MultiSampler: 32 },
				{ pitch: { members: 32, held: 0 }, attack: { members: 32, held: 0 }, release: { members: 32, held: 0 } }
			)
		});
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(container.querySelector('[data-vm-function="oscAmount|oscCoarse"]')?.getAttribute('data-vm-state')).toBe('none');
		expect(container.querySelector('[data-vm-function="spread"]')?.getAttribute('data-vm-state')).toBe('none');
		expect(container.querySelector('[data-vm-function="attack"]')?.getAttribute('data-vm-state')).toBe('live');
		expect(container.querySelector('[data-vm-function="release"]')?.getAttribute('data-vm-state')).toBe('live');
	});

	it('holds the Release slider on a kit whose Release macro maps every pad, and leaves Attack alone', async () => {
		seed({ 'vm.members': AUTUMN_RELEASE_HELD, 'vm.attack': 0.2, 'vm.release': 0.66 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		// Splitting the Time pad into A and R (2026-09-12) also split this
		// reading: the macro holds Release and only Release, which the pad
		// could only say as a shared "32/64" badge over both stages.
		expect(stateOf(container, 'A')).toBe('live');
		expect(stateOf(container, 'R')).toBe('held');
		expect(container.querySelector('[data-vm-function="release"] .vm-held-badge')?.textContent?.trim()).toBe('macro');
	});

	it('a drag on the Osc pad writes vm.oscAmount and vm.oscCoarse as t', async () => {
		seed({ 'vm.members': AUTUMN_UNMAPPED, 'vm.oscAmount': 0.2, 'vm.oscCoarse': 0.5 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		const pad = slider(container, 'Osc');
		pointer(pad, 'pointerdown', 100);
		const move = new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 });
		Object.defineProperty(move, 'pointerId', { value: 1 });
		pad.dispatchEvent(move);
		const up = new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 });
		Object.defineProperty(up, 'pointerId', { value: 1 });
		pad.dispatchEvent(up);
		const sets = sendMock.mock.calls
			.filter(([addr]) => addr === '/looping/v3/property/set')
			.map(([, args]) => args as unknown[]);
		const names = sets.map((a) => a[1]);
		expect(names).toContain('vm.oscAmount');
		expect(names).toContain('vm.oscCoarse');
		for (const a of sets) {
			expect(a[0]).toBe(DEVICE);
			expect(a[2] as number).toBeGreaterThanOrEqual(0);
			expect(a[2] as number).toBeLessThanOrEqual(1);
			expect(a[3]).toBe(GENERATION);
		}
	});
});

// --- the pad grid and hold-to-scope (2026-09-08) ------------------------------

const PADS_16 = Array.from({ length: 16 }, (_, i) => ({
	note: 36 + i,
	name: ['Kick Tight', 'Rim', 'Snare Stick Hit 3', 'Clap', 'Snare 2 Gen', 'Tom Lo', 'Hat Cl', 'Tom Mid',
		'Hat Ped', 'Tom Hi', 'Hat Op', 'Tom Hi 2', 'Crash', 'Tom Top', 'Ride', 'China'][i],
	class: 'DrumCell',
	// The kick wears Live's chain colour; the rest are left to the track ink.
	color: i === 0 ? 0x85961f : null
}));
const DRUMCELL_WITH_PADS = JSON.stringify({ ...JSON.parse(DRUMCELL), pads: PADS_16 });

function tile(container: HTMLElement, note: number): HTMLElement {
	const el = container.querySelector<HTMLElement>(`.pad-tile[data-note="${note}"]`);
	if (!el) throw new Error(`no pad tile ${note}`);
	return el;
}

// Each finger is its own pointer; the grid captures per pointer.
function padPointer(el: HTMLElement, type: string, pointerId: number) {
	const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
	Object.defineProperty(ev, 'pointerId', { value: pointerId });
	el.dispatchEvent(ev);
}

// The scope's tap-vs-hold split reads `Date.now()` (2026-09-09), and a
// synthetic press and release land in the same millisecond — which is a
// TAP, and latches. `holdPast()` moves the clock past the threshold so a
// test that means "hold" gets one; `padTap` is the other half, spelled out
// at the call sites that want a latch.
let mockNow = 0;
function mockClock() {
	mockNow = 0;
	vi.spyOn(Date, 'now').mockImplementation(() => mockNow);
}
function holdPast() {
	mockNow += 500; // > MOMENTARY_HOLD_MS
}

function scopeOf(container: HTMLElement): string | null {
	return container.querySelector('[data-vm-mode]')?.getAttribute('data-vm-scope') ?? null;
}

// --- the playing clip on the grid (2026-09-08) --------------------------------

const requestNotesMock = requestNotes as unknown as ReturnType<typeof vi.fn>;
const midi = (pitch: number, startBeats: number) => ({ pitch, startBeats, durationBeats: 0.25, velocity: 100 });
// A four-beat pattern on kick / snare / closed hat.
const KICK_SNARE_HAT = [midi(36, 0), midi(42, 0.5), midi(38, 1), midi(42, 1.5), midi(36, 2), midi(42, 2.5), midi(38, 3), midi(42, 3.5)];

function playClip(status = 1) {
	applyPlayingSlot({
		trackPath: 'tracks/0',
		slotIdx: 0,
		isAudioClip: false,
		filePath: '',
		lengthBeats: 4,
		loopStartBeats: 0,
		loopEndBeats: 4,
		looping: true,
		status
	});
}

async function settle() {
	// The notes promise resolves on a microtask; give the effect a turn.
	await Promise.resolve();
	await Promise.resolve();
	await tick();
}

describe('DrumRackCentralView — the pad grid and hold-to-scope', () => {
	// The grid draws the pads in play (2026-09-09), so a test that wants
	// more than one tile has to give it a clip: `mounted()` renders with
	// KICK_SNARE_HAT playing, which puts 36 / 38 / 42 on the grid beside
	// whatever Live has selected. That is the shape of the feature now —
	// with nothing playing there is one tile and nothing else to hold.
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		__resetPlayingClipsStoreForTests();
		requestNotesMock.mockImplementation(() => Promise.resolve(KICK_SNARE_HAT));
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

	function sets() {
		return sendMock.mock.calls
			.filter(([addr]) => addr === '/looping/v3/property/set')
			.map(([, args]) => args as unknown[]);
	}

	/** Render with the clip playing, so the grid has 36 / 38 / 42 to hold. */
	async function mounted(properties: Record<string, OSCArg>) {
		seed(properties);
		const rendered = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		playClip();
		await settle();
		return rendered;
	}

	function noteList(container: HTMLElement): (string | undefined)[] {
		return Array.from(container.querySelectorAll<HTMLElement>('.pad-tile')).map((t) => t.dataset.note);
	}

	it('draws only the pads in play — the selection alone with nothing playing', async () => {
		seed({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.selectedPad': 40, 'vm.pitch': 0 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		// One tile: what the controls are pointed at, and nothing else.
		expect(noteList(container)).toEqual(['40']);
		expect(tile(container, 40).classList.contains('pad-selected')).toBe(true);
		expect(container.querySelector('.pad-grid')?.getAttribute('data-columns')).toBe('1');

		// The clip adds its own, in pitch order around the selection.
		playClip();
		await settle();
		expect(noteList(container)).toEqual(['36', '38', '40', '42']);
		expect(container.querySelector('.pad-grid')?.getAttribute('data-pads')).toBe('4');
		expect(container.querySelector('.pad-grid')?.getAttribute('data-columns')).toBe('1'); // four still stack
		expect(tile(container, 36).textContent?.trim()).toBe('Kick');
		expect(tile(container, 38).textContent?.trim()).toBe('Snare');
		expect(tile(container, 40).textContent?.trim()).toBe('Snare 2');
		expect(tile(container, 40).classList.contains('pad-selected')).toBe(true);
		expect(tile(container, 36).classList.contains('pad-selected')).toBe(false);
		// A pad Live coloured is filled with that colour, its label in the text
		// that fill leaves readable; the others keep the well and the track's ink.
		expect(tile(container, 36).classList.contains('pad-colored')).toBe(true);
		expect(tile(container, 36).style.getPropertyValue('--pad-fill')).toBe('#85961f');
		expect(tile(container, 36).style.getPropertyValue('--pad-fg')).toBe('#141414');
		expect(tile(container, 38).classList.contains('pad-colored')).toBe(false);
		expect(tile(container, 38).style.getPropertyValue('--pad-fill')).toBe('');
		// The controls are still there, beside the grid.
		expect(container.querySelectorAll('.vm-controls .vm-slot')).toHaveLength(4);
	});

	it('starts a second column at the fifth pad, four down the first, lowest at the foot', async () => {
		// The user's rule: stack, then widen. Six pads are 4 + 2 — and each
		// column reads BOTTOM-UP, so the lowest note takes the last row.
		requestNotesMock.mockImplementation(() =>
			Promise.resolve([36, 38, 40, 42, 44, 46].map((p, i) => midi(p, i * 0.5)))
		);
		const { container } = await mounted({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.selectedPad': 36 });
		expect(noteList(container)).toEqual(['36', '38', '40', '42', '44', '46']); // DOM order stays ascending
		const grid = container.querySelector('.pad-grid')!;
		expect(grid.getAttribute('data-columns')).toBe('2');
		expect(getComputedStyle(grid).getPropertyValue('--pad-rows').trim()).toBe('4');
		const cell = (note: number) => {
			const st = tile(container, note).style;
			return `${st.gridColumn}/${st.gridRow}`;
		};
		expect(cell(36)).toBe('1/4'); // lowest note, foot of the first column
		expect(cell(42)).toBe('1/1'); // fourth note, top of it
		expect(cell(44)).toBe('2/4'); // fifth starts the second column, at ITS foot
		expect(cell(46)).toBe('2/3');
	});

	it('shows no label on identically named chains, and no note names anywhere for now', async () => {
		const chase = Array.from({ length: 16 }, (_, i) => ({ note: 36 + i, name: 'Chase', class: 'DrumCell', color: null }));
		const { container } = await mounted({
			'vm.members': JSON.stringify({ ...JSON.parse(DRUMCELL), pads: chase }),
			'vm.selectedPad': 36
		});
		expect(tile(container, 36).textContent?.trim()).toBe('');
		expect(tile(container, 42).textContent?.trim()).toBe('');
		const twoKicks = [
			{ note: 36, name: '606 Kick', class: 'DrumCell', color: null },
			{ note: 38, name: '606 Snare', class: 'DrumCell', color: null },
			{ note: 42, name: '808 Kick', class: 'DrumCell', color: null }
		];
		applyPropertyValue(DEVICE, 'vm.members', JSON.stringify({ ...JSON.parse(DRUMCELL), pads: twoKicks }));
		await tick();
		expect(tile(container, 36).querySelector('.pad-label')?.textContent).toBe('Kick');
		expect(tile(container, 38).querySelector('.pad-label')?.textContent).toBe('Snare');
		expect(container.querySelector('.pad-sub')).toBeNull(); // no note names anywhere
	});

	it('shows the grid on every profile, and a 32-pad kit draws only what is in play', async () => {
		// The size of the kit stopped mattering when the paging went: a
		// 32-pad kit draws the same handful any other does.
		const pads32 = Array.from({ length: 32 }, (_, i) => ({ note: 36 + i, name: `P${i}`, class: 'OriginalSimpler' }));
		const { container } = await mounted({
			'vm.members': JSON.stringify({ ...JSON.parse(JAZZ), pads: pads32 }),
			'vm.selectedPad': 60
		});
		expect(container.querySelector('[data-vm-mode]')?.getAttribute('data-vm-mode')).toBe('simpler');
		expect(noteList(container)).toEqual(['36', '38', '42', '60']);
		expect(tile(container, 60).classList.contains('pad-selected')).toBe(true);
		expect(container.querySelector('.pad-pager')).toBeNull(); // no paging any more
	});

	it('a press selects the pad in Live and scopes the view; a release returns it to the kit', async () => {
		const { container } = await mounted({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.selectedPad': 36, 'vm.pitch': 0 });
		expect(scopeOf(container)).toBeNull();
		padPointer(tile(container, 38), 'pointerdown', 7);
		await tick();
		expect(sets()).toEqual([[DEVICE, 'vm.selectedPad', 38, GENERATION]]);
		expect(scopeOf(container)).toBe('38');
		expect(tile(container, 38).classList.contains('pad-held')).toBe(true);
		// While held, the profile's functions are subscribed for that pad.
		const rows = propertyWireCalls('/looping/v3/property/subscribe').filter((n) => n.startsWith('vm.pad.38.'));
		expect(rows.sort()).toEqual([
			'vm.pad.38.attack', 'vm.pad.38.chainMute', 'vm.pad.38.chainVolume', 'vm.pad.38.decay', 'vm.pad.38.filterFreq',
			'vm.pad.38.filterRes', 'vm.pad.38.fx1', 'vm.pad.38.fx2', 'vm.pad.38.fxType',
			'vm.pad.38.gain', 'vm.pad.38.pitch', 'vm.pad.38.start'
		]);
		holdPast();
		padPointer(tile(container, 38), 'pointerup', 7);
		await tick();
		expect(scopeOf(container)).toBeNull();
		expect(tile(container, 38).classList.contains('pad-held')).toBe(false);
	});

	it('a held pad draws its chain mute and volume beside the pads; the mute writes that pad', async () => {
		const { container } = await mounted({
			'vm.members': DRUMCELL_WITH_PADS,
			'vm.selectedPad': 36,
			'vm.pad.38.chainMute': 0,
			'vm.pad.38.chainVolume': 0.85
		});
		expect(container.querySelector('.pad-mixer')).toBeNull();
		padPointer(tile(container, 38), 'pointerdown', 7);
		await tick();
		const mute = container.querySelector('.pad-mute') as HTMLElement;
		expect(mute).not.toBeNull();
		expect(mute.getAttribute('aria-pressed')).toBe('false');
		sets().length = 0;
		mute.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, bubbles: true }));
		window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, bubbles: true }));
		await tick();
		expect(sets()).toContainEqual([DEVICE, 'vm.pad.38.chainMute', 1, GENERATION]);
		holdPast();
		padPointer(tile(container, 38), 'pointerup', 7);
		await tick();
		expect(container.querySelector('.pad-mixer')).toBeNull();
	});

	it("while held, a control shows the pad's own value and a drag writes that pad's row, not the kit's", async () => {
		const { container } = await mounted({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.selectedPad': 36, 'vm.pitch': -7 });
		expect(slider(container, 'Trnsp').getAttribute('aria-valuenow')).toBe('-7');
		padPointer(tile(container, 38), 'pointerdown', 7);
		await tick();
		// Until the pad's row lands the kit value shows; then the pad's.
		expect(slider(container, 'Trnsp').getAttribute('aria-valuenow')).toBe('-7');
		applyPropertyValue(DEVICE, 'vm.pad.38.pitch', 12);
		await tick();
		expect(slider(container, 'Trnsp').getAttribute('aria-valuenow')).toBe('12');
		sendMock.mockClear();
		drag(slider(container, 'Trnsp'), 150, 100); // up a quarter of the rail: +24 semitones
		const written = sets();
		expect(written.every(([, name]) => name === 'vm.pad.38.pitch')).toBe(true);
		expect(written.some(([, name]) => name === 'vm.pitch')).toBe(false);
		expect(written.at(-1)?.[2]).toBe(36);
		// Lift: the control is the kit's again.
		holdPast();
		padPointer(tile(container, 38), 'pointerup', 7);
		await tick();
		expect(slider(container, 'Trnsp').getAttribute('aria-valuenow')).toBe('-7');
		sendMock.mockClear();
		drag(slider(container, 'Trnsp'), 150, 100);
		expect(sets().every(([, name]) => name === 'vm.pitch')).toBe(true);
	});

	it('two held pads: the last pressed is the number on the control, the other moves by the same delta', async () => {
		const { container } = await mounted({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.selectedPad': 36, 'vm.pitch': 0 });
		padPointer(tile(container, 36), 'pointerdown', 1);
		padPointer(tile(container, 42), 'pointerdown', 2);
		await tick();
		expect(scopeOf(container)).toBe('42');
		applyPropertyValue(DEVICE, 'vm.pad.36.pitch', 3);
		applyPropertyValue(DEVICE, 'vm.pad.42.pitch', 10);
		await tick();
		expect(slider(container, 'Trnsp').getAttribute('aria-valuenow')).toBe('10');
		sendMock.mockClear();
		drag(slider(container, 'Trnsp'), 150, 100); // +24 on the scoped pad
		const last42 = sets().filter(([, n]) => n === 'vm.pad.42.pitch').at(-1);
		const last36 = sets().filter(([, n]) => n === 'vm.pad.36.pitch').at(-1);
		expect(last42?.[2]).toBe(34); // 10 + 24
		expect(last36?.[2]).toBe(27); // 3 + the same 24
		expect(sets().some(([, n]) => n === 'vm.pitch')).toBe(false);
		// Lift one finger: the other pad is still the scope.
		holdPast();
		padPointer(tile(container, 42), 'pointerup', 2);
		await tick();
		expect(scopeOf(container)).toBe('36');
	});

	it('a held pad with no member for a function ghosts that control and writes nothing for it', async () => {
		const { container } = await mounted({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.selectedPad': 36, 'vm.start': 0.4, 'vm.pitch': 0 });
		expect(stateOf(container, 'Start')).toBe('live');
		padPointer(tile(container, 42), 'pointerdown', 3);
		await tick();
		// @ts-expect-error OSC nil arrives as null; OSCArg does not model it
		applyPropertyValue(DEVICE, 'vm.pad.42.start', null);   // the row reads nil: no member on this pad
		applyPropertyValue(DEVICE, 'vm.pad.42.pitch', 2);
		await tick();
		expect(stateOf(container, 'Start')).toBe('none');
		expect(stateOf(container, 'Trnsp')).toBe('live');
		sendMock.mockClear();
		drag(slider(container, 'Start'), 150, 100);
		expect(sets().filter(([, n]) => String(n).endsWith('.start') || n === 'vm.start')).toHaveLength(0);
		holdPast();
		padPointer(tile(container, 42), 'pointerup', 3);
		await tick();
		expect(stateOf(container, 'Start')).toBe('live');
	});

	it('an FX-type choice while holding sets that pad\'s type alone', async () => {
		const { container } = await mounted({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.selectedPad': 36, 'vm.fxType': 0 });
		padPointer(tile(container, 42), 'pointerdown', 4);
		await tick();
		sendMock.mockClear();
		tap(container.querySelector('.fx-type-button'));
		await tick();
		const punch = Array.from(container.querySelectorAll<HTMLButtonElement>('.fx-type-option')).find((b) => b.textContent?.trim() === 'Punch')!;
		tap(punch);
		expect(sets()).toEqual([[DEVICE, 'vm.pad.42.fxType', 3, GENERATION]]);
	});

	// PADS, in SystemCentralView's Sections card. Off, the grid's column
	// goes back to the controls and the view is what it was before the
	// grid landed — full-width controls, moving the whole kit.
	it("the controls take the held pad's colour, and give it back on release", async () => {
		// While a pad is scoped the controls ARE that pad's, so they wear its
		// chain colour. Pad 38 is uncoloured in this kit and 36 is olive.
		const { container } = await mounted({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.selectedPad': 42, 'vm.start': 0.4 });
		const tint = () => slider(container, 'Start').style.getPropertyValue('--slider-tint').trim();
		const atRest = tint();
		expect(atRest).not.toBe('');

		padPointer(tile(container, 36), 'pointerdown', 4); // the olive pad
		await tick();
		expect(scopeOf(container)).toBe('36');
		const held = tint();
		expect(held).not.toBe(atRest);

		holdPast();
		padPointer(tile(container, 36), 'pointerup', 4);
		await tick();
		expect(tint()).toBe(atRest);
	});

	it('an uncoloured pad leaves the controls on the track ink', async () => {
		// Live gives a chain no colour and the census carries null: there is
		// nothing to take, so the controls stay the track's.
		const { container } = await mounted({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.selectedPad': 42, 'vm.start': 0.4 });
		const tint = () => slider(container, 'Start').style.getPropertyValue('--slider-tint').trim();
		const atRest = tint();
		padPointer(tile(container, 38), 'pointerdown', 4); // PADS_16 colours only pad 36
		await tick();
		expect(scopeOf(container)).toBe('38');
		expect(tint()).toBe(atRest);
	});

	it('a TAP latches the pad: the controls stay its after the finger leaves', async () => {
		const { container } = await mounted({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.selectedPad': 36, 'vm.pitch': 0 });
		padPointer(tile(container, 38), 'pointerdown', 7);
		await tick();
		padPointer(tile(container, 38), 'pointerup', 7); // no holdPast(): a tap
		await tick();
		expect(scopeOf(container)).toBe('38');
		expect(tile(container, 38).classList.contains('pad-held')).toBe(true);

		// Tapping it again lets it go.
		padPointer(tile(container, 38), 'pointerdown', 8);
		await tick();
		padPointer(tile(container, 38), 'pointerup', 8);
		await tick();
		expect(scopeOf(container)).toBeNull();
		expect(tile(container, 38).classList.contains('pad-held')).toBe(false);
	});

	it('a latched pad takes the drag, and a hold over it is still momentary', async () => {
		const { container } = await mounted({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.selectedPad': 36, 'vm.start': 0.5 });
		padPointer(tile(container, 38), 'pointerdown', 7);
		await tick();
		padPointer(tile(container, 38), 'pointerup', 7); // latch 38
		await tick();
		applyPropertyValue(DEVICE, 'vm.pad.38.start', 0.2);
		await tick();
		sendMock.mockClear();
		drag(slider(container, 'Start'), 150, 100);
		expect(
			sendMock.mock.calls
				.filter(([addr]) => addr === '/looping/v3/property/set')
				.map(([, args]) => (args as unknown[])[1])
		).toEqual(['vm.pad.38.start']); // the latched pad's row, with no finger on it

		// Hold another pad while 38 is latched: the finger wins, and the
		// release goes back to the latch rather than to the kit.
		padPointer(tile(container, 42), 'pointerdown', 9);
		await tick();
		expect(scopeOf(container)).toBe('42');
		holdPast();
		padPointer(tile(container, 42), 'pointerup', 9);
		await tick();
		expect(scopeOf(container)).toBe('38');
	});
});


describe('DrumRackCentralView — the Filter pad', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
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

	function sets() {
		return sendMock.mock.calls
			.filter(([addr]) => addr === '/looping/v3/property/set')
			.map(([, args]) => args as unknown[]);
	}

	it('is one pad on every kit shape, cutoff across and resonance up', async () => {
		seed({ 'vm.members': DRUMCELL, 'vm.filterFreq': 0.8, 'vm.filterRes': 0.25 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(slider(container, 'Filter').getAttribute('aria-label')).toBe('Filter: X 80%, Y 25%');

		for (const kit of [JAZZ, AUTUMN_UNMAPPED, ETHNIC]) {
			await setCensus(kit);
			expect(container.querySelector('[data-vm-function="filterFreq|filterRes"]')).not.toBeNull();
		}
		// A plugin kit has no filter member and no pad, like Gain.
		await setCensus(KOMPLETE);
		expect(container.querySelector('[data-vm-function="filterFreq|filterRes"]')).toBeNull();
	});

	it('a drag writes both axes as t; a kit with no member ghosts it and writes nothing', async () => {
		seed({ 'vm.members': DRUMCELL, 'vm.filterFreq': 0.5, 'vm.filterRes': 0.5 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		const pad = slider(container, 'Filter');
		pointer(pad, 'pointerdown', 100);
		const move = new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 });
		Object.defineProperty(move, 'pointerId', { value: 1 });
		pad.dispatchEvent(move);
		const up = new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 });
		Object.defineProperty(up, 'pointerId', { value: 1 });
		pad.dispatchEvent(up);
		const names = sets().map((a) => a[1]);
		expect(names).toContain('vm.filterFreq');
		expect(names).toContain('vm.filterRes');
		for (const a of sets()) {
			expect(a[2] as number).toBeGreaterThanOrEqual(0);
			expect(a[2] as number).toBeLessThanOrEqual(1);
		}

		// A nested-rack kit binds neither axis: dimmed, and inert.
		sendMock.mockClear();
		await setCensus(ETHNIC);
		const slot = container.querySelector('[data-vm-function="filterFreq|filterRes"]')!;
		expect(slot.getAttribute('data-vm-state')).toBe('none');
	});

	it('is read-only and badged when every pad\'s filter is macro-held', async () => {
		seed({
			'vm.members': census({ DrumCell: 24 }, {
				filterFreq: { members: 48, held: 48 },
				filterRes: { members: 24, held: 24 }
			}),
			'vm.filterFreq': 0.3,
			'vm.filterRes': 0.3
		});
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		const slot = container.querySelector('[data-vm-function="filterFreq|filterRes"]')!;
		expect(slot.getAttribute('data-vm-state')).toBe('held');
		expect(slot.querySelector('.vm-held-badge')?.textContent).toContain('macro');
	});
});

describe('DrumRackCentralView — the Gain slider', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
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

	function sets() {
		return sendMock.mock.calls
			.filter(([addr]) => addr === '/looping/v3/property/set')
			.map(([, args]) => args as unknown[]);
	}

	it('sits in the same place on every kit shape, and never on a plugin kit', async () => {
		seed({ 'vm.members': DRUMCELL, 'vm.gain': 0.4 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		// First slot of the row after the pads, outside the profile switch
		// (user, 2026-09-27: "the leftmost slider").
		const slots = Array.from(container.querySelectorAll('.vm-slot'));
		expect(slots[0].getAttribute('data-vm-function')).toBe('gain');
		expect(slider(container, 'Gain').getAttribute('aria-label')).toBe('Gain: 0.40');

		for (const kit of [JAZZ, AUTUMN_UNMAPPED, ETHNIC]) {
			await setCensus(kit);
			const all = Array.from(container.querySelectorAll('.vm-slot'));
			expect(all[0].getAttribute('data-vm-function')).toBe('gain');
		}

		// A plugin kit has no gain member and no slider: the rack's own
		// macros are the only handle that kit has.
		await setCensus(KOMPLETE);
		expect(container.querySelector('[data-vm-function="gain"]')).toBeNull();
	});

	it('a drag writes vm.gain as t; a kit with no member ghosts it and writes nothing', async () => {
		seed({ 'vm.members': DRUMCELL, 'vm.gain': 0.5 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		drag(slider(container, 'Gain'), 150, 50);
		const written = sets().filter((a) => a[1] === 'vm.gain');
		expect(written).toHaveLength(1);
		expect(written[0][0]).toBe(DEVICE);
		expect(written[0][2] as number).toBeGreaterThan(0.5); // dragged up
		expect(written[0][2] as number).toBeLessThanOrEqual(1);
		expect(written[0][3]).toBe(GENERATION);

		// An Operator kit binds no Volume: dimmed, and inert.
		sendMock.mockClear();
		await setCensus(census({ Operator: 4 }, { pitch: { members: 4, held: 0 } }));
		const slot = container.querySelector('[data-vm-function="gain"]')!;
		expect(slot.getAttribute('data-vm-state')).toBe('none');
		drag(slider(container, 'Gain'), 150, 50);
		expect(sets().filter((a) => a[1] === 'vm.gain')).toHaveLength(0);
	});

	it('holds read-only and badges a kit whose Volume every pad has under a macro', async () => {
		seed({
			'vm.members': census({ DrumCell: 24 }, { ...JSON.parse('{}'), gain: { members: 24, held: 24 } }),
			'vm.gain': 0.3
		});
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		const slot = container.querySelector('[data-vm-function="gain"]')!;
		expect(slot.getAttribute('data-vm-state')).toBe('held');
		expect(slot.querySelector('.vm-held-badge')?.textContent).toContain('macro');
		drag(slider(container, 'Gain'), 150, 50);
		expect(sets().filter((a) => a[1] === 'vm.gain')).toHaveLength(0);
	});

	it('with a pad held, a drag writes that pad\'s row and shows that pad\'s value', async () => {
		// Nothing playing, so the grid is the selected pad alone — which is
		// the pad this holds.
		seed({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.gain': 0.5, 'vm.selectedPad': 38 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		padPointer(tile(container, 38), 'pointerdown', 5);
		await tick();
		applyPropertyValue(DEVICE, 'vm.pad.38.gain', 0.2);
		await tick();
		// The control follows the held pad, not the kit.
		expect(slider(container, 'Gain').getAttribute('aria-label')).toBe('Gain: 0.20');
		sendMock.mockClear();
		drag(slider(container, 'Gain'), 150, 100);
		const written = sets();
		expect(written.map((a) => a[1])).toEqual(['vm.pad.38.gain']);
		expect(written[0][2] as number).toBeGreaterThan(0.2);
	});
});


describe('DrumRackCentralView — the playing clip on the grid', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		__resetPlayingClipsStoreForTests();
		requestNotesMock.mockImplementation(() => Promise.resolve(KICK_SNARE_HAT));
	});
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("adds the clip's pads to the selection, and drops them again when it stops", async () => {
		seed({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.selectedPad': 36 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		const notes = () => Array.from(container.querySelectorAll<HTMLElement>('.pad-tile')).map((t) => t.dataset.note);
		expect(notes()).toEqual(['36']); // nothing playing: the selection alone
		playClip();
		await settle();
		expect(requestNotesMock).toHaveBeenCalledWith('tracks/0/slots/0/clip');
		const tiles = Array.from(container.querySelectorAll<HTMLElement>('.pad-tile'));
		expect(tiles.map((t) => t.dataset.note)).toEqual(['36', '38', '42']);
		expect(tiles.map((t) => t.textContent?.trim())).toEqual(['Kick', 'Snare', 'Hat Cl']); // three hats in the kit: the second word tells them apart
		const grid = container.querySelector<HTMLElement>('.pad-grid')!;
		expect(grid.dataset.pads).toBe('3');
		expect(grid.dataset.columns).toBe('1'); // three still stack down one column
		expect(container.querySelector('.pad-pager')).toBeNull();
		// A hold still works.
		padPointer(tile(container, 38), 'pointerdown', 7);
		await tick();
		expect(scopeOf(container)).toBe('38');
		holdPast();
		padPointer(tile(container, 38), 'pointerup', 7);
		await tick();
		// Stopped: back to the selection alone — which the press above moved
		// to 38, since touching a tile selects that pad in Live.
		playClip(0);
		await settle();
		expect(notes()).toEqual(['38']);
	});

	it("draws Live's selected pad even when the clip never plays it", async () => {
		// 41 is "Hat Op" here; the clip plays 36 / 38 / 42 only.
		seed({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.selectedPad': 41 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		playClip();
		await settle();
		const notes = () => Array.from(container.querySelectorAll<HTMLElement>('.pad-tile')).map((t) => t.dataset.note);
		expect(notes()).toEqual(['36', '38', '41', '42']); // in note order, not appended
		expect(tile(container, 41).classList.contains('pad-selected')).toBe(true);
		expect(container.querySelector('.pad-grid')?.getAttribute('data-pads')).toBe('4');

		// Live's selection moves to another pad the clip does not play: the
		// grid swaps which extra tile it carries, never two.
		applyPropertyValue(DEVICE, 'vm.selectedPad', 45);
		await tick();
		expect(notes()).toEqual(['36', '38', '42', '45']);
		expect(tile(container, 45).classList.contains('pad-selected')).toBe(true);

		// Back onto a pad the clip plays: just the clip's three again.
		applyPropertyValue(DEVICE, 'vm.selectedPad', 38);
		await tick();
		expect(notes()).toEqual(['36', '38', '42']);
	});

	it('keeps a held pad on the grid when a clip starts under the finger', async () => {
		// The scoped pad owns every control while it is held, so it must not
		// vanish because a clip that does not play it started.
		seed({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.selectedPad': 45 }); // "China", not in the clip
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		padPointer(tile(container, 45), 'pointerdown', 9);
		await tick();
		expect(scopeOf(container)).toBe('45');
		// Move Live's selection off the held pad, so what keeps 45 on the
		// grid can only be the hold.
		applyPropertyValue(DEVICE, 'vm.selectedPad', 38);
		await tick();
		playClip();
		await settle();
		const notes = () => Array.from(container.querySelectorAll<HTMLElement>('.pad-tile')).map((t) => t.dataset.note);
		expect(notes()).toEqual(['36', '38', '42', '45']);
		expect(tile(container, 45).classList.contains('pad-held')).toBe(true);
	});

	it('keeps the paged view for a clip that plays sixteen or more pads', async () => {
		requestNotesMock.mockImplementation(() =>
			Promise.resolve(Array.from({ length: 16 }, (_, i) => midi(36 + i, i * 0.25)))
		);
		seed({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.selectedPad': 36 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		playClip();
		await settle();
		expect(container.querySelectorAll('.pad-tile')).toHaveLength(16);
		expect(container.querySelector('.pad-grid')?.getAttribute('data-compact')).toBeNull();
	});

	it('flashes a pad as the playhead crosses one of its notes, for PAD_FLASH_MS, and follows the loop round', async () => {
		vi.useFakeTimers();
		seed({ 'vm.members': DRUMCELL_WITH_PADS, 'vm.selectedPad': 36 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		playClip();
		await settle();
		const lit = () => Array.from(container.querySelectorAll<HTMLElement>('.pad-tile.pad-lit')).map((t) => t.dataset.note);
		// The first position is a baseline, never a trigger.
		applyPlayhead({ trackPath: 'tracks/0', slotIdx: 0, positionBeats: 0.4, status: 1 });
		await tick();
		expect(lit()).toEqual([]);
		applyPlayhead({ trackPath: 'tracks/0', slotIdx: 0, positionBeats: 0.6, status: 1 });
		await tick();
		expect(lit()).toEqual(['42']); // the hat at 0.5
		applyPlayhead({ trackPath: 'tracks/0', slotIdx: 0, positionBeats: 1.05, status: 1 });
		await tick();
		expect(lit()).toEqual(['38', '42']); // the snare at 1, the hat still lit
		vi.advanceTimersByTime(PAD_FLASH_MS + 5);
		await tick();
		expect(lit()).toEqual([]);
		// Round the loop: 3.9 → 0.1 crosses the kick at 0.
		applyPlayhead({ trackPath: 'tracks/0', slotIdx: 0, positionBeats: 3.9, status: 1 });
		await tick();
		applyPlayhead({ trackPath: 'tracks/0', slotIdx: 0, positionBeats: 0.1, status: 1 });
		await tick();
		expect(lit()).toEqual(['36']);
		// A relaunch jump lights nothing.
		vi.advanceTimersByTime(PAD_FLASH_MS + 5);
		await tick();
		applyPlayhead({ trackPath: 'tracks/0', slotIdx: 0, positionBeats: 3.0, status: 1 });
		await tick();
		expect(lit()).toEqual([]);
	});
});


// --- the central Trnsp is always drawn (2026-09-12; it stepped aside for the grid 09-08..09-12) ---

describe('DrumRackCentralView — Trnsp whether or not the FX grid is on', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
	});
	afterEach(() => {
		cleanup();
		uiPrefsStore.showFxGrid = false;
	});

	it('a DrumCell kit shows Trnsp with the FX grid on, and still with it off', async () => {
		uiPrefsStore.showFxGrid = true;
		seed({ 'vm.members': DRUMCELL, 'vm.pitch': -7 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(container.querySelector('[data-vm-mode]')?.getAttribute('data-vm-mode')).toBe('full');
		expect(container.querySelectorAll('.vm-controls .vm-slot')).toHaveLength(4);
		expect(slider(container, 'Trnsp').getAttribute('aria-valuenow')).toBe('-7');
		expect(container.querySelector('[role="slider"][aria-label^="Start"]')).not.toBeNull();
		uiPrefsStore.showFxGrid = false;
		await tick();
		expect(container.querySelectorAll('.vm-controls .vm-slot')).toHaveLength(4);
		expect(slider(container, 'Trnsp').getAttribute('aria-valuenow')).toBe('-7');
	});
});

// --- the pane, and the per-pad row (issue #491, 2026-09-10) -----------------------

describe('DrumRackCentralView — the pane and the scoped pad\'s own row', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		drumPadScope.clear();
		mockClock();
	});
	afterEach(() => cleanup());

	// The Jazz kit as the rig reads it: 31 Simplers and one Sampler pad (67).
	const JAZZ_PADS = JSON.stringify({
		...JSON.parse(JAZZ),
		pads: [
			{ note: 36, name: 'Kick', class: 'OriginalSimpler', color: null },
			{ note: 38, name: 'Snare', class: 'OriginalSimpler', color: 0x85961f },
			{ note: 67, name: 'Brush Swirl', class: 'MultiSampler', color: null }
		]
	});

	it('shows the scoped pad\'s own class row: the Sampler pad on a Simpler kit gets the Sampler row while held', async () => {
		seed({ 'vm.members': JAZZ_PADS, 'vm.selectedPad': 67, 'vm.pitch': 0 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(container.querySelector('[data-vm-mode]')?.getAttribute('data-vm-mode')).toBe('simpler');
		expect(container.querySelector('[data-vm-function="attack|release"]')).not.toBeNull();
		expect(container.querySelector('[data-vm-function="oscAmount|oscCoarse"]')).toBeNull();

		padPointer(tile(container, 67), 'pointerdown', 1);
		await tick();
		expect(scopeOf(container)).toBe('67');
		// The Sampler row now — its Osc pad, and the amp envelope as separate
		// A/R slots rather than the Simpler row's combined Time pad.
		expect(container.querySelector('[data-vm-function="oscAmount|oscCoarse"]')).not.toBeNull();
		expect(container.querySelector('[data-vm-function="attack|release"]')).toBeNull();
		expect(container.querySelector('[data-vm-function="attack"]')).not.toBeNull();
		expect(container.querySelector('[data-vm-function="release"]')).not.toBeNull();
		expect(propertyWireCalls('/looping/v3/property/subscribe')).toContain('vm.pad.67.oscAmount');

		holdPast();
		padPointer(tile(container, 67), 'pointerup', 1);
		await tick();
		expect(scopeOf(container)).toBeNull();
		expect(container.querySelector('[data-vm-function="oscAmount|oscCoarse"]')).toBeNull();
		expect(container.querySelector('[data-vm-function="attack|release"]')).not.toBeNull();
	});

	it('opens an effect\'s view in place of the controls while a pad is held, and closes it with the hold', async () => {
		seed({ 'vm.members': JAZZ_PADS, 'vm.selectedPad': 38, 'vm.pitch': 0 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(container.querySelector('.vm-controls')).not.toBeNull();

		// A tile touched under the hold sets the pane (through the router).
		padPointer(tile(container, 38), 'pointerdown', 1);
		await tick();
		drumPadScope.setPane(DEVICE, 'reverb');
		await tick();
		const root = container.querySelector('[data-vm-mode]')!;
		expect(root.getAttribute('data-vm-pane')).toBe('reverb');
		expect(container.querySelector('.vm-controls')).toBeNull(); // the whole controls area, Filter and Gain included
		expect(container.querySelector('.vm-filter-col')).toBeNull();
		const pane = container.querySelector('.pad-fx-pane');
		expect(pane).not.toBeNull();
		expect(pane?.querySelector('.pad-fx-chip')?.textContent).toBe('Snare');
		expect(pane?.querySelector('.pad-fx-device')?.textContent).toBe('Reverb');
		// The pad column stays: the hold is still on the glass.
		expect(container.querySelector('.pad-grid')).not.toBeNull();
		// The chip wears the pad's chain colour.
		expect((pane as HTMLElement).style.getPropertyValue('--chip-ink')).not.toBe('');

		// The way back closes the pane and keeps the hold.
		tap(pane?.querySelector('.pad-fx-back'));
		await tick();
		expect(root.getAttribute('data-vm-pane')).toBeNull();
		expect(container.querySelector('.vm-controls')).not.toBeNull();
		expect(scopeOf(container)).toBe('38');

		// Opened again, the pane goes with the hold's release.
		drumPadScope.setPane(DEVICE, 'reverb');
		await tick();
		expect(root.getAttribute('data-vm-pane')).toBe('reverb');
		holdPast();
		padPointer(tile(container, 38), 'pointerup', 1);
		await tick();
		expect(root.getAttribute('data-vm-pane')).toBeNull();
		expect(container.querySelector('.vm-controls')).not.toBeNull();
	});

	// An Auto Filter record with the LFO the view's XY pad draws: amount is
	// param 12 (its Y), time is param 16 (drawn as 1 − time on X).
	function filterRecord(devicePath: string, lfoAmount: number, lfoTime: number): DeviceRecord {
		const params = new SvelteMap<string, ParamRecord>();
		for (let i = 0; i < 24; i++) {
			const paramPath = `${devicePath}/params/${i}`;
			const value = i === 12 ? lfoAmount : i === 16 ? lfoTime : 0;
			params.set(paramPath, { paramPath, name: `P${i}`, displayName: `P${i}`, min: 0, max: 1, value, unit: '' });
		}
		return { devicePath, name: 'Auto Filter', className: 'AutoFilter2', params, properties: new SvelteMap<string, OSCArg>() };
	}

	it("the view inside the pane reads the PAD's slot: ghost where the pad lacks the effect the track has, the pad's own values once it has one (2026-09-12)", async () => {
		// The TRACK carries an Auto Filter behind the rack; pad 38 has none.
		const track = drumTrack({ 'vm.members': JAZZ_PADS, 'vm.selectedPad': 38, 'vm.pitch': 0 });
		track.devices.set('tracks/0/devices/1', filterRecord('tracks/0/devices/1', 0.9, 0.9));
		replaceTree(GENERATION, [track]);
		selectedTrackStore.handleTrackSelected(0);
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		padPointer(tile(container, 38), 'pointerdown', 1);
		await tick();
		drumPadScope.setPane(DEVICE, 'filter');
		// The view arrives through the registry's lazy import.
		await vi.waitFor(() => expect(container.querySelector('.pad-fx-pane [aria-label*=": X "]')).not.toBeNull());
		const pane = container.querySelector('.pad-fx-pane')!;
		const xy = () => pane.querySelector('[aria-label*=": X "]')!.getAttribute('aria-label')!;
		// Ghost: the pad has no filter, whatever the track carries — and the
		// XY does NOT show the track's filter (X 10%, Y 90%).
		expect(pane.querySelector('.slot-ghost')).not.toBeNull();
		expect(xy()).not.toMatch(/X 10%, Y 90%$/);

		// A filter lands on the pad (the surface's pad bundle): the view is
		// live and draws THAT device's LFO.
		const padDevice = `${DEVICE}/pads/38/devices/1`;
		mergePadChain(GENERATION + 1, `${DEVICE}/pads/38`, new Map([[padDevice, filterRecord(padDevice, 0.8, 0.7)]]));
		await tick();
		expect(pane.querySelector('.slot-ghost')).toBeNull();
		expect(xy()).toMatch(/X 30%, Y 80%$/);

		// Lift, and the pane goes with the hold.
		holdPast();
		padPointer(tile(container, 38), 'pointerup', 1);
		await tick();
		expect(container.querySelector('.pad-fx-pane')).toBeNull();
	});

	it('subscribes effect presence for the rack', async () => {
		seed({ 'vm.members': JAZZ_PADS, 'vm.selectedPad': 38 });
		render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		expect(propertyWireCalls('/looping/v3/property/subscribe')).toContain('vm.padFx');
	});

	it('subscribes the held pad\'s chain row while it is held, and lets it go on release', async () => {
		seed({ 'vm.members': JAZZ_PADS, 'vm.selectedPad': 38 });
		const { container } = render(DrumRackCentralView, { props: { instrument: INSTRUMENT } });
		await tick();
		// Live's selection alone scopes nothing: no row until a finger lands.
		expect(propertyWireCalls('/looping/v3/property/subscribe')).not.toContain('vm.padChain.38');
		padPointer(tile(container, 38), 'pointerdown', 1);
		await tick();
		expect(propertyWireCalls('/looping/v3/property/subscribe')).toContain('vm.padChain.38');
		holdPast();
		padPointer(tile(container, 38), 'pointerup', 1);
		await tick();
		expect(propertyWireCalls('/looping/v3/property/unsubscribe')).toContain('vm.padChain.38');
	});
});
