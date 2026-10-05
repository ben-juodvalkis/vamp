/**
 * Drum Rack virtual macros — what the census says a kit can do, and how
 * the Drum Rack view lays itself out for it: control states, held badges,
 * the kit profile, the rack-macro layout and the functions each profile
 * draws. Pure functions over the parsed census (`./wire`).
 */

import { cleanParameterName } from '$lib/utils/macroLayoutUtils';
import {
	EMPTY_CENSUS,
	PAD_MIXER_FUNCTIONS,
	type VmFunction,
	type VmFunctionCensus,
	type VmMacroCensus,
	type VmMembers
} from './wire';

/**
 * What a control bound to a function can do right now.
 *
 * - `unknown` — no census yet; behave as Milestone 1 (live).
 * - `live`    — at least one member is enabled: the gesture moves the kit.
 * - `held`    — members exist but every one is macro-held: read-only.
 * - `none`    — the kit has no member for this function: dimmed, inert.
 */
export type VmState = 'unknown' | 'live' | 'held' | 'none';

/** Pad instrument classes that route a kit to the macro grid. */
export const PLUGIN_PAD_CLASSES: readonly string[] = ['AuPluginDevice', 'PluginDevice'];

/** The state one member / held count pair describes. */
function censusState(census: VmFunctionCensus | undefined): VmState {
	const c = census ?? EMPTY_CENSUS;
	if (c.members <= 0) return 'none';
	if (c.held >= c.members) return 'held';
	return 'live';
}

/** The state of one function from the census (`unknown` without one). */
export function vmFunctionState(members: VmMembers | null | undefined, fn: VmFunction): VmState {
	if (!members) return 'unknown';
	// Every pad with a chain has a mixer strip; the census does not count them.
	if ((PAD_MIXER_FUNCTIONS as readonly string[]).includes(fn)) return 'live';
	return censusState(members.functions[fn]);
}

/** The census row for one pad-rack macro name, or `undefined` when the kit lacks it. */
export function vmMacroCensus(members: VmMembers | null | undefined, name: string): VmMacroCensus | undefined {
	return members?.macros.find((m) => m.name === name);
}

/**
 * The state of one rack macro by name: `unknown` without a census, `none`
 * for a name the kit does not carry, `held` when every pad rack's macro
 * of that name is itself macro-held (mapped from the Drum Rack's own
 * macro), `live` otherwise.
 */
export function vmMacroState(members: VmMembers | null | undefined, name: string): VmState {
	if (!members) return 'unknown';
	return censusState(vmMacroCensus(members, name));
}

/**
 * The "held by macro" badge for one or two functions (an XY pad shows the
 * pair): `null` when nothing is held, `'macro'` when every member is, and
 * `'<held>/<members> macro'` when only some are — the partially held case
 * the rig turned up (31/32 on the mapped Jazz kit), where the control stays
 * live for the free members and the count says why most pads sit still.
 */
export function vmHeldBadge(members: VmMembers | null | undefined, ...fns: VmFunction[]): string | null {
	if (!members) return null;
	return heldBadge(fns.map((fn) => members.functions[fn]));
}

/** The same badge for one or two rack macros (an XY pad shows the pair). */
export function vmMacroHeldBadge(members: VmMembers | null | undefined, ...names: string[]): string | null {
	if (!members) return null;
	return heldBadge(names.map((name) => vmMacroCensus(members, name)));
}

function heldBadge(rows: (VmFunctionCensus | undefined)[]): string | null {
	let held = 0;
	let total = 0;
	for (const row of rows) {
		const census = row ?? EMPTY_CENSUS;
		held += census.held;
		total += census.members;
	}
	if (held <= 0 || total <= 0) return null;
	return held >= total ? 'macro' : `${held}/${total} macro`;
}

/**
 * The "pads reached" badge for one or two rack macros: `null` when every
 * populated pad carries the name(s), else `'<pads>/<padCount> pads'` —
 * a hand-assembled kit where only some pads' racks have a "Room" macro
 * announces that a drag moves those pads only. One member per pad rack,
 * so the members count is the pad count for that name.
 */
export function vmMacroCoverageBadge(members: VmMembers | null | undefined, ...names: string[]): string | null {
	if (!members || members.padCount <= 0) return null;
	let reached = 0;
	for (const name of names) reached = Math.max(reached, vmMacroCensus(members, name)?.members ?? 0);
	if (reached <= 0 || reached >= members.padCount) return null;
	return `${reached}/${members.padCount} pads`;
}

