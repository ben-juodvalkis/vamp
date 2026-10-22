/**
 * Analog (`UltraAnalog`) — the parameter indices and option tables the
 * Analog view reads, measured off the running Live with
 * `owner/probes/device_dump.js` on 2026-10-22 (the "106 Bass 01" patch,
 * 172 parameters). Names in the comments are Live's own.
 *
 * Analog is two synths side by side: Osc 1 → Filter 1 → Amp 1 and
 * Osc 2 → Filter 2 → Amp 2, each with its own filter and amp envelope.
 * Every Voice 2 index is its Voice 1 twin plus 67, which the table below
 * spells out rather than computes so each number can be checked against
 * the dump by eye.
 */

export type AnalogVoice = 1 | 2;

export interface AnalogVoiceParams {
	oscOn: number;
	shape: number;
	octave: number;
	mode: number;
	pw: number;
	subSync: number;
	balance: number;
	level: number;
	filterOn: number;
	filterType: number;
	drive: number;
	freq: number;
	res: number;
	envAmount: number;
	fegAttack: number;
	fegDecay: number;
	fegSustain: number;
	fegRelease: number;
	ampLevel: number;
	aegAttack: number;
	aegDecay: number;
	aegSustain: number;
	aegRelease: number;
}

export const ANALOG_VOICE: Record<AnalogVoice, AnalogVoiceParams> = {
	1: {
		oscOn: 38, // OSC1 On/Off
		shape: 39, // OSC1 Shape        0..3
		octave: 40, // OSC1 Octave      -3..3
		mode: 42, // OSC1 Mode          0 Sub, 1 Sync
		pw: 46, // OSC1 PW
		subSync: 47, // O1 Sub/Sync
		balance: 48, // OSC1 Balance    0 = F2 … 1 = F1
		level: 52, // OSC1 Level
		filterOn: 53, // F1 On/Off
		filterType: 54, // F1 Type      0..9
		drive: 55, // F1 Drive          0..6
		freq: 57, // F1 Freq
		res: 59, // F1 Resonance
		envAmount: 62, // F1 Freq < Env -1..1
		fegAttack: 70, // FEG1 Attack
		fegDecay: 71, // FEG1 Decay
		fegSustain: 73, // FEG1 Sustain
		fegRelease: 75, // FEG1 Rel
		ampLevel: 78, // AMP1 Level
		aegAttack: 89, // AEG1 Attack
		aegDecay: 90, // AEG1 Decay
		aegSustain: 92, // AEG1 Sustain
		aegRelease: 94 // AEG1 Rel
	},
	2: {
		oscOn: 105,
		shape: 106,
		octave: 107,
		mode: 109,
		pw: 113,
		subSync: 114,
		balance: 115,
		level: 119,
		filterOn: 120,
		filterType: 121,
		drive: 122,
		freq: 124,
		res: 126,
		envAmount: 129,
		fegAttack: 137,
		fegDecay: 138,
		fegSustain: 140,
		fegRelease: 142,
		ampLevel: 145,
		aegAttack: 156,
		aegDecay: 157,
		aegSustain: 159,
		aegRelease: 161
	}
};

export const ANALOG_VOICES = 1; // Voices      0 Mono, 1..9 = 2..32
export const ANALOG_UNISON_ON = 16; // Unison On/Off
export const ANALOG_VIB_ON = 23; // Vib On/Off
export const ANALOG_GLIDE_ON = 30; // Glide On/Off
export const ANALOG_GLIDE_TIME = 31; // Glide Time
export const ANALOG_NOISE_ON = 34; // Noise On/Off
export const ANALOG_NOISE_BALANCE = 36; // Noise Balance  0 = F2 … 1 = F1
export const ANALOG_NOISE_LEVEL = 37; // Noise Level
export const ANALOG_F2_SLAVE = 127; // F2 Slave — Filter 2's cutoff follows Filter 1's

/** Voices step 3 is Live's "8": what Poly writes when the patch is Mono. */
export const ANALOG_POLY_VOICES = 3;

/** Live's names for OSC Shape 0..3, in order. */
export const ANALOG_SHAPES = ['Sine', 'Saw', 'Rect', 'Noise'] as const;
export const ANALOG_RECT = 2;

export const ANALOG_OCTAVES = [-3, -2, -1, 0, 1, 2, 3] as const;

/**
 * Live's ten filter types, `F1 Type` 0..9, as five families of two. The
 * view draws the families and a second tap on the lit one flips the
 * slope, so the index is `family * 2 + slope`.
 */
export const ANALOG_FILTER_TYPES = [
	'Low-pass 12dB/oct',
	'Low-pass 24dB/oct',
	'Band-pass 6dB/oct',
	'Band-pass 12dB/oct',
	'Notch 2-pole',
	'Notch 4-pole',
	'High-pass 12dB/oct',
	'High-pass 24dB/oct',
	'Formant 6dB/oct',
	'Formant 12dB/oct'
] as const;

export const ANALOG_FILTER_FAMILIES = [
	{ label: 'LP', slopes: ['12', '24'] },
	{ label: 'BP', slopes: ['6', '12'] },
	{ label: 'Notch', slopes: ['2p', '4p'] },
	{ label: 'HP', slopes: ['12', '24'] },
	{ label: 'Form', slopes: ['6', '12'] }
] as const;

/** The type a tap on `family` writes: a new family keeps the slope; the lit one flips it. */
export function filterTypeForFamily(current: number, family: number): number {
	const slope = current % 2;
	if (Math.floor(current / 2) === family) return family * 2 + (1 - slope);
	return family * 2 + slope;
}

/** Live's names for `F1 Drive` 0..6. */
export const ANALOG_DRIVES = ['Off', 'Sym1', 'Sym2', 'Sym3', 'Asym1', 'Asym2', 'Asym3'] as const;

/** Drive as amount (0..3) and character: Off is 0, Sym n is n, Asym n is 3 + n. */
export function driveAmount(drive: number): number {
	return drive === 0 ? 0 : ((drive - 1) % 3) + 1;
}

export function driveIsAsym(drive: number): boolean {
	return drive >= 4;
}

/** A tap on amount 0..3 keeps the character; Off is Off whatever it was. */
export function driveForAmount(current: number, amount: number): number {
	if (amount === 0) return 0;
	return driveIsAsym(current) ? 3 + amount : amount;
}

/** Asym toggles the character; from Off it lands on Asym1. */
export function driveToggleAsym(current: number): number {
	if (current === 0) return 4;
	return driveIsAsym(current) ? current - 3 : current + 3;
}

/**
 * Where a source goes, read off its Balance (0 = all to Filter 2, 1 = all
 * to Filter 1, Live's " F2" and " F1" at the ends). The chip cycles
 * F1 → both → F2 → F1, writing the ends and the middle exactly.
 */
export type AnalogRoute = 'F1' | 'F1+F2' | 'F2';

export function routeOf(balance: number): AnalogRoute {
	if (balance >= 0.99) return 'F1';
	if (balance <= 0.01) return 'F2';
	return 'F1+F2';
}

export function nextRouteBalance(balance: number): number {
	const route = routeOf(balance);
	if (route === 'F1') return 0.5;
	if (route === 'F1+F2') return 0;
	return 1;
}
