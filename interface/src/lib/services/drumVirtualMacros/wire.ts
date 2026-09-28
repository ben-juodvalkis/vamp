/**
 * Drum Rack virtual macros — the UI-side vocabulary (ADR-428, Milestone 1b).
 *
 * The surface owns every whole-kit gesture on a `DrumGroupDevice` as a
 * *virtual macro*: a musical function (`pitch`, `fx1`, …) bound per pad
 * instrument class by parameter name, exposed over the property channel
 * as `vm.<function>` (wire-protocol §2.6). Beside the seven functions it
 * publishes a read-only census, `vm.members`, that says what the kit can
 * actually do:
 *
 * ```json
 * {"padCount": 32,
 *  "padClasses": {"OriginalSimpler": 31, "MultiSampler": 1},
 *  "hasMacroMappings": true,
 *  "family": false,
 *  "functions": {"pitch": {"members": 32, "held": 32}, "start": {"members": 31, "held": 0}, …}}
 * ```
 *
 * Every consumer of the virtual macros — the Drum Rack view, the FX-grid
 * Pitch slider, the ±12 clip buttons — decides the same things from it, so
 * the decisions live here and nowhere else:
 *
 * - **Which profile.** The Drum Rack view lays itself out by the kit's
 *   dominant pad class (user's decision, 2026-09-07): a DrumCell kit gets
 *   the full seven controls; a Simpler or Sampler kit gets, for now, the
 *   Trnsp slider and a label naming the pad class — its other functions
 *   are filled in later. A Simpler in Live's "Multisample Mode" exposes
 *   exactly a Simpler's parameters, so it is a Simpler here; the census
 *   cannot and need not tell them apart. A kit whose pads are nested
 *   **Instrument Racks** (an Ableton-pack kit such as `Ethnic Drums`) has
 *   no member for any of the seven — the parameters they bind sit inside
 *   the racks, macro-held — but every pad carries a rack with named
 *   macros, so the census lists those names (`macros`, in rack order)
 *   and the view renders them the way the Instrument Rack view renders a
 *   rack on the track: one control per name, a shared first word pairing
 *   two names into an XY pad, each writing `vm.macro.<name>`, which the
 *   surface fans out to every pad rack's macro of that name
 *   (`rack-macros`, 2026-09-07). The Drum Rack's own top-level macros
 *   are not used: on such kits they are named but unmapped. The pad
 *   racks' transpose-named macro is the kit's `pitch` member (the
 *   surface binds it in semitones under the ±48 convention) and the
 *   census names it as `pitchMacro`; the view shows Trnsp in that
 *   macro's place, so the sequencer's octave, the ±12 buttons and the
 *   FX-grid Pitch all move the same knob in semitones.
 *
 * - **Which experience.** Pads hosted by a plugin (`AuPluginDevice` /
 *   `PluginDevice` — the Komplete Kontrol kits) have no bindings at all; the
 *   rack's own macros are the only handle on them, so those kits keep the
 *   macro grid, and their FX-grid Pitch slider and ±12 buttons are inert.
 *   Transitional (user's decision, 2026-09-07): Komplete Kontrol is being
 *   removed from the rig, so no plugin-pad binding or name-based fallback
 *   will be written; the macro-grid mode leaves with that migration. Every
 *   native pad type (DrumCell, Simpler, Sampler, mixed) gets the
 *   virtual-macro controls. The decision is made from the pad classes,
 *   never from macro names.
 * - **Non-member.** A function the kit has no member parameter for (FX on a
 *   Simpler kit, Start on a Sampler kit) renders dimmed and inert.
 * - **Held.** A function every member of which is macro-held
 *   (`is_enabled == False`) renders read-only with a "held by macro" state;
 *   the surface would skip every write anyway. A still-mapped non-family kit
 *   shows the function held until the kit is unmapped — by decision there is
 *   no name-based macro fallback. **Partially held** (measured on the rig:
 *   the Jazz kit's Transpose macro maps its 31 Simplers and leaves the
 *   Sampler pad free, so pitch reads 31 held of 32) stays live — the
 *   surface moves the free members — and wears the same badge with the
 *   count, so a drag that moves one pad of 32 is announced, not mysterious.
 *
 * Until the census arrives (`undefined`, or a mock that doesn't answer it)
 * every function is `unknown` and renders exactly as Milestone 1 did.
 */