/**
 * The state of a control that drives two functions at once (an XY pad).
 * It is as capable as its more capable axis: one live axis makes the pad
 * live (the other axis' writes are dropped by the surface), a held axis
 * beats a missing one, and two missing axes leave nothing to show.
 */
export function combineVmStates(a: VmState, b: VmState): VmState {
	if (a === 'unknown' || b === 'unknown') return 'unknown';
	if (a === 'live' || b === 'live') return 'live';
	if (a === 'held' || b === 'held') return 'held';
	return 'none';
}

/** A function whose writes would move something (or might — no census yet). */
export function vmStateAcceptsWrites(state: VmState): boolean {
	return state === 'live' || state === 'unknown';
}

/**
 * The Drum Rack's own macros that are mapped, as 1-based parameter indices
 * (parameter 0 is Device On) — the sliders the `macro-grid` profile draws.
 */
export function mappedMacroIndices(members: VmMembers | null | undefined): number[] {
	return members?.mappedMacros ?? [];
}

/**
 * Whether the kit's pads are plugin-hosted (Komplete Kontrol): true when any
 * pad instrument is an AU / VST plugin. Such a kit keeps the macro-grid
 * experience; the virtual macros have no member on it. A census that has
 * not arrived yet answers `false`, so a kit paints its virtual-macro
 * controls first and switches only once the surface says otherwise.
 */
export function hasPluginPads(members: VmMembers | null | undefined): boolean {
	if (!members) return false;
	return PLUGIN_PAD_CLASSES.some((cls) => (members.padClasses[cls] ?? 0) > 0);
}

/**
 * How the Drum Rack view lays itself out for a kit:
 *
 * - `full`       — the seven virtual-macro controls (DrumCell kits, and any
 *                  kit whose census has not arrived or names no pad class).
 * - `pitch-only` — the Trnsp slider plus a label naming the pad class
 *                  (Simpler kits, for now; the other functions are filled
 *                  in later — user's decision, 2026-09-07).
 * - `sampler`    — the Sampler row for a Sampler kit (2026-09-07): Osc,
 *                  Pitch-envelope and Time pads, Decay / Sustain / Spread
 *                  sliders and Trnsp, every control fanned out to each
 *                  pad's Sampler by name.
 * - `simpler`    — the Simpler row for a Simpler kit (2026-09-07): the
 *                  Time pad (Ve Attack / Ve Release) and Trnsp, fanned out
 *                  to every pad's Simpler by name.
 * - `rack-macros` — one control per pad-rack macro name (a kit whose pads
 *                  are nested Instrument Racks carrying named macros), laid
 *                  out like the Instrument Rack view; no Trnsp slot — its
 *                  pitch function has no member on such a kit, and the
 *                  kit's real transpose is the "Transpose" macro if it has
 *                  one. A nested-rack kit with no named macro at all stays
 *                  `pitch-only`, wearing the "Instrument Rack" card.
 * - `macro-grid` — one slider per mapped macro of the rack's own (a rack
 *                  with mapped macros, or plugin-hosted pads).
 */
export type KitProfile = 'full' | 'pitch-only' | 'sampler' | 'simpler' | 'rack-macros' | 'macro-grid';

/**
 * What the view calls each pad class. Live's own device names where they
 * exist; a class with no entry is shown by its LOM name so an unexpected
 * kit is described rather than hidden. "Multisample Mode" is not a class —
 * such a pad is an `OriginalSimpler` with a multisample map inside — so it
 * reads "Simpler" like any other.
 */
export const PAD_CLASS_LABELS: Readonly<Record<string, string>> = {
	DrumCell: 'Drum Sampler',
	OriginalSimpler: 'Simpler',
	MultiSampler: 'Sampler',
	InstrumentGroupDevice: 'Instrument Rack',
	Operator: 'Operator',
	AuPluginDevice: 'Plugin',
	PluginDevice: 'Plugin'
};

export function padClassLabel(className: string): string {
	return PAD_CLASS_LABELS[className] ?? className;
}

/**
 * The pad class most pads carry, or `null` without a census or on an empty
 * rack. Ties break on the class name so the answer is stable between two
 * emits of the same kit.
 */
export function dominantPadClass(members: VmMembers | null | undefined): string | null {
	if (!members) return null;
	let best: string | null = null;
	let bestCount = 0;
	for (const [cls, n] of Object.entries(members.padClasses)) {
		if (n > bestCount || (n === bestCount && best !== null && cls < best)) {
			best = cls;
			bestCount = n;
		}
	}
	return bestCount > 0 ? best : null;
}

