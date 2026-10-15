/**
 * GlitchLoop (the owner's PitchLoop89 rebuild, the glitchloop repo's
 * dist/GlitchLoop.amxd): the parameters the Glitch tile and view drive.
 *
 * Resolved by NAME on the loaded device, because the device gains
 * parameters build to build (97, then 109, then 153 in a week) and Live
 * lists them by long name, so every addition shifts the indices. The
 * index here is the fallback, used before the device has loaded (a
 * pending write needs an index): measured off the running Live with
 * `owner/probes/device_dump.js master/devices/1` on 2026-10-15, the
 * 153-parameter build.
 *   13 Clock        0..10, quantized (eleven detents)
 *   14 Pitch L    -24..24 semitones
 *   15 Pitch R    -24..24
 *   19 Dry/Wet      0..100
 *   23 Feedback L   0..120
 *   24 Feedback R   0..120
 */
export const GLITCH_LOOP_PARAMS = {
	clock: { name: 'Clock', index: 13, min: 0, max: 10 },
	pitchLeft: { name: 'Pitch L', index: 14 },
	pitchRight: { name: 'Pitch R', index: 15 },
	mix: { name: 'Dry/Wet', index: 19, max: 100 },
	feedbackLeft: { name: 'Feedback L', index: 23, max: 120 },
	feedbackRight: { name: 'Feedback R', index: 24, max: 120 }
} as const;

export type GlitchLoopParam = keyof typeof GLITCH_LOOP_PARAMS;

/** The parameter's index on this device: by name when listed, else the measured index. */
export function glitchLoopIndex(names: readonly string[], key: GlitchLoopParam): number {
	const { name, index } = GLITCH_LOOP_PARAMS[key];
	const byName = names.indexOf(name);
	return byName >= 0 ? byName : index;
}

/**
 * Pitch: Up · Spread · Off (user, 2026-10-07), written to Pitch L and
 * Pitch R as raw semitones. Top to bottom, like Octave's column.
 */
export const GLITCH_PITCH_MODES = [
	{ label: 'Up', left: 12, right: 12 },
	{ label: 'Spread', left: -12, right: 12 },
	{ label: 'Off', left: 0, right: 0 }
] as const;