export const VM = {
	fx1: 'vm.fx1',
	fx2: 'vm.fx2',
	fxType: 'vm.fxType',
	attack: 'vm.attack',
	decay: 'vm.decay',
	release: 'vm.release',
	start: 'vm.start',
	pitch: 'vm.pitch',
	sustain: 'vm.sustain',
	oscAmount: 'vm.oscAmount',
	oscCoarse: 'vm.oscCoarse',
	pitchEnvAmount: 'vm.pitchEnvAmount',
	pitchEnvAttack: 'vm.pitchEnvAttack',
	spread: 'vm.spread',
	filterFreq: 'vm.filterFreq',
	filterRes: 'vm.filterRes',
	gain: 'vm.gain',
	members: 'vm.members',
	/** Live's selected pad on the rack, as a MIDI note (2026-09-08). Read, write, and re-emitted when Live's selection moves. */
	selectedPad: 'vm.selectedPad'
} as const;

/**
 * The fixed functions. `release` and the Sampler row (2026-09-07) —
 * `sustain`, `oscAmount` (Osc On + O Volume), `oscCoarse`,
 * `pitchEnvAmount` (Pe On + Pe < Env, centre = no envelope),
 * `pitchEnvAttack` (Pe Attack), `spread` — are the sample instruments'; a Drum
 * Sampler has none of them, so they are `none` on DrumCell kits.
 *
 * `gain` (2026-09-08) is how loud a pad is, and the one function every
 * kit shape can answer: `Volume` on DrumCell (0..1), Simpler and Sampler
 * (−36..36 dB), and on a kit of nested Instrument Racks — where those
 * parameters sit inside the racks, out of a name lookup's reach — the
 * pad's own **chain volume**. The `t` fan-out spans each member's own
 * range, so one slider is "how loud" whatever the pad measures it in.
 * Plugin-hosted pads (the macro grid) have no gain member and no slider.
 *
 * `filterFreq` / `filterRes` (2026-09-09) are the filter as one XY pad —
 * cutoff across, resonance up. `filterFreq` carries the filter's own
 * switch as its first member, like `oscAmount` carries `Osc On`, but that
 * switch never follows the floor back off: cutoff at the bottom with the
 * filter ON is closed and silent, and switching it off there would open
 * it wide instead. Resonance is NOT 0..1 everywhere — a Simpler's tops
 * out at 1.25 — which costs nothing, since the fan-out spans each
 * member's own range.
 */
export type VmFunction =
	| 'fx1'
	| 'fx2'
	| 'fxType'
	| 'attack'
	| 'decay'
	| 'release'
	| 'start'
	| 'pitch'
	| 'sustain'
	| 'oscAmount'
	| 'oscCoarse'
	| 'pitchEnvAmount'
	| 'pitchEnvAttack'
	| 'spread'
	| 'filterFreq'
	| 'filterRes'
	| 'gain';

export const VM_FUNCTIONS: readonly VmFunction[] = [
	'fx1',
	'fx2',
	'fxType',
	'attack',
	'decay',
	'release',
	'start',
	'pitch',
	'sustain',
	'oscAmount',
	'oscCoarse',
	'pitchEnvAmount',
	'pitchEnvAttack',
	'spread',
	'filterFreq',
	'filterRes',
	'gain'
] as const;

/**
 * The Simpler row (2026-09-07): what the regular Simpler view's bottom row
 * needs on a kit, for now — the Time pad (Ve Attack across, Ve Release
 * up, the regular view's own axes) and Trnsp (Transpose, ±48), drawn by `SimplerControlsRow` on a
 * Simpler kit. User's decision, 2026-09-07: enough of the parameters for
 * now; the rest of that row (Loop, Fade, Gain, the brace) stays per-sample.
 */
export type SimplerRowControl = 'attack' | 'release' | 'pitch';

export type SimplerRowSlot = 'time' | 'pitch';

/**
 * The Sampler row (2026-09-07): Live's Pitch/Osc tab as one row of
 * controls, drawn by `SamplerControlsRow` for a single Sampler (its own
 * parameters, by name) and for a Sampler kit (the functions above, fanned
 * out to every pad). The control ids are the function names.
 */
export type SamplerRowControl =
	| 'oscAmount'
	| 'oscCoarse'
	| 'pitchEnvAmount'
	| 'pitchEnvAttack'
	| 'attack'
	| 'release'
	| 'decay'
	| 'sustain'
	| 'spread'
	| 'pitch';

/** The row's slots, for badges: two pads share a slot with their pair. */
export type SamplerRowSlot =
	| 'osc'
	| 'pitchEnv'
	| 'attack'
	| 'decay'
	| 'sustain'
	| 'release'
	| 'spread'
	| 'pitch';

