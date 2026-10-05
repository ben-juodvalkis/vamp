/**
 * drumVirtualMacros — the UI-side reading of the surface's `vm.members`
 * census (ADR-428, Milestone 1b).
 *
 * Three decisions every Drum Rack consumer shares live in this module,
 * so this is where they are pinned:
 *
 * 1. MODE — plugin-hosted pads (Komplete Kontrol) keep the macro grid;
 *    every native pad type gets the virtual-macro controls. Decided from
 *    pad CLASSES, never from macro names.
 * 2. STATE — a function with no member is `none` (dimmed, inert); one
 *    whose members are all macro-held is `held` (read-only); anything
 *    with an enabled member is `live`; no census is `unknown`, which
 *    renders exactly as Milestone 1 did.
 * 3. TOLERANCE — a census that cannot be read must never disable a kit
 *    the surface can drive: malformed input degrades to `unknown`, and
 *    malformed fields to zero.
 * 4. RACK MACROS (2026-09-07) — a kit of nested Instrument Racks lists its
 *    pad racks' macro names; the profile is `rack-macros`, each name has
 *    a state, a held badge and a coverage badge, and the layout pairs two
 *    names sharing a first word into an XY pad.
 */

import { describe, it, expect } from 'vitest';
import {
	VM,
	VM_FUNCTIONS,
	VM_PROPERTIES,
	VM_MACRO_PREFIX,
	VM_PITCH_MAX,
	VM_PITCH_MIN,
	INSTRUMENT_RACK_PAD_CLASS,
	clampVmPitch,
	rackMacroLayout,
	mappedMacroIndices,
	vmMacroCensus,
	vmMacroCoverageBadge,
	vmMacroHeldBadge,
	vmMacroProperty,
	vmMacroState,
	combineVmStates,
	dominantPadClass,
	hasPluginPads,
	kitClassSummary,
	kitProfile,
	padClassLabel,
	parseVmMembers,
	vmFunctionState,
	vmHeldBadge,
	vmStateAcceptsWrites
} from '$lib/services/drumVirtualMacros';

/** A census the way the surface emits it (key-sorted, compact). */
function census(overrides: Record<string, unknown> = {}, functions: Record<string, unknown> = {}) {
	const base: Record<string, { members: number; held: number }> = {};
	for (const fn of VM_FUNCTIONS) base[fn] = { members: 24, held: 0 };
	return JSON.stringify({
		family: true,
		functions: { ...base, ...functions },
		hasMacroMappings: false,
		padClasses: { DrumCell: 24 },
		padCount: 24,
		...overrides
	});
}

const JAZZ = census(
	{ family: false, hasMacroMappings: true, padClasses: { OriginalSimpler: 31, MultiSampler: 1 }, padCount: 32 },
	{
		fx1: { members: 0, held: 0 },
		fx2: { members: 0, held: 0 },
		fxType: { members: 0, held: 0 },
		pitch: { members: 32, held: 32 },
		attack: { members: 32, held: 0 },
		decay: { members: 32, held: 0 },
		start: { members: 31, held: 0 }
	}
);

const KOMPLETE = census(
	{ family: false, hasMacroMappings: true, padClasses: { AuPluginDevice: 16 }, padCount: 16 },
	Object.fromEntries(VM_FUNCTIONS.map((fn) => [fn, { members: 0, held: 0 }]))
);

const NO_MEMBERS = Object.fromEntries(VM_FUNCTIONS.map((fn) => [fn, { members: 0, held: 0 }]));
/** `Ethnic Drums` as the rig reads it: 32 nested racks, seven named macros each. */
const ETHNIC_MACROS = [
	{ name: 'Attack', members: 32, held: 0 },
	{ name: 'Release', members: 32, held: 0 },
	{ name: 'Transpose', members: 32, held: 32 },
	{ name: 'Osc', members: 32, held: 0 },
	{ name: 'Pitch Attack', members: 32, held: 0 },
	{ name: 'Pitch Amount', members: 32, held: 0 },
	{ name: 'Room', members: 20, held: 0 }
];
const ETHNIC = census(
	{
		family: false,
		hasMacroMappings: false,
		padClasses: { InstrumentGroupDevice: 32 },
		padCount: 32,
		macros: ETHNIC_MACROS,
		pitchMacro: 'Transpose'
	},
	{ ...NO_MEMBERS, pitch: { members: 32, held: 32 } }
);

describe('drumVirtualMacros — wire names', () => {
	it('names the seven functions plus the census, all under vm.', () => {
		expect(VM_PROPERTIES).toEqual([
			'vm.fx1',
			'vm.fx2',
			'vm.fxType',
			'vm.attack',
			'vm.decay',
			'vm.release',
			'vm.start',
			'vm.pitch',
			'vm.sustain',
			'vm.oscAmount',
			'vm.oscCoarse',
			'vm.pitchEnvAmount',
			'vm.pitchEnvAttack',
			'vm.spread',
			'vm.selector',
			'vm.filterFreq',
			'vm.filterRes',
			'vm.gain',
			'vm.members'
		]);
		expect(VM.members).toBe('vm.members');
		expect(VM_PITCH_MIN).toBe(-48);
		expect(VM_PITCH_MAX).toBe(48);
	});
});

