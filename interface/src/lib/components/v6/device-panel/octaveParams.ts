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

/**
 * Response and Quality, 0..2 each, measured on the rig 2026-10-26 (the
 * shelf's "Pitch Shift.amxd" loaded and dumped: 3 Tone 0..100, 4 Response,
 * 5 Quality); their labels are the device file's `parameter_enum`, in order.
 */
export const OCTAVE_TONE_PARAM = 3;
export const OCTAVE_TONE_MAX = 100;
export const OCTAVE_RESPONSE_PARAM = 4;
export const OCTAVE_RESPONSE_STEPS = ['Fast', 'Balanced', 'Clean'] as const;
export const OCTAVE_QUALITY_PARAM = 5;
export const OCTAVE_QUALITY_STEPS = ['Full', 'Lite', 'Eco'] as const;

/** The four intervals worth having, the Pitch tile's X stops. */
export const OCTAVE_PITCH_STEPS = [
	{ label: '+12', value: 12 },
	{ label: '+7', value: 7 },
	{ label: '-5', value: -5 },
	{ label: '-12', value: -12 }
] as const;
