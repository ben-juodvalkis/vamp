/**
 * A palette chip's picture (2026-11-25): what the effect does, drawn small
 * beside its name. A filter is its curve, Glue its gain-reduction meter, a
 * compressor its transfer curve with the knee, an echo its fading repeats.
 *
 * 24×24, stroked in currentColor. Each glyph is a list of strokes; circles
 * and boxes are spelled as paths by the helpers, so one component draws
 * them all. Keyed by the palette's preset key, else the file's name.
 */

export interface GlyphStroke {
	d: string;
	/** Opacity, for a guide or a fading copy. */
	o?: number;
	/** Filled instead of stroked (a dot). */
	fill?: boolean;
	dash?: string;
	w?: number;
}

const circle = (cx: number, cy: number, r: number) =>
	`M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`;
const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
	`M${cx - rx} ${cy} a${rx} ${ry} 0 1 0 ${2 * rx} 0 a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
const box = (x: number, y: number, w: number, h: number, r: number) =>
	`M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
const dot = (cx: number, cy: number, r = 1.4): GlyphStroke => ({ d: circle(cx, cy, r), fill: true });
const guide = (d: string): GlyphStroke => ({ d, o: 0.35, dash: '1.5 2' });

export const EFFECT_GLYPHS: Record<string, GlyphStroke[]> = {
	// MIDI
	random: [{ d: box(4, 4, 16, 16, 3) }, dot(8.5, 8.5), dot(12, 12), dot(15.5, 15.5)],
	arpeggiator: [{ d: 'M3 19 H7 M8.5 15 H12.5 M14 11 H18 M19.5 7 H22', w: 2.5 }],
	MidiWheels: [{ d: box(4, 3, 6, 18, 3) }, { d: box(14, 3, 6, 18, 3) }, { d: 'M5.5 12 H8.5 M15.5 8 H18.5', w: 2.25 }],
	chord: [
		{ d: ellipse(9, 6.5, 3.4, 2.3) },
		{ d: ellipse(9, 12, 3.4, 2.3) },
		{ d: ellipse(9, 17.5, 3.4, 2.3) },
		{ d: 'M12.4 17.5 V2.5' }
	],

	// Tone
	filter: [{ d: 'M2 10 H11 C14 10 14.5 5 16 5 C17.5 5 18 9 19 12.5 L21.5 20' }, guide('M2 20 H22')],
	eq: [{ d: 'M2 15 H6.5 C9 15 9.8 6 12 6 C14.2 6 15 15 17.5 15 H22' }, guide('M2 15 H22')],
	toneShaper: [{ d: 'M2 18 L22 6' }, guide('M2 12 H22'), dot(12, 12, 1.8)],
	eq8: [
		{ d: 'M2 14 C4.5 14 5 9 7.5 9 C10 9 10.5 17 13 17 C15.5 17 16 11 18.5 11 C20.5 11 21 13 22 13' },
		dot(7.5, 9),
		dot(13, 17),
		dot(18.5, 11)
	],

	// Dynamics
	squash: [
		{ d: 'M3.5 17 A9 9 0 0 1 20.5 17' },
		{ d: 'M5.5 11.5 L7 12.6 M12 8 V9.8 M18.5 11.5 L17 12.6', o: 0.6 },
		{ d: 'M12 19 L8 10.5', w: 2 },
		dot(12, 19, 1.6)
	],
	ott: [{ d: 'M6 20 V11 M12 20 V6 M18 20 V13', w: 3 }, guide('M3 9 H21')],
	gate: [{ d: 'M2 18 H6 V7 H15 V18 H22' }, guide('M2 12 H22')],
	compressor: [{ d: 'M3 21 L12 12 C14 10.5 17 9 21 8' }, guide('M12 12 L20 4'), { d: 'M3 3 V21 H21', o: 0.35 }],
	limiter: [
		{ d: 'M2 14 C3.5 14 4 6 5.5 6 H8.5 C10 6 10.5 19 12 19 C13.5 19 14 6 15.5 6 H18.5 C20 6 20.5 14 22 14' },
		{ d: 'M2 4 H22', o: 0.5, w: 1.25 }
	],

	// Distortion
	drum: [
		{ d: ellipse(12, 10, 8, 3) },
		{ d: 'M4 10 V17 A8 3 0 0 0 20 17 V10' },
		{ d: 'M4.5 2.5 L10 7.5 M19.5 2.5 L14 7.5' }
	],
	saturator: [
		{ d: 'M2 12 C2.5 7 3 6 5.5 6 H8.5 C11 6 11.5 7 12 12 C12.5 17 13 18 15.5 18 H18.5 C21 18 21.5 17 22 12' },
		guide('M2 12 C4 4 6 4 7 12 S10 20 12 12')
	],
	roar: [{ d: 'M2 12 L4 9 L5.5 15 L7.5 4 L10 20 L12 7 L14 17 L16 5 L18 19 L20 10 L22 12' }],
	redux: [{ d: 'M2 18 H5 V14 H8 V9 H11 V6 H14 V9 H17 V14 H20 V18 H22' }],
	shifter: [
		{ d: 'M4 19 L7 9 L10 19', o: 0.4 },
		{ d: 'M12 19 L15 9 L18 19' },
		{ d: 'M2 19 H22', o: 0.35 },
		{ d: 'M8 5 H16 M14 3 L16 5 L14 7' }
	],

	// Guitar
	guitar: [{ d: circle(9, 15, 6) }, { d: circle(9, 15, 1.7) }, { d: 'M13.2 10.8 L20 4 M18.5 2.5 L21.5 5.5', w: 2 }],
	bass: [
		{ d: 'M5 7.5 C5 5 7.5 3.5 10 3.5 C13.5 3.5 16 6 16 10 C16 15 11.5 18.5 5 21' },
		dot(5.5, 8, 1.8),
		dot(19.5, 7.5),
		dot(19.5, 12.5)
	],
	pedal: [{ d: box(5, 3, 14, 18, 2.5) }, { d: circle(9, 7.5, 1.5) }, { d: circle(15, 7.5, 1.5) }, { d: circle(12, 15.5, 2.6) }],
	wah: [{ d: 'M3 20 H21', o: 0.35 }, { d: 'M10 20 L12 14 L14 20' }, { d: 'M3.5 17 L20.5 8', w: 2.5 }],

	// Modulation
	tremolo: [
		{ d: 'M2 12 Q3.25 10 4.5 12 Q5.75 14 7 12 Q8.25 6 9.5 12 Q10.75 18 12 12 Q13.25 3 14.5 12 Q15.75 21 17 12 Q18.25 7 19.5 12 Q20.75 17 22 12' }
	],
	chorus: [{ d: 'M2 12 C4 5 6 5 8 12 S12 19 14 12 S18 5 20 12' }, { d: 'M4 12 C6 5 8 5 10 12 S14 19 16 12 S20 5 22 12', o: 0.45 }],
	smudge: [
		{ d: 'M2 17 C5.5 17 5.5 7 8.5 7 C11.5 7 11.5 17 15 17' },
		{ d: 'M5 17 C8.5 17 8.5 7 11.5 7 C14.5 7 14.5 17 18 17', o: 0.55 },
		{ d: 'M8 17 C11.5 17 11.5 7 14.5 7 C17.5 7 17.5 17 21 17', o: 0.28 }
	],
	phaser: [
		{ d: 'M2 6 H5 C6.5 6 6.5 16 7.5 16 C8.5 16 8.5 6 10 6 H12 C13.5 6 13.5 16 14.5 16 C15.5 16 15.5 6 17 6 H22' },
		{ d: 'M7 20.5 H17 M15 18.5 L17 20.5 L15 22.5' }
	],

	// Glitch
	variation: [
		{ d: 'M2.5 12 L4 7 L6 17 L7.5 12' },
		{ d: 'M9 12 L10.5 7 L12.5 17 L14 12', o: 0.7 },
		{ d: 'M15.5 12 L17 7 L19 17 L20.5 12', o: 0.45 }
	],
	glitchLoop: [{ d: 'M18.5 15 A7 7 0 1 1 16.5 6.6', dash: '7 2.5 2 2.5' }, { d: 'M17 2.5 L17 7 L12.5 7.5' }],
	pitchHack: [{ d: 'M3 19 L7.5 14.5 L10.5 17 L14.5 10 L17 12.5 L20.5 5' }, { d: 'M16.5 5 H20.5 V9' }],
	octave: [{ d: 'M8 20 V4 M4.5 7.5 L8 4 L11.5 7.5' }, { d: 'M16 4 V20 M12.5 16.5 L16 20 L19.5 16.5' }],

	// Time
	echo: [{ d: 'M4 20 V4 M9 20 V8 M14 20 V12 M19 20 V15.5', w: 2 }, { d: 'M2 20 H22', o: 0.35 }],
	reverb: [
		{ d: 'M4 20 V4', w: 2 },
		{ d: 'M4 4 C7 4 9 14 21 18.5' },
		{ d: 'M7 20 V9 M9.5 20 V12.2 M12 20 V14.3 M14.5 20 V15.8 M17 20 V16.9 M19.5 20 V17.9', o: 0.45, w: 1.25 }
	],
	comb: [{ d: 'M3 6 H21', w: 2.75 }, { d: 'M5 6 V19 M8.5 6 V19 M12 6 V19 M15.5 6 V19 M19 6 V19' }],
	grainDelay: [dot(5, 13, 1.8), dot(9.5, 8, 1.3), dot(11, 16, 2), dot(15, 11, 1.5), dot(18.5, 6.5, 1), dot(19.5, 16, 1.2), dot(7, 19, 1)],

	// Utility
	utility: [{ d: 'M12 3 V21', o: 0.4 }, { d: box(7.5, 9.5, 9, 5, 1.2) }, { d: 'M9.5 12 H14.5' }]
};

/** The glyph for a palette entry: its preset key, else its file's name. */
export function effectGlyph(key: string | undefined): GlyphStroke[] | null {
	return (key && EFFECT_GLYPHS[key]) || null;
}