describe('parseVmMembers', () => {
	it('parses the surface census', () => {
		const m = parseVmMembers(JAZZ);
		expect(m).not.toBeNull();
		expect(m!.padCount).toBe(32);
		expect(m!.padClasses).toEqual({ OriginalSimpler: 31, MultiSampler: 1 });
		expect(m!.hasMacroMappings).toBe(true);
		expect(m!.family).toBe(false);
		expect(m!.functions.pitch).toEqual({ members: 32, held: 32 });
		expect(m!.functions.start).toEqual({ members: 31, held: 0 });
		expect(m!.functions.fx1).toEqual({ members: 0, held: 0 });
	});

	it('is null before the cold read and for anything that is not a JSON object', () => {
		expect(parseVmMembers(undefined)).toBeNull();
		expect(parseVmMembers(null)).toBeNull();
		expect(parseVmMembers('')).toBeNull();
		expect(parseVmMembers(42)).toBeNull();
		expect(parseVmMembers('not json')).toBeNull();
		expect(parseVmMembers('[1,2]')).toBeNull(); // an array parses, but it is no census
	});

	it('degrades missing or malformed fields to zero rather than throwing', () => {
		const m = parseVmMembers(JSON.stringify({ functions: { pitch: { members: 'x', held: -3 } } }));
		expect(m).not.toBeNull();
		expect(m!.padCount).toBe(0);
		expect(m!.padClasses).toEqual({});
		expect(m!.hasMacroMappings).toBe(false);
		expect(m!.family).toBe(false);
		for (const fn of VM_FUNCTIONS) expect(m!.functions[fn]).toEqual({ members: 0, held: 0 });
	});

	it('never reports more held than members', () => {
		const m = parseVmMembers(census({}, { pitch: { members: 3, held: 9 } }));
		expect(m!.functions.pitch).toEqual({ members: 3, held: 3 });
	});
});

describe('vmFunctionState', () => {
	it('is unknown without a census — the Milestone 1 rendering', () => {
		for (const fn of VM_FUNCTIONS) expect(vmFunctionState(null, fn)).toBe('unknown');
		expect(vmFunctionState(undefined, 'pitch')).toBe('unknown');
	});

	it('reads the Jazz kit: FX none, Start live on 31 pads, Trnsp held, Time live', () => {
		const m = parseVmMembers(JAZZ);
		expect(vmFunctionState(m, 'fx1')).toBe('none');
		expect(vmFunctionState(m, 'fx2')).toBe('none');
		expect(vmFunctionState(m, 'fxType')).toBe('none');
		expect(vmFunctionState(m, 'start')).toBe('live');
		expect(vmFunctionState(m, 'pitch')).toBe('held');
		expect(vmFunctionState(m, 'attack')).toBe('live');
		expect(vmFunctionState(m, 'decay')).toBe('live');
	});

	it('is live while at least one member is enabled (a partially mapped kit)', () => {
		const m = parseVmMembers(census({}, { attack: { members: 24, held: 23 } }));
		expect(vmFunctionState(m, 'attack')).toBe('live');
	});

	it('is none on an unmapped DrumCell kit for nothing — every function is live', () => {
		const m = parseVmMembers(census());
		for (const fn of VM_FUNCTIONS) expect(vmFunctionState(m, fn)).toBe('live');
	});
});

describe('combineVmStates — an XY pad is as capable as its more capable axis', () => {
	it('one live axis makes the pad live', () => {
		expect(combineVmStates('live', 'none')).toBe('live');
		expect(combineVmStates('held', 'live')).toBe('live');
	});
	it('a held axis beats a missing one; two missing axes leave nothing', () => {
		expect(combineVmStates('held', 'none')).toBe('held');
		expect(combineVmStates('none', 'none')).toBe('none');
		expect(combineVmStates('held', 'held')).toBe('held');
	});
	it('no census on either axis is unknown', () => {
		expect(combineVmStates('unknown', 'live')).toBe('unknown');
		expect(combineVmStates('none', 'unknown')).toBe('unknown');
	});
});

describe('vmHeldBadge — the "held by macro" badge text', () => {
	it('is nothing when no member is held, "macro" when every member is', () => {
		expect(vmHeldBadge(parseVmMembers(census()), 'pitch')).toBeNull();
		expect(vmHeldBadge(parseVmMembers(JAZZ), 'pitch')).toBe('macro');
		expect(vmHeldBadge(parseVmMembers(JAZZ), 'start')).toBeNull();
	});

	it('carries the count when only some members are held — the rig\'s mapped Jazz kit reads 31/32', () => {
		// Live's macro on `32 Pad Kit Jazz` maps the 31 Simplers' Transpose
		// and leaves the Sampler pad free (measured 2026-09-07). The function
		// stays live (the surface moves the free pad) and the badge says why
		// the other 31 sit still.
		const m = parseVmMembers(census({}, { pitch: { members: 32, held: 31 } }));
		expect(vmFunctionState(m, 'pitch')).toBe('live');
		expect(vmHeldBadge(m, 'pitch')).toBe('31/32 macro');
	});

	it('sums an XY pad\'s two functions', () => {
		const m = parseVmMembers(census({}, { attack: { members: 24, held: 24 }, decay: { members: 24, held: 0 } }));
		expect(vmHeldBadge(m, 'attack', 'decay')).toBe('24/48 macro');
		expect(vmHeldBadge(m, 'attack')).toBe('macro');
		expect(vmHeldBadge(parseVmMembers(JAZZ), 'fx1', 'fx2')).toBeNull(); // no members at all
	});

	it('is nothing without a census', () => {
		expect(vmHeldBadge(null, 'pitch')).toBeNull();
	});
});

describe('vmStateAcceptsWrites', () => {
	it('lets live and unknown through, refuses held and none', () => {
		expect(vmStateAcceptsWrites('live')).toBe(true);
		expect(vmStateAcceptsWrites('unknown')).toBe(true);
		expect(vmStateAcceptsWrites('held')).toBe(false);
		expect(vmStateAcceptsWrites('none')).toBe(false);
	});
});

