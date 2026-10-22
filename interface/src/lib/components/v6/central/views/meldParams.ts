/**
 * Meld (`InstrumentMeld`) — the parameter indices and option tables the
 * Meld view reads, measured off the running Live with
 * `owner/probes/device_dump.js` on 2026-10-22 (a fresh Meld, 129
 * parameters). Names in the comments are Live's own.
 *
 * Meld is two synths side by side, Engine A and Engine B, each its own
 * Osc → Filter → Amp with a mod envelope. Every Engine B index is its
 * Engine A twin plus 60, which the table below spells out rather than
 * computes so each number can be checked against the dump by eye. Every
 * parameter the view drives is natively 0..1 except the octave (-3..3) and
 * the two choosers.
 */

export type MeldEngine = 'A' | 'B';

export interface MeldEngineParams {
	on: number;
	octave: number;
	oscType: number;
	oscShape: number;
	oscTone: number;
	filterOn: number;
	filterType: number;
	freq: number;
	q: number;
	lbhn: number;
	ampAttack: number;
	ampDecay: number;
	ampRelease: number;
	ampSustain: number;
	modAttack: number;
	modDecay: number;
	modRelease: number;
	modPeak: number;
	modSustain: number;
	volume: number;
}

export const MELD_ENGINE: Record<MeldEngine, MeldEngineParams> = {
	A: {
		on: 1, // A On
		octave: 5, // A Octave            -3..3
		oscType: 7, // A Osc Type         0..24
		oscShape: 8, // A Osc Shape       (Oscillator_Macro1)
		oscTone: 9, // A Osc Tone         (Oscillator_Macro2)
		filterOn: 13, // A Filter On
		filterType: 14, // A Filter Type  0..16
		freq: 15, // A Filter Freq
		q: 16, // A Filter Q              (Filter_Macro1)
		lbhn: 17, // A Filter L-B-H-N     (Filter_Macro2; renamed with the type)
		ampAttack: 37, // A Amp Attack
		ampDecay: 38, // A Amp Decay
		ampRelease: 39, // A Amp Release
		ampSustain: 43, // A Amp Sustain
		modAttack: 45, // A Mod Attack
		modDecay: 46, // A Mod Decay
		modRelease: 47, // A Mod Release
		modPeak: 49, // A Mod Peak
		modSustain: 50, // A Mod Sustain
		volume: 58 // A Volume
	},
	B: {
		on: 61, // B On
		octave: 65, // B Octave
		oscType: 67, // B Osc Type
		oscShape: 68, // B Osc Shape
		oscTone: 69, // B Osc Tone
		filterOn: 73, // B Filter On
		filterType: 74, // B Filter Type
		freq: 75, // B Filter Freq
		q: 76, // B Filter Q
		lbhn: 77, // B Filter L-B-H-N
		ampAttack: 97, // B Amp Attack
		ampDecay: 98, // B Amp Decay
		ampRelease: 99, // B Amp Release
		ampSustain: 103, // B Amp Sustain
		modAttack: 105, // B Mod Attack
		modDecay: 106, // B Mod Decay
		modRelease: 107, // B Mod Release
		modPeak: 109, // B Mod Peak
		modSustain: 110, // B Mod Sustain
		volume: 118 // B Volume
	}
};

/** Shared by both engines. */
export const MELD_DRIVE = 122; // Drive
export const MELD_SPREAD = 126; // Voice Spread

/** The octave steps, Live's -3..3. */
export const MELD_OCTAVES = [-3, -2, -1, 0, 1, 2, 3] as const;

/** A Osc Type's 25 steps, Live's labels with the scale mark ("(♭♯)") dropped. */
export const MELD_OSC_TYPES = [
	'Basic Shapes',
	'Dual Basic Shapes',
	'Noisy Shapes',
	'Square Sync',
	'Square 5th',
	'Sub',
	'Swarm Sine',
	'Swarm Triangle',
	'Swarm Saw',
	'Swarm Square',
	'Harmonic Fm',
	'Fold Fm',
	'Squelch',
	'Simple Fm',
	'Chip',
	"Shepard's Pi",
	'Tarp',
	'Extratone',
	'Noise Loop',
	'Filtered Noise',
	'Bitgrunge',
	'Crackle',
	'Rain',
	'Bubble',
	'Chord'
] as const;

/** A Filter Type's 17 steps, shortened to fit a 4-wide grid. */
export const MELD_FILTER_TYPES = [
	'SVF 12',
	'SVF 24',
	'LP 12',
	'HP 12',
	'BP 12',
	'LP Cr',
	'LP Sw',
	'Filth',
	'Peak',
	'Notch',
	'Phase',
	'Redux',
	'Vowel',
	'Cmb+',
	'Cmb-',
	'Plate',
	'Membr'
] as const;

/**
 * What Live names `Filter L-B-H-N` (Filter_Macro2) under each filter type,
 * less the "A Filter " prefix. Measured 2026-10-22 by stepping A Filter
 * Type 0..16 on a running Meld and reading `parameters[17].name`.
 */
export const MELD_FILTER_EXTRA_NAMES = [
	'L-B-H-N', // SVF 12
	'L-B-H-N', // SVF 24
	'Drive', // LP 12
	'Drive', // HP 12
	'Drive', // BP 12
	'Drive', // LP Crunch
	'Lofi', // LP Switched Res
	'Drive', // Filth
	'Q', // Peak
	'Q', // Notch
	'Spread', // Phaser
	'Lofi', // Redux
	'Morph', // Vowel
	'Damp', // Comb +
	'Damp', // Comb -
	'Ratio', // Plate
	'Damp' // Membrane
] as const;

/** The oscillator type `step` places from `current`, wrapping. */
export function stepOscType(current: number, step: number): number {
	const n = MELD_OSC_TYPES.length;
	return (((Math.round(current) + step) % n) + n) % n;
}
