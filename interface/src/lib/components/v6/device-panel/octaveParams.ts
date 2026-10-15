/**
 * Octave (Ben's Polyphonic Pitch Shifter, `Vamp Devices/Octave`), measured
 * off the running device: 1 Semitones, -12..12 in whole steps; 2 Mix,
 * 0..100, where 50 is dry and shifted both at full level and 100 the
 * shifted sound alone. The Pitch tile and the Pitch view's Octave panel
 * share these.
 */
export const OCTAVE_PITCH_PARAM = 1;
export const OCTAVE_MIX_PARAM = 2;
export const OCTAVE_MIX_MAX = 100;

/** The four intervals worth having, top-down as the panel's tab draws them. */
export const OCTAVE_PITCH_STEPS = [
	{ label: '+12', value: 12 },
	{ label: '+7', value: 7 },
	{ label: '-5', value: -5 },
	{ label: '-12', value: -12 }
] as const;

/** The device saves -12; a load from the app starts an octave up instead (user, 2026-10-05). */
export const OCTAVE_LOAD_PITCH = 12;

/** The step nearest a pitch, so a pitch set by hand still lights the closest stop. */
export function nearestOctaveStep(pitch: number): number {
	return OCTAVE_PITCH_STEPS.reduce(
		(best, step, i) =>
			Math.abs(step.value - pitch) < Math.abs(OCTAVE_PITCH_STEPS[best].value - pitch) ? i : best,
		0
	);
}