describe('hasPluginPads — the mode decision', () => {
	it('routes a Komplete Kontrol kit (AU / VST pads) to the macro grid', () => {
		expect(hasPluginPads(parseVmMembers(KOMPLETE))).toBe(true);
		expect(hasPluginPads(parseVmMembers(census({ padClasses: { PluginDevice: 2, DrumCell: 22 } })))).toBe(true);
	});

	it('keeps every native kit on the virtual macros, whatever its macros are named', () => {
		expect(hasPluginPads(parseVmMembers(census()))).toBe(false); // DrumCell, unmapped
		expect(hasPluginPads(parseVmMembers(JAZZ))).toBe(false); // Simpler + Sampler, mapped
		expect(hasPluginPads(parseVmMembers(census({ padClasses: { MultiSampler: 32 } })))).toBe(false);
		// Nested racks and Operators are non-members, not plugins: the view
		// dims their functions rather than switching experience.
		expect(hasPluginPads(parseVmMembers(census({ padClasses: { InstrumentGroupDevice: 4, Operator: 2 } })))).toBe(false);
	});

	it('answers false before the census lands, so a kit paints its controls first', () => {
		expect(hasPluginPads(null)).toBe(false);
		expect(hasPluginPads(undefined)).toBe(false);
	});
});

describe('kit profile — the view lays itself out by the dominant pad class', () => {
	it('names the dominant class, breaking ties on the name', () => {
		expect(dominantPadClass(parseVmMembers(JAZZ))).toBe('OriginalSimpler');
		expect(dominantPadClass(parseVmMembers(census()))).toBe('DrumCell');
		expect(dominantPadClass(parseVmMembers(census({ padClasses: { MultiSampler: 2, DrumCell: 2 } })))).toBe('DrumCell');
		expect(dominantPadClass(parseVmMembers(census({ padClasses: {} })))).toBeNull();
		expect(dominantPadClass(null)).toBeNull();
	});

	it('labels pad classes with Live\'s device names; a Multisample Mode Simpler is a Simpler', () => {
		expect(padClassLabel('OriginalSimpler')).toBe('Simpler');
		expect(padClassLabel('MultiSampler')).toBe('Sampler');
		expect(padClassLabel('DrumCell')).toBe('Drum Sampler');
		expect(padClassLabel('SomethingNew')).toBe('SomethingNew');
	});

	it('gives DrumCell kits (and no census) the full controls, Simpler kits the Simpler row, Sampler kits the Sampler row, plugin pads and mapped racks the macro grid', () => {
		expect(kitProfile(null)).toBe('full');
		expect(kitProfile(parseVmMembers(census()))).toBe('full');
		expect(kitProfile(parseVmMembers(census({ padClasses: {} })))).toBe('full');
		// The Jazz kit ships with its rack's macros mapped: those are its controls.
		expect(kitProfile(parseVmMembers(JAZZ))).toBe('macro-grid');
		expect(kitProfile(parseVmMembers(census({ hasMacroMappings: true, padClasses: { DrumCell: 24 } })))).toBe('macro-grid');
		expect(kitProfile(parseVmMembers(census({ padClasses: { OriginalSimpler: 16 } })))).toBe('simpler');
		expect(kitProfile(parseVmMembers(census({ padClasses: { MultiSampler: 32 } })))).toBe('sampler');
		// The Jazz kit's one Sampler pad does not outvote its 31 Simplers.
		expect(kitProfile(parseVmMembers(census({ padClasses: { OriginalSimpler: 31, MultiSampler: 1 } })))).toBe('simpler');
		expect(kitProfile(parseVmMembers(census({ padClasses: { Operator: 4 } })))).toBe('pitch-only');
		expect(kitProfile(parseVmMembers(KOMPLETE))).toBe('macro-grid');
	});

	it('summarises the kit: class name, then the pad count or the mixed histogram', () => {
		expect(kitClassSummary(parseVmMembers(JAZZ))).toEqual({ label: 'Simpler', detail: '31 Simpler · 1 Sampler' });
		expect(kitClassSummary(parseVmMembers(census({ padClasses: { MultiSampler: 32 }, padCount: 32 })))).toEqual({
			label: 'Sampler',
			detail: '32 pads'
		});
		expect(kitClassSummary(parseVmMembers(census({ padClasses: { OriginalSimpler: 1 }, padCount: 1 })))).toEqual({
			label: 'Simpler',
			detail: '1 pad'
		});
		expect(kitClassSummary(null)).toBeNull();
	});
});

describe('clampVmPitch', () => {
	it('rounds to whole semitones and clamps to the ±48 rail', () => {
		expect(clampVmPitch(12.4)).toBe(12);
		expect(clampVmPitch(-11.6)).toBe(-12);
		expect(clampVmPitch(60)).toBe(48);
		expect(clampVmPitch(-60)).toBe(-48);
		expect(clampVmPitch(0)).toBe(0);
	});
});