/** The Sampler parameter each control drives, by name — the same names the surface binds on a pad. */
export const SAMPLER_ROW_PARAM_NAMES: Readonly<Record<SamplerRowControl, string>> = {
	oscAmount: 'O Volume',
	oscCoarse: 'O Coarse',
	pitchEnvAmount: 'Pe < Env',
	pitchEnvAttack: 'Pe Attack',
	attack: 'Ve Attack',
	release: 'Ve Release',
	decay: 'Ve Decay',
	sustain: 'Ve Sustain',
	spread: 'Spread',
	pitch: 'Transpose'
};

/** A section's switch, written with its amount. */
export const SAMPLER_ROW_SECTION_SWITCH: Readonly<Partial<Record<SamplerRowControl, string>>> = {
	oscAmount: 'Osc On',
	pitchEnvAmount: 'Pe On'
};

/**
 * The oscillator's switch follows its amount (on above 1/127 of travel,
 * off at the floor — zero amount is silence); the pitch envelope's amount
 * is bipolar, its floor is −48 semitones, so its switch only ever turns on.
 */
export const SAMPLER_ROW_SWITCH_OFF_AT_FLOOR: ReadonlySet<SamplerRowControl> = new Set<SamplerRowControl>(['oscAmount']);

/**
 * One MIDI step of travel — the threshold above which a section's amount
 * counts as "on". Shared beyond the Sampler row since 2026-09-12:
 * `DriftCentralView`'s Noise level writes `Mixer_NoiseOn` by the same
 * rule, so the two sections feel identical under a finger.
 */
export const SECTION_SWITCH_ON_ABOVE = 1 / 127;

/** Every `vm.*` property a Drum Rack consumer subscribes: the functions plus the census. */
export const VM_PROPERTIES: readonly string[] = [...VM_FUNCTIONS.map((fn) => VM[fn]), VM.members];

/**
 * The rack-macro family: `vm.macro.<name>` on a Drum Rack whose pads are
 * nested Instrument Racks — one `t` (0..1) property per macro name the
 * census lists, the name riding verbatim after the prefix. Subscribed
 * per kit from the census rather than up front.
 */
export const VM_MACRO_PREFIX = 'vm.macro.';

export function vmMacroProperty(name: string): string {
	return VM_MACRO_PREFIX + name;
}

/** `vm.pitch` is whole semitones on this range, centre 0 (same rail as Trnsp). */
export const VM_PITCH_MIN = -48;

export const VM_PITCH_MAX = 48;

export interface VmFunctionCensus {
	/** Member parameters resolved for the function across every pad. */
	members: number;
	/** Of those, how many are macro-held (`is_enabled == False`). */
	held: number;
}

/** One pad-rack macro name the kit carries, with the same counts as a function. */
export interface VmMacroCensus extends VmFunctionCensus {
	name: string;
}

/** One pad the census lists (2026-09-08): what a pad grid draws from. */
export interface VmPad {
	/** MIDI note — the pad's identity on the wire (`vm.pad.<note>.<fn>`, `vm.selectedPad`). */
	note: number;
	/** Live's own name for the pad (the chain's), capped by the surface; '' when unknown or dropped for size. */
	name: string;
	/** The first instrument's class on the pad, or null on an effect-only chain. */
	className: string | null;
	/** The chain's colour as Live paints the pad — an RGB int (0xRRGGBB) — or null. */
	color: number | null;
}

export interface VmMembers {
	padCount: number;
	padClasses: Record<string, number>;
	hasMacroMappings: boolean;
	family: boolean;
	functions: Record<VmFunction, VmFunctionCensus>;
	/** The pad racks' named macros in rack order; empty on any kit without nested racks. */
	macros: VmMacroCensus[];
	/** The pad-rack macro `pitch` binds through ("Transpose"), or `null`. */
	pitchMacro: string | null;
	/** The pads carrying a chain, in note order (2026-09-08); empty before the surface lists them. */
	pads: VmPad[];
}

export const EMPTY_CENSUS: VmFunctionCensus = { members: 0, held: 0 };

function toCount(x: unknown): number {
	return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0;
}

/**
 * Parse a `vm.members` property value. The wire carries a JSON string;
 * anything else (undefined before the cold read, a non-string, malformed
 * JSON) is `null` — "no census", which every state helper treats as
 * `unknown`. Missing or malformed fields degrade to zero / false rather
 * than throwing: a census that cannot be read must never disable a kit
 * the surface can drive.
 */
