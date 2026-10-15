/**
 * Octave (Ben's Polyphonic Pitch Shifter, `Vamp Devices/Octave`), measured
 * off the running device: 1 Semitones, -12..12 in whole steps; 2 Mix,
 * 0..100, where 50 is dry and shifted both at full level and 100 the
 * shifted sound alone. The Pitch tile is the device's only control since
 * 2026-10-15 (the Octave panel went: it mirrored the tile's two axes).
 */
export const OCTAVE_PITCH_PARAM = 1;
export const OCTAVE_MIX_PARAM = 2;
export const OCTAVE_MIX_MAX = 100;

/** The four intervals worth having, the Pitch tile's X stops. */
export const OCTAVE_PITCH_STEPS = [
	{ label: '+12', value: 12 },
	{ label: '+7', value: 7 },
	{ label: '-5', value: -5 },
	{ label: '-12', value: -12 }
] as const;
