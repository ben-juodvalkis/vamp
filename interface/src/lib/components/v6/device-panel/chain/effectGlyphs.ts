/**
 * A palette chip's icon (2026-11-25): the picture its chain cell draws once
 * the effect is loaded (`browser/devicePictures`), at rest and small, so the
 * chip a finger reaches for is the cell that appears. Echo's rings, Glue's
 * VU needle, the compressor's knee, Blur's smeared face.
 *
 * Where a cell has no picture, or two chips would share one (Saturator and
 * Roar both draw the clipped sine), the icon is drawn here in the same
 * language: what the effect does to the sound, on the 100 × 100 box the
 * pictures use. The icons are tuned so no two in one palette column share
 * a silhouette.
 */
import { pictureStrokes, type PictureKind, type PictureStroke } from '$lib/components/v6/browser/devicePictures';

export type GlyphStroke = PictureStroke & {
	/** A transform onto the 100 box, for a mark drawn on another grid. */
	t?: string;
};

const f = (n: number) => Math.round(n * 10) / 10;
function trace(fn: (u: number) => number, points = 64): string {
	let d = '';
	for (let i = 0; i <= points; i++) {
		const u = i / points;
		d += `${i ? 'L' : 'M'}${f(u * 100)},${f(fn(u))}`;
	}
	return d;
}
const circle = (cx: number, cy: number, r: number) => `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
const box = (x: number, y: number, w: number, h: number, r: number) =>
	`M${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x + r}Q${x},${y + h} ${x},${y + h - r}V${y + r}Q${x},${y} ${x + r},${y}Z`;
const zero: GlyphStroke = { d: 'M0,50H100', o: 0.2 };

/** A cell's picture at a rest position chosen to read at chip size. */
type FromPicture = { picture: PictureKind; x: number; y?: number; variant?: number };

const SPEC: Record<string, FromPicture | GlyphStroke[]> = {
	// MIDI: notes in time.
	// Random a die, not its cell's scattered notes: those and the Arp's run
	// read as one shape at chip size, a column apart.
	random: [
		{ d: box(12, 12, 76, 76, 14), o: 0.9 },
		{ d: circle(32, 32, 7) + circle(50, 50, 7) + circle(68, 68, 7), o: 0.95, fill: true }
	],
	// The Arp's run (its cell's 'arp', Up), four notes bold enough to read small.
	arpeggiator: [4, 28, 52, 76].map((x, i) => ({ d: box(x, 74 - i * 20, 20, 12, 3), o: 0.9, fill: true })),
	MidiWheels: { picture: 'wheels', x: 0 },
	chord: [
		{ d: [0, 1, 2, 3].map((i) => box(8 + i * 21, 14, 21, 72, 2)).join(''), o: 0.9 },
		{ d: [0, 2].map((i) => box(9 + i * 21, 15, 19, 70, 2)).join(''), o: 0.35, fill: true },
		{ d: box(23, 14, 12, 42, 1) + box(44, 14, 12, 42, 1), o: 0.95, fill: true }
	],

	// Tone: a response across the spectrum, on the 0 dB line.
	filter: [
		{ d: 'M0,84H100', o: 0.2 },
		{ d: trace((u) => 36 - 22 * Math.exp(-(((u - 0.6) / 0.07) ** 2)) + (u > 0.6 ? 50 * ((u - 0.6) / 0.4) ** 1.2 : 0), 96), o: 0.9 }
	],
	eq: { picture: 'eqcurve', x: 0 },
	toneShaper: [zero, { d: trace((u) => 50 - 30 * Math.tanh((u - 0.5) * 5)), o: 0.9 }, { d: circle(50, 50, 6), o: 0.9, fill: true }],
	eq8: { picture: 'bell', x: 0.5, y: 0.95 },

	// Dynamics: what comes out for what goes in.
	squash: { picture: 'vu', x: 0.62 },
	ott: { picture: 'ratio', x: 0.9 },
	gate: { picture: 'gate', x: 0.25, y: 0.45 },
	compressor: { picture: 'compress', x: 0.55 },
	limiter: { picture: 'ceiling', x: 0.8 },

	// Distortion: the waveshape.
	drum: { picture: 'drum', x: 0.7, y: 0.5 },
	saturator: { picture: 'shaper', x: 0.25 },
	roar: [
		{ d: trace((u) => 50 - 34 * Math.sin(2 * Math.PI * u * 1.5), 96), o: 0.2 },
		{ d: trace((u) => 50 - 40 * Math.sin(2.8 * Math.sin(2 * Math.PI * u * 1.5)), 192), o: 0.9 }
	],
	redux: { picture: 'stairs', y: 0.3, x: 0 },
	shifter: { picture: 'ringmod', x: 0 },

	// Guitar: the things themselves.
	guitar: [
		{
			t: 'scale(4.1667)',
			o: 0.9,
			d: 'm11.9 12.1 4.514-4.514M20.1 2.3a1 1 0 0 0-1.4 0l-1.114 1.114A2 2 0 0 0 17 4.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 17.828 7h1.344a2 2 0 0 0 1.414-.586L21.7 5.3a1 1 0 0 0 0-1.4zM6 16l2 2M8.23 9.85A3 3 0 0 1 11 8a5 5 0 0 1 5 5 3 3 0 0 1-1.85 2.77l-.92.38A2 2 0 0 0 12 18a4 4 0 0 1-4 4 6 6 0 0 1-6-6 4 4 0 0 1 4-4 2 2 0 0 0 1.85-1.23z'
		}
	],
	bass: [
		{ d: box(14, 8, 72, 20, 3), o: 0.9 },
		{ d: circle(32, 18, 3) + circle(50, 18, 3) + circle(68, 18, 3), o: 0.9, fill: true },
		{ d: box(14, 34, 72, 58, 3), o: 0.9 },
		{ d: circle(34, 50, 10) + circle(66, 50, 10) + circle(34, 76, 10) + circle(66, 76, 10), o: 0.85 }
	],
	pedal: { picture: 'stompbox', x: 0.7 },
	wah: [{ d: 'M8,80H92', o: 0.35 }, { d: 'M10,78L88,36', o: 0.9 }, { d: 'M44,80L52,60L60,80', o: 0.9 }],

	// Modulation: the wave, moving.
	tremolo: { picture: 'tremolo', x: 0.1, y: 1, variant: 2 },
	chorus: { picture: 'waves', x: 0.2, y: 0.7 },
	smudge: { picture: 'smear', x: 0 },
	phaser: { picture: 'notches', x: 0.15, y: 1 },

	// Glitch: time cut up.
	variation: [0, 1, 2, 3].map((i) => ({ d: box(4 + i * 24, 25, 18, 50, 2), o: [0.95, 0.7, 0.48, 0.3][i], fill: true })),
	glitchLoop: { picture: 'glitch', x: 0.2 },
	pitchHack: { picture: 'reverse', x: 1 },
	octave: { picture: 'octaves', x: 1 },

	// Time: the hit and what follows it.
	echo: { picture: 'rings', x: 0.7, y: 0.1 },
	reverb: { picture: 'tail', x: 0.55, y: 0.6 },
	comb: { picture: 'comb', x: 0, y: 0.6 },
	grainDelay: [
		{ d: 'M0,88H100', o: 0.2 },
		...[
			[12, 70, 7],
			[26, 46, 5],
			[38, 66, 9],
			[54, 34, 6],
			[64, 58, 7],
			[78, 26, 4],
			[86, 50, 5]
		].map(([cx, cy, r], i) => ({ d: circle(cx, cy, r), o: 0.95 - i * 0.08, fill: true }))
	],

	// Utility: a fader.
	utility: [{ d: 'M50,4V96', o: 0.35 }, { d: box(30, 38, 40, 24, 5), o: 0.9 }, { d: 'M40,50H60', o: 0.9 }]
};

/** The icon for a palette entry: its preset key, else its file's name. */
export function effectGlyph(key: string | undefined): GlyphStroke[] | null {
	const spec = key ? SPEC[key] : undefined;
	if (!spec) return null;
	if (Array.isArray(spec)) return spec;
	return pictureStrokes(spec.picture, spec.x, spec.y ?? 0, spec.variant ?? 0);
}