export function parseVmMembers(raw: unknown): VmMembers | null {
	if (typeof raw !== 'string' || raw === '') return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	const obj = parsed as Record<string, unknown>;

	const padClasses: Record<string, number> = {};
	const rawClasses = obj.padClasses;
	if (rawClasses && typeof rawClasses === 'object') {
		for (const [cls, n] of Object.entries(rawClasses as Record<string, unknown>)) {
			padClasses[cls] = toCount(n);
		}
	}

	const rawFns = (obj.functions && typeof obj.functions === 'object' ? obj.functions : {}) as Record<
		string,
		unknown
	>;
	const functions = {} as Record<VmFunction, VmFunctionCensus>;
	for (const fn of VM_FUNCTIONS) {
		const entry = rawFns[fn];
		if (entry && typeof entry === 'object') {
			const e = entry as Record<string, unknown>;
			const members = toCount(e.members);
			functions[fn] = { members, held: Math.min(members, toCount(e.held)) };
		} else {
			functions[fn] = { ...EMPTY_CENSUS };
		}
	}

	const macros: VmMacroCensus[] = [];
	if (Array.isArray(obj.macros)) {
		const seen = new Set<string>();
		for (const entry of obj.macros as unknown[]) {
			if (!entry || typeof entry !== 'object') continue;
			const e = entry as Record<string, unknown>;
			if (typeof e.name !== 'string' || e.name === '' || seen.has(e.name)) continue;
			seen.add(e.name);
			const members = toCount(e.members);
			macros.push({ name: e.name, members, held: Math.min(members, toCount(e.held)) });
		}
	}

	const pads: VmPad[] = [];
	if (Array.isArray(obj.pads)) {
		const seen = new Set<number>();
		for (const entry of obj.pads as unknown[]) {
			if (!entry || typeof entry !== 'object') continue;
			const e = entry as Record<string, unknown>;
			const note = typeof e.note === 'number' && Number.isInteger(e.note) ? e.note : NaN;
			if (!(note >= 0 && note <= 127) || seen.has(note)) continue;
			seen.add(note);
			const color = e.color;
			pads.push({
				note,
				name: typeof e.name === 'string' ? e.name : '',
				className: typeof e.class === 'string' && e.class !== '' ? e.class : null,
				color: typeof color === 'number' && Number.isInteger(color) && color >= 0 && color <= 0xffffff ? color : null
			});
		}
		pads.sort((a, b) => a.note - b.note);
	}

	return {
		padCount: toCount(obj.padCount),
		padClasses,
		hasMacroMappings: obj.hasMacroMappings === true,
		family: obj.family === true,
		functions,
		macros,
		pitchMacro: typeof obj.pitchMacro === 'string' && obj.pitchMacro !== '' ? obj.pitchMacro : null,
		pads
	};
}

/** Clamp a semitone request onto `vm.pitch`'s rail as a whole number. */
export function clampVmPitch(semitones: number): number {
	const rounded = Math.round(semitones);
	return Math.max(VM_PITCH_MIN, Math.min(VM_PITCH_MAX, rounded));
}

// ---------------------------------------------------------------------------
// Per-pad rows and the pad grid (2026-09-08)
//
// `vm.pad.<note>.<fn>` is one pad's value of a function, absolute, in the
// function's own units; the surface stores a write as that pad's deviation
// from the kit value, so the kit control keeps working as a gesture over a
// kit that keeps its shape.
//
// THE GRID IS NOT LIVE'S PAD VIEW (2026-09-09). It was: four columns of
// four consecutive notes, lowest bottom-left, sixteen to a page with two
// arrows — Live's own layout, so the muscle memory would transfer. The
// user's call after living with it: sixteen tiles is small and cluttered,
// and most of them are pads nothing is doing anything with. The grid now
// draws **only the pads in play** — the playing clip's, plus Live's
// selected pad and any pad a finger is holding — which in practice is a
// handful, so the tiles can be bigger and the column narrower.
//
// The paging went with it. What that costs is the ability to reach an
// arbitrary pad from the interface: a pad the clip does not play and Live
// has not selected is not on screen, so it cannot be tapped or held. The
// way to it is Live's own rack (or the Move), and the grid follows.
// ---------------------------------------------------------------------------

export const VM_PAD_PREFIX = 'vm.pad.';

/** The property for one pad's value of a function — `fn` is a fixed function name or `macro.<name>`. */
export function vmPadProperty(note: number, fn: string): string {
	return `${VM_PAD_PREFIX}${note}.${fn}`;
}

/** How a function's value moves under a multi-pad drag: `t` and `pitch` by delta, an `enum` (fxType) absolutely. */
export type VmValueKind = 't' | 'pitch' | 'enum';

export function vmValueKind(fn: string): VmValueKind {
	if (fn === 'pitch') return 'pitch';
	if (fn === 'fxType') return 'enum';
	return 't';
}

export function clampVmValue(fn: string, value: number): number {
	switch (vmValueKind(fn)) {
		case 'pitch':
			return clampVmPitch(Math.round(value));
		case 'enum':
			return Math.max(0, Math.min(8, Math.round(value)));
		default:
			return Math.max(0, Math.min(1, value));
	}
}