/**
 * The profile ONE pad's class earns (issue #491, 2026-09-10): what the
 * Drum Rack view's row becomes while that pad is scoped — the Jazz kit's
 * Sampler pad gets the Sampler row under a hold, instead of the kit's
 * Simpler row with ghosted slots. A nested-rack pad keeps the kit's own
 * rack-macros row (its names are the census's, kit-wide); a plugin pad
 * has nothing per-pad to show and keeps the kit's profile too.
 */
export function profileForPadClass(className: string | null, kit: KitProfile): KitProfile {
	if (className === null || kit === 'macro-grid' || kit === 'rack-macros') return kit;
	if (PLUGIN_PAD_CLASSES.includes(className)) return kit;
	if (className === 'DrumCell') return 'full';
	if (className === SAMPLER_PAD_CLASS) return 'sampler';
	if (className === SIMPLER_PAD_CLASS) return 'simpler';
	return 'pitch-only';
}

export function kitProfile(members: VmMembers | null | undefined): KitProfile {
	if (members?.hasMacroMappings || hasPluginPads(members)) return 'macro-grid';
	const dominant = dominantPadClass(members);
	if (dominant === null || dominant === 'DrumCell') return 'full';
	if (dominant === INSTRUMENT_RACK_PAD_CLASS && (members?.macros.length ?? 0) > 0) return 'rack-macros';
	if (dominant === SAMPLER_PAD_CLASS) return 'sampler';
	if (dominant === SIMPLER_PAD_CLASS) return 'simpler';
	return 'pitch-only';
}

/** The pad class whose kits get the `sampler` profile (Live's Sampler). */
export const SAMPLER_PAD_CLASS = 'MultiSampler';

/** The pad class whose kits get the `simpler` profile (Live's Simpler, Multisample Mode included). */
export const SIMPLER_PAD_CLASS = 'OriginalSimpler';

/** The pad class whose kits get the `rack-macros` profile. */
export const INSTRUMENT_RACK_PAD_CLASS = 'InstrumentGroupDevice';

/** One control of the `rack-macros` layout. `name` is the wire name (the verbatim macro name). */
export type RackMacroControl = { type: 'slider'; name: string; label: string };

/**
 * The `rack-macros` layout from the census: one slider per pad-rack macro
 * name, in rack order. The macro `pitch` binds through (`pitchMacro`) is
 * left out: the Trnsp slider stands in its place, in semitones.
 */
export function rackMacroLayout(members: VmMembers | null | undefined): RackMacroControl[] {
	const names = (members?.macros ?? []).map((m) => m.name).filter((name) => name !== members?.pitchMacro);
	return names.map((name) => ({ type: 'slider', name, label: cleanParameterName(name) }));
}

/**
 * The label a `pitch-only` kit wears: the dominant class's name, and
 * underneath either the pad count or, on a mixed kit, the whole histogram
 * ("31 Simpler · 1 Sampler" — the Jazz kit as Ableton ships it).
 */
export function kitClassSummary(members: VmMembers | null | undefined): { label: string; detail: string } | null {
	const dominant = dominantPadClass(members);
	if (!members || dominant === null) return null;
	const entries = Object.entries(members.padClasses)
		.filter(([, n]) => n > 0)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	const detail =
		entries.length > 1
			? entries.map(([cls, n]) => `${n} ${padClassLabel(cls)}`).join(' · ')
			: `${members.padCount} ${members.padCount === 1 ? 'pad' : 'pads'}`;
	return { label: padClassLabel(dominant), detail };
}

/**
 * The functions a profile's controls draw — the pad rows a scoped view
 * subscribes for the pads it is holding. Rack macros ride as `macro.<name>`.
 */
export function profileFunctions(profile: KitProfile, macroNames: readonly string[] = []): string[] {
	switch (profile) {
		case 'full':
			return ['fx1', 'fx2', 'fxType', 'attack', 'decay', 'start', 'pitch', 'filterFreq', 'filterRes', 'gain'];
		case 'simpler':
			return ['attack', 'release', 'pitch', 'filterFreq', 'filterRes', 'gain'];
		case 'sampler':
			return [
				'oscAmount',
				'oscCoarse',
				'pitchEnvAmount',
				'pitchEnvAttack',
				'attack',
				'release',
				'decay',
				'sustain',
				'spread',
				'selector',
				'pitch',
				'filterFreq',
				'filterRes',
				'gain'
			];
		case 'rack-macros':
			return [...macroNames.map((n) => `macro.${n}`), 'pitch', 'filterFreq', 'filterRes', 'gain'];
		case 'pitch-only':
			return ['pitch', 'filterFreq', 'filterRes', 'gain'];
		default:
			return [];
	}
}