describe('rack macros — a kit of nested Instrument Racks (2026-09-07)', () => {
	it('names the family: vm.macro.<name>, the name verbatim', () => {
		expect(VM_MACRO_PREFIX).toBe('vm.macro.');
		expect(vmMacroProperty('Pitch Attack')).toBe('vm.macro.Pitch Attack');
		expect(INSTRUMENT_RACK_PAD_CLASS).toBe('InstrumentGroupDevice');
		// Not part of the up-front subscription set: the names come from the census.
		expect(VM_PROPERTIES.some((p) => p.startsWith(VM_MACRO_PREFIX))).toBe(false);
	});

	it('parses the macro list in rack order, dropping malformed and duplicate rows', () => {
		const m = parseVmMembers(ETHNIC)!;
		expect(m.macros.map((x) => x.name)).toEqual(['Attack', 'Release', 'Transpose', 'Osc', 'Pitch Attack', 'Pitch Amount', 'Room']);
		expect(m.macros[2]).toEqual({ name: 'Transpose', members: 32, held: 32 });
		expect(vmMacroCensus(m, 'Room')).toEqual({ name: 'Room', members: 20, held: 0 });
		expect(vmMacroCensus(m, 'Nope')).toBeUndefined();

		const odd = parseVmMembers(
			census({ macros: [{ name: 'A', members: 2, held: 9 }, { name: '' }, 7, null, { name: 'A', members: 5, held: 0 }, { name: 'B' }] })
		)!;
		expect(odd.macros).toEqual([
			{ name: 'A', members: 2, held: 2 },
			{ name: 'B', members: 0, held: 0 }
		]);
		// A census without the key (an older surface) reads as no macros.
		expect(parseVmMembers(JAZZ)!.macros).toEqual([]);
		expect(parseVmMembers(census({ macros: 'x' }))!.macros).toEqual([]);
	});

	it('names the macro pitch binds through, and pitch reads as a function of it', () => {
		const m = parseVmMembers(ETHNIC)!;
		expect(m.pitchMacro).toBe('Transpose');
		expect(vmFunctionState(m, 'pitch')).toBe('held');
		expect(parseVmMembers(JAZZ)!.pitchMacro).toBeNull();
		expect(parseVmMembers(census({ pitchMacro: '' }))!.pitchMacro).toBeNull();
		expect(parseVmMembers(census({ pitchMacro: 7 }))!.pitchMacro).toBeNull();
	});

	it('gives a nested-rack kit with named macros the rack-macros profile, and the card otherwise', () => {
		expect(kitProfile(parseVmMembers(ETHNIC))).toBe('rack-macros');
		// Nested racks with nothing but default macro names: the class card, everything dimmed.
		expect(kitProfile(parseVmMembers(census({ padClasses: { InstrumentGroupDevice: 4 }, padCount: 4 }, NO_MEMBERS)))).toBe('pitch-only');
		expect(kitClassSummary(parseVmMembers(census({ padClasses: { InstrumentGroupDevice: 4 }, padCount: 4 })))).toEqual({
			label: 'Instrument Rack',
			detail: '4 pads'
		});
		// A minority of rack pads does not change a Simpler kit's profile.
		expect(
			kitProfile(parseVmMembers(census({ padClasses: { OriginalSimpler: 20, InstrumentGroupDevice: 12 }, macros: ETHNIC_MACROS })))
		).toBe('simpler');
		// Plugin pads still win.
		expect(
			kitProfile(parseVmMembers(census({ padClasses: { InstrumentGroupDevice: 30, AuPluginDevice: 2 }, macros: ETHNIC_MACROS })))
		).toBe('macro-grid');
		expect(kitProfile(null)).toBe('full');
	});

	it('states a macro by name: unknown, none, held, live', () => {
		const m = parseVmMembers(ETHNIC);
		expect(vmMacroState(null, 'Attack')).toBe('unknown');
		expect(vmMacroState(m, 'Attack')).toBe('live');
		expect(vmMacroState(m, 'Transpose')).toBe('held');
		expect(vmMacroState(m, 'Room')).toBe('live');
		expect(vmMacroState(m, 'Nope')).toBe('none');
		expect(vmMacroState(parseVmMembers(census({ macros: [{ name: 'X', members: 3, held: 2 }] })), 'X')).toBe('live');
	});

	it('badges a held macro and a pair, like the functions do', () => {
		const m = parseVmMembers(ETHNIC);
		expect(vmMacroHeldBadge(m, 'Transpose')).toBe('macro');
		expect(vmMacroHeldBadge(m, 'Attack')).toBeNull();
		expect(vmMacroHeldBadge(m, 'Attack', 'Transpose')).toBe('32/64 macro');
		expect(vmMacroHeldBadge(null, 'Transpose')).toBeNull();
		expect(vmMacroHeldBadge(parseVmMembers(census({ macros: [{ name: 'X', members: 32, held: 5 }] })), 'X')).toBe('5/32 macro');
	});

	it('badges a macro only some pads carry with the pads it reaches', () => {
		const m = parseVmMembers(ETHNIC);
		expect(vmMacroCoverageBadge(m, 'Room')).toBe('20/32 pads');
		expect(vmMacroCoverageBadge(m, 'Attack')).toBeNull();
		expect(vmMacroCoverageBadge(m, 'Nope')).toBeNull(); // dimmed instead
		// A pair reaches what its wider axis reaches.
		expect(vmMacroCoverageBadge(m, 'Room', 'Attack')).toBeNull();
		expect(vmMacroCoverageBadge(m, 'Room', 'Nope')).toBe('20/32 pads');
		expect(vmMacroCoverageBadge(null, 'Room')).toBeNull();
	});

	it('lays the names out one slider each, in rack order', () => {
		// Transpose is the pitch macro: Trnsp stands in for it, so it is not in the row.
		expect(rackMacroLayout(parseVmMembers(ETHNIC))).toEqual([
			{ type: 'slider', name: 'Attack', label: 'Attack' },
			{ type: 'slider', name: 'Release', label: 'Release' },
			{ type: 'slider', name: 'Osc', label: 'Osc' },
			{ type: 'slider', name: 'Pitch Attack', label: 'Pitch Attack' },
			{ type: 'slider', name: 'Pitch Amount', label: 'Pitch Amount' },
			{ type: 'slider', name: 'Room', label: 'Room' }
		]);
		// Without a pitch macro every name is in the row.
		const noPitch = census({ macros: ETHNIC_MACROS, pitchMacro: null });
		expect(rackMacroLayout(parseVmMembers(noPitch)).map((c) => c.name)).toEqual(ETHNIC_MACROS.map((m) => m.name));
		expect(rackMacroLayout(null)).toEqual([]);
		expect(rackMacroLayout(parseVmMembers(JAZZ))).toEqual([]);
		// The wire name is the verbatim macro name even when the label is cleaned.
		expect(rackMacroLayout(parseVmMembers(census({ macros: [{ name: '1 Drive', members: 2, held: 0 }] })))).toEqual([
			{ type: 'slider', name: '1 Drive', label: 'Drive' }
		]);
	});

	it('reads the mapped macros off the census, and none from a surface that does not send them', () => {
		expect(mappedMacroIndices(parseVmMembers(census({ hasMacroMappings: true, mappedMacros: [1, 3, 16] })))).toEqual([1, 3, 16]);
		expect(mappedMacroIndices(parseVmMembers(census({ mappedMacros: [0, 17, 'x', 2.5, 4] })))).toEqual([4]);
		expect(mappedMacroIndices(parseVmMembers(census()))).toEqual([]);
		expect(mappedMacroIndices(null)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Per-pad rows and the pad grid (2026-09-08)
// ---------------------------------------------------------------------------

import {
	VM_PAD_PREFIX,
	clampVmValue,
	padColorCss,
	padTextCss,
	PAD_TEXT_ON_DARK,
	PAD_TEXT_ON_LIGHT,
	padGridShape,
	padGridNotes,
	padGridSlots,
	padGridCell,
	padTileLabel,
	padTileLabels,
	padTilePrefix,
	noteName,
	profileFunctions,
	vmPadProperty,
	vmValueKind
} from '$lib/services/drumVirtualMacros';

describe('the census pad list', () => {
	it('parses pads in note order, tolerating a missing name and an effect-only chain', () => {
		const raw = JSON.stringify({
			...JSON.parse(census()),
			pads: [
				{ note: 38, name: 'Snare Stick Hit 3', class: 'OriginalSimpler' },
				{ note: 36, name: 'Kick Tight Gen Purpose K', class: 'OriginalSimpler' },
				{ note: 40, class: null },
				{ note: 36, name: 'dup' },
				{ note: 200, name: 'out of range' },
				{ note: 'x', name: 'bad' },
				'junk'
			]
		});
		const m = parseVmMembers(raw)!;
		expect(m.pads).toEqual([
			{ note: 36, name: 'Kick Tight Gen Purpose K', className: 'OriginalSimpler', color: null },
			{ note: 38, name: 'Snare Stick Hit 3', className: 'OriginalSimpler', color: null },
			{ note: 40, name: '', className: null, color: null }
		]);
	});

	it('is empty when the surface lists none', () => {
		expect(parseVmMembers(census())!.pads).toEqual([]);
	});

	it("carries each pad's chain colour as an RGB int, and paints it as CSS", () => {
		const raw = JSON.stringify({
			...JSON.parse(census()),
			pads: [
				{ note: 36, name: 'Croydon Kick', class: 'DrumCell', color: 0x85961f },
				{ note: 38, name: 'Croydon Snare', class: 'DrumCell', color: 0xffffff },
				{ note: 40, name: 'Odd', class: 'DrumCell', color: -1 },
				{ note: 41, name: 'Odder', class: 'DrumCell', color: 'red' },
				{ note: 42, name: 'None', class: 'DrumCell' }
			]
		});
		const pads = parseVmMembers(raw)!.pads;
		expect(pads.map((p) => p.color)).toEqual([0x85961f, 0xffffff, null, null, null]);
		expect(padColorCss(pads[0])).toBe('#85961f');
		expect(padColorCss(pads[1])).toBe('#ffffff');
		expect(padColorCss({ note: 1, name: '', className: null, color: 0x00000f })).toBe('#00000f');
		expect(padColorCss(pads[2])).toBeNull();
		expect(padColorCss(null)).toBeNull();
	});

	it('picks dark text on a light fill and light text on a dark one', () => {
		expect(padTextCss(0xffffff)).toBe(PAD_TEXT_ON_LIGHT);
		expect(padTextCss(0x85961f)).toBe(PAD_TEXT_ON_LIGHT); // the olive kick, YIQ 131
		expect(padTextCss(0xe2a63b)).toBe(PAD_TEXT_ON_LIGHT);
		expect(padTextCss(0x000000)).toBe(PAD_TEXT_ON_DARK);
		expect(padTextCss(0x1f2a85)).toBe(PAD_TEXT_ON_DARK); // a deep blue, YIQ 49
		expect(padTextCss(0x8b0000)).toBe(PAD_TEXT_ON_DARK); // dark red, YIQ 42
	});
});

describe('pad rows', () => {
	it('names the rows after the note and the function, a rack macro included', () => {
		expect(VM.selectedPad).toBe('vm.selectedPad');
		expect(VM_PAD_PREFIX).toBe('vm.pad.');
		expect(vmPadProperty(38, 'decay')).toBe('vm.pad.38.decay');
		expect(vmPadProperty(38, 'macro.Attack')).toBe('vm.pad.38.macro.Attack');
	});

	it('moves t and pitch by delta and an enum absolutely, clamped to each range', () => {
		expect(vmValueKind('decay')).toBe('t');
		expect(vmValueKind('macro.Attack')).toBe('t');
		expect(vmValueKind('pitch')).toBe('pitch');
		expect(vmValueKind('fxType')).toBe('enum');
		expect(clampVmValue('decay', 1.4)).toBe(1);
		expect(clampVmValue('decay', -0.2)).toBe(0);
		expect(clampVmValue('pitch', 60.4)).toBe(48);
		expect(clampVmValue('pitch', 3.6)).toBe(4);
		expect(clampVmValue('fxType', 9)).toBe(8);
		expect(clampVmValue('fxType', 2.5)).toBe(3);
	});

	it('lists the functions each profile draws', () => {
		// Gain is on every profile but the macro grid (2026-09-08): a
		// plugin pad's level is not ours to reach.
		expect(profileFunctions('full')).toEqual(['fx1', 'fx2', 'fxType', 'attack', 'decay', 'start', 'pitch', 'filterFreq', 'filterRes', 'gain']);
		expect(profileFunctions('simpler')).toEqual(['attack', 'release', 'pitch', 'filterFreq', 'filterRes', 'gain']);
		expect(profileFunctions('sampler')).toContain('oscAmount');
		expect(profileFunctions('sampler')).toContain('gain');
		expect(profileFunctions('rack-macros', ['Attack', 'Room'])).toEqual(['macro.Attack', 'macro.Room', 'pitch', 'filterFreq', 'filterRes', 'gain']);
		expect(profileFunctions('pitch-only')).toEqual(['pitch', 'filterFreq', 'filterRes', 'gain']);
		expect(profileFunctions('macro-grid')).toEqual([]);
	});
});

describe('the pad grid layout', () => {
	const pad = (note: number, name = `P${note}`) => ({ note, name, className: 'DrumCell', color: null });

	it('stacks up to four down one column, then starts a second', () => {
		// The user's rule (2026-09-09): stack first, widen second. Five
		// reads 4 + 1, not 3 + 2 — a column that keeps its length as pads
		// arrive is a column a finger can keep its place in.
		expect(padGridShape(1)).toEqual({ columns: 1, rows: 1 });
		expect(padGridShape(4)).toEqual({ columns: 1, rows: 4 });
		expect(padGridShape(5)).toEqual({ columns: 2, rows: 4 });
		expect(padGridShape(8)).toEqual({ columns: 2, rows: 4 });
		expect(padGridShape(9)).toEqual({ columns: 3, rows: 4 }); // 4 + 4 + 1, not 3 + 3 + 3
		expect(padGridShape(12)).toEqual({ columns: 3, rows: 4 });
		// Past three columns the width would start eating the controls, so
		// the rows grow instead — the case that should hardly ever happen.
		expect(padGridShape(16)).toEqual({ columns: 3, rows: 6 });
		expect(padGridShape(0)).toEqual({ columns: 0, rows: 0 });
	});

	it('places each column bottom-up, lowest note at the foot', () => {
		// The first cut had them upside down (user, 2026-09-09). Rows are
		// 1-based from the top, so the FIRST note takes the LAST row.
		const cells = (n: number, rows: number) =>
			Array.from({ length: n }, (_, i) => padGridCell(i, rows)).map((c) => `${c.column}/${c.row}`);
		expect(cells(4, 4)).toEqual(['1/4', '1/3', '1/2', '1/1']);
		// A lone fifth pad sits at the FOOT of its column, in line with the
		// lowest note beside it — not at the top, where an auto flow puts it.
		expect(cells(5, 4)).toEqual(['1/4', '1/3', '1/2', '1/1', '2/4']);
		expect(cells(8, 4)).toEqual(['1/4', '1/3', '1/2', '1/1', '2/4', '2/3', '2/2', '2/1']);
		expect(cells(1, 1)).toEqual(['1/1']);
		expect(padGridCell(0, 0)).toEqual({ column: 1, row: 1 }); // no shape yet
	});

	it('draws the pads in play: the clip, the selection and every held pad, ascending', () => {
		// All three are equals — there is no paged fallback to hold in
		// reserve any more, so with nothing playing the grid is simply the
		// selected pad.
		expect(padGridNotes([36, 42], [60])).toEqual([36, 42, 60]);
		expect(padGridNotes([36, 42], [38, 40])).toEqual([36, 38, 40, 42]);
		expect(padGridNotes([36, 42], [42])).toEqual([36, 42]); // already there
		expect(padGridNotes([36, 42], [null])).toEqual([36, 42]);
		expect(padGridNotes(null, [60])).toEqual([60]);
		expect(padGridNotes([], [60, null, 36])).toEqual([36, 60]);
		expect(padGridNotes(null, [])).toEqual([]);
		expect(padGridNotes(undefined)).toEqual([]);
	});

	it('pairs each note with its pad, and leaves a note the kit has none for empty', () => {
		// An empty tile is what explains a ghosted control rather than
		// hiding it.
		const pads = [pad(36, 'Kick'), pad(42, 'Hat')];
		expect(padGridSlots(pads, [36, 40, 42])).toEqual([
			{ note: 36, pad: pads[0] },
			{ note: 40, pad: null },
			{ note: 42, pad: pads[1] }
		]);
		expect(padGridSlots([], [])).toEqual([]);
	});
});

describe('pad tile labels for a whole kit', () => {
	const pad = (note: number, name: string) => ({ note, name, className: 'DrumCell', color: null });
	const texts = (pads: ReturnType<typeof pad>[]) =>
		Object.fromEntries([...padTileLabels(pads)].map(([n, t]) => [n, t.sub ? `${t.label}|${t.sub}` : t.label]));

	it('names notes as Live does', () => {
		expect(noteName(36)).toBe('C1');
		expect(noteName(37)).toBe('C♯1');
		expect(noteName(60)).toBe('C3');
		expect(noteName(0)).toBe('C-2');
		expect(noteName(59)).toBe('B2');
	});

	it('shows no label when every chain has the same name — the colour and the position say which', () => {
		// Note names as the fallback were hidden at the user's request (2026-09-08).
		expect(texts([pad(36, 'Chase'), pad(37, 'Chase'), pad(38, 'Chase')])).toEqual({ 36: '', 37: '', 38: '' });
	});

	it('drops the words every pad shares — one or several — and keeps the voice', () => {
		expect(texts([pad(36, 'Chase Kick'), pad(38, 'Chase Snare'), pad(42, 'Chase Hat Closed')])).toEqual({ 36: 'Kick', 38: 'Snare', 42: 'Hat' });
		expect(texts([pad(36, 'Acuff Kit Kick'), pad(38, 'Acuff Kit Snare')])).toEqual({ 36: 'Kick', 38: 'Snare' });
		// A pad that is ONLY the shared words shows nothing; the rest keep their voice.
		expect(texts([pad(36, 'Chase'), pad(38, 'Chase Snare'), pad(42, 'Chase Hat')])).toEqual({ 36: '', 38: 'Snare', 42: 'Hat' });
	});

	it('tells colliding first words apart by their second word before reaching for the note', () => {
		expect(texts([pad(42, 'Hat Cl'), pad(44, 'Hat Ped'), pad(46, 'Hat Op'), pad(36, 'Kick')])).toEqual({
			36: 'Kick', 42: 'Hat Cl', 44: 'Hat Ped', 46: 'Hat Op'
		});
		expect(texts([pad(36, 'Kick'), pad(45, 'Tom Lo'), pad(47, 'Tom Mid'), pad(48, 'Tom Hi'), pad(50, 'Tom Hi 2')])).toEqual({
			36: 'Kick', 45: 'Tom Lo', 47: 'Tom Mid', 48: 'Tom Hi', 50: 'Tom Hi 2'
		});
		// Two pads whose second words also collide take a third, now that 16 characters fit on a two-line tile.
		expect(texts([pad(36, 'Kick Long Tail'), pad(38, 'Kick Long Body'), pad(42, 'Hat')])).toEqual({ 36: 'Kick Long Tail', 38: 'Kick Long Body', 42: 'Hat' });
		// Past the fit they stay as they are (no note name for now).
		expect(texts([pad(36, 'Kick Long Tail Deep'), pad(38, 'Kick Long Tail Tight'), pad(42, 'Hat')])).toEqual({ 36: 'Kick Long Tail', 38: 'Kick Long Tail', 42: 'Hat' });
	});

	it('keeps the kit-code rule; a voice two machines share reads the same on both', () => {
		expect(texts([pad(36, '606 Kick'), pad(38, '606 Snare'), pad(52, '808 Kick'), pad(54, '808 Snare')])).toEqual({
			36: 'Kick', 38: 'Snare', 52: 'Kick', 54: 'Snare'
		});
		expect(texts([pad(36, 'Kick Tight'), pad(38, 'Snare Stick Hit 3')])).toEqual({ 36: 'Kick', 38: 'Snare' });
	});

	it("drops a kit-maker's trailing punctuation and lets a second word tell the hats apart now that it fits", () => {
		// The rig's kit: "Kick:", "Snare:", "TOM: Tom 1" ... "Hi-Hat Closed" / "Hi-Hat Open" / "Hi-Hat Pedal".
		expect(texts([
			pad(36, 'Kick: 909'), pad(38, 'Snare: Tight'), pad(42, 'Hi-Hat Closed'), pad(44, 'Hi-Hat Pedal'), pad(46, 'Hi-Hat Open'),
			pad(45, 'TOM: Tom 1'), pad(47, 'TOM: Tom 2'), pad(48, 'TOM: Tom 3')
		])).toEqual({
			36: 'Kick 909', 38: 'Snare', 42: 'Hi-Hat Closed', 44: 'Hi-Hat Pedal', 46: 'Hi-Hat Open',
			45: 'TOM Tom 1', 47: 'TOM Tom 2', 48: 'TOM Tom 3'
		});
	});

	it('leaves an unnamed pad blank and a lone pad alone', () => {
		expect(texts([pad(36, ''), pad(38, 'Snare')])).toEqual({ 36: '', 38: 'Snare' });
		expect(texts([pad(40, 'Chase')])).toEqual({ 40: 'Chase' });
		expect(texts([])).toEqual({});
	});
});

describe('pad tile labels', () => {
	it('keep the first word, and a short number or letter after it', () => {
		expect(padTileLabel('Kick Tight Gen Purpose K')).toBe('Kick');
		expect(padTileLabel('Snare 2 Gen Purpose Kit')).toBe('Snare 2');
		expect(padTileLabel('Snare Stick Hit 3')).toBe('Snare');
		expect(padTileLabel('Tom Hi')).toBe('Tom');
		expect(padTileLabel('Hat Cl')).toBe('Hat');
		expect(padTileLabel('Bongo Hi')).toBe('Bongo');
		expect(padTileLabel('Conga Mt')).toBe('Conga');
		expect(padTileLabel('Hat Ped')).toBe('Hat');
		expect(padTileLabel('Tom Hi 2')).toBe('Tom');
		expect(padTileLabel('Vibraslapping')).toBe('Vibraslapping'); // fits the two-line tile
		expect(padTileLabel('Supercalifragilistic')).toBe('Supercalifragili'); // 16 and no more
		expect(padTileLabel('Vibraslapping', 9)).toBe('Vibraslap');
		expect(padTileLabel('')).toBe('');
		expect(padTileLabel('  ')).toBe('');
	});

	it('skip a leading kit code, as on the 606 + 808 kit, and a first word the whole kit shares', () => {
		// The rig's ` 606 + 808`: every first word is a machine code.
		expect(padTileLabel('606 Kick')).toBe('Kick');
		expect(padTileLabel('606 Snare')).toBe('Snare');
		expect(padTileLabel('808 Clap')).toBe('Clap');
		expect(padTileLabel('TR8 Rim')).toBe('Rim');
		expect(padTileLabel('606')).toBe('606'); // nothing else to show
		// A shared first word is the kit's name, not the voice.
		const acuff = [
			{ note: 36, name: 'Acuff Kick', className: 'OriginalSimpler', color: null },
			{ note: 38, name: 'Acuff Snare Rim', className: 'OriginalSimpler', color: null },
			{ note: 42, name: 'Acuff Hat', className: 'OriginalSimpler', color: null }
		];
		expect(padTilePrefix(acuff)).toBe('acuff');
		expect(padTileLabel('Acuff Snare Rim', 9, padTilePrefix(acuff))).toBe('Snare');
		expect(padTileLabel('Acuff Kick', 9, padTilePrefix(acuff))).toBe('Kick');
		// No shared word when the kit mixes voices-first names.
		expect(padTilePrefix([
			{ note: 36, name: 'Kick Tight Gen Purpose K', className: 'OriginalSimpler', color: null },
			{ note: 38, name: 'Snare Gen Purpose Kit #1', className: 'OriginalSimpler', color: null }
		])).toBeNull();
		expect(padTilePrefix([{ note: 36, name: 'Kick Tight', className: null, color: null }])).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// The playing clip on the grid (2026-09-08)
// ---------------------------------------------------------------------------

import { clipPadNotes, notesCrossed, MAX_PLAYHEAD_STEP_BEATS, PAD_FLASH_MS } from '$lib/services/drumVirtualMacros';

describe('the playing clip on the grid', () => {
	const note = (pitch: number, startBeats: number) => ({ pitch, startBeats, durationBeats: 0.25, velocity: 100 });

	it('lists the distinct pitches a clip plays, ascending', () => {
		expect(clipPadNotes([note(38, 1), note(36, 0), note(38, 2), note(42, 0.5), { pitch: 200 }, { pitch: 1.5 }])).toEqual([36, 38, 42]);
		expect(clipPadNotes([])).toEqual([]);
	});

	it('finds the notes the playhead crossed, once each, and follows the loop round', () => {
		const notes = [note(36, 0), note(42, 0.5), note(38, 1), note(42, 1.5), note(36, 2), note(42, 2.5), note(38, 3), note(42, 3.5)];
		expect(notesCrossed(notes, 0.9, 1.1, 0, 4)).toEqual([38]);
		expect(notesCrossed(notes, 0.4, 1.1, 0, 4)).toEqual([38, 42]); // 42 at 0.5 and 38 at 1
		expect(notesCrossed(notes, 1.0, 1.02, 0, 4)).toEqual([]); // the note AT prev was counted last time
		// The wrap: 3.9 → 0.1 crosses nothing at the end and the kick at 0.
		expect(notesCrossed(notes, 3.9, 0.1, 0, 4)).toEqual([36]);
		expect(notesCrossed(notes, 3.7, 0.6, 0, 4)).toEqual([36, 42]);
		// A step longer than a beat is a relaunch or a seek, not playback: nothing.
		expect(notesCrossed(notes, 0.1, 4.5, 0, 4)).toEqual([]);
		expect(notesCrossed(notes, 0.4, 1.6, 0, 4)).toEqual([]);
		expect(notesCrossed(notes, 3.9, 3.8, 0, 4)).toEqual([]); // "wrapped" 3.9 beats in one tick
		// A loop window inside the clip: the kick ON the loop start plays and
		// counts; the snare ON the loop end never plays and never counts.
		expect(notesCrossed(notes, 1.9, 2.6, 2, 3)).toEqual([36, 42]);
		expect(notesCrossed(notes, 2.9, 2.1, 2, 3)).toEqual([36]);
		expect(notesCrossed(notes, 0, 1, 0, 0)).toEqual([]);
		expect(PAD_FLASH_MS).toBeGreaterThan(66);
		expect(MAX_PLAYHEAD_STEP_BEATS).toBe(1);
	});
});

// --- effect presence per pad, and the per-pad profile (issue #491) ------------

import {
	parseVmPadFx,
	padChainEffects,
	padDeviceStubs,
	profileForPadClass,
	vmPadChainProperty,
	VM_PAD_FX
} from '$lib/services/drumVirtualMacros';

describe('vm.padFx — effect presence per pad', () => {
	const RAW = JSON.stringify({
		pads: {
			'36': [{ index: 0, class: 'DrumCell', name: 'Kick', type: 1 }, { index: 1, class: 'Hybrid', name: 'Reverb', type: 2 }],
			'38': [{ index: 0, class: 'OriginalSimpler', name: 'Snare', type: 1 }],
			'200': [{ index: 0, class: 'X', name: 'x', type: 1 }],
			'x': []
		}
	});

	it('names the rows', () => {
		expect(VM_PAD_FX).toBe('vm.padFx');
		expect(vmPadChainProperty(38)).toBe('vm.padChain.38');
	});

	it('parses the surface\'s shape, in chain order, dropping bad notes', () => {
		const map = parseVmPadFx(RAW)!;
		expect([...map.keys()].sort((a, b) => a - b)).toEqual([36, 38]);
		expect(map.get(36)).toEqual([
			{ index: 0, className: 'DrumCell', name: 'Kick', type: 1 },
			{ index: 1, className: 'Hybrid', name: 'Reverb', type: 2 }
		]);
		expect(parseVmPadFx(undefined)).toBeNull();
		expect(parseVmPadFx('{')).toBeNull();
		expect(parseVmPadFx('[]')).toBeNull();
		expect(parseVmPadFx('{"pads":[]}')).toBeNull();
	});

	it('lists a pad\'s effects without its instrument, and stands in for their records', () => {
		const map = parseVmPadFx(RAW);
		expect(padChainEffects(map, 36).map((d) => d.name)).toEqual(['Reverb']);
		expect(padChainEffects(map, 38)).toEqual([]);
		const stubs = padDeviceStubs(map, 'tracks/2/devices/0/pads/36', 36);
		expect(stubs).toHaveLength(1);
		expect(stubs[0].devicePath).toBe('tracks/2/devices/0/pads/36/devices/1');
		expect(stubs[0].className).toBe('Hybrid');
		expect(stubs[0].params.size).toBe(0);
	});
});

describe('profileForPadClass — the row a held pad earns', () => {
	it('follows the pad\'s own class on a native kit', () => {
		expect(profileForPadClass('MultiSampler', 'simpler')).toBe('sampler');
		expect(profileForPadClass('OriginalSimpler', 'full')).toBe('simpler');
		expect(profileForPadClass('DrumCell', 'sampler')).toBe('full');
		expect(profileForPadClass('Operator', 'full')).toBe('pitch-only');
	});

	it('keeps the kit\'s profile where a pad has nothing of its own to show', () => {
		expect(profileForPadClass(null, 'simpler')).toBe('simpler');
		expect(profileForPadClass('AuPluginDevice', 'full')).toBe('full');
		expect(profileForPadClass('InstrumentGroupDevice', 'rack-macros')).toBe('rack-macros');
		expect(profileForPadClass('DrumCell', 'macro-grid')).toBe('macro-grid');
	});
});
