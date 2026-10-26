/**
 * A device's picture (user, 2026-10-26: "make things distinctive in the
 * effect chain and browser… dynamic, to actually show the param values"):
 * a few lines drawn behind its control on a chain cell and a browser tile,
 * from the same values the control shows. Echo's rings spread with its time
 * and multiply with its feedback, a compressor's transfer curve bends at its
 * threshold, Redux's sine steps with its sample rate. Pictures, not
 * measurements: each is a sketch of what the device does, moved by its
 * control. Pure — every function maps the control's position(s), 0..1, to
 * SVG paths on a 100 × 100 box (stretched to the cell, strokes unscaled).
 */

/** One stroke: an SVG path and its opacity, 0..1. `fill` closes and fills it. */
export interface PictureStroke {
	d: string;
	o: number;
	fill?: boolean;
}

export type PictureKind =
	| 'rings'
	| 'waves'
	| 'tremolo'
	| 'transient'
	| 'gate'
	| 'comb'
	| 'notches'
	| 'stairs'
	| 'shaper'
	| 'clip'
	| 'stompbox'
	| 'compress'
	| 'ratio'
	| 'repeat'
	| 'scatter'
	| 'smear'
	| 'glitch'
	| 'octaves'
	| 'reverse'
	| 'ringmod'
	| 'chance'
	| 'velocity'
	| 'arp'
	| 'chord';

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const f = (n: number) => Math.round(n * 10) / 10;

/** A polyline through `points` samples of `fn(u)`, u 0..1 across, y in box units. */
function trace(fn: (u: number) => number, points = 64): string {
	let d = '';
	for (let i = 0; i <= points; i++) {
		const u = i / points;
		d += `${i ? 'L' : 'M'}${f(u * 100)},${f(fn(u))}`;
	}
	return d;
}

/** A deterministic 0..1 per index, so a picture holds still between frames. */
const hash = (i: number) => {
	const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
	return s - Math.floor(s);
};

const circle = (cx: number, cy: number, r: number) => `M${f(cx - r)},${cy}a${f(r)},${f(r)} 0 1,0 ${f(2 * r)},0a${f(r)},${f(r)} 0 1,0 ${f(-2 * r)},0`;
const bar = (x: number, y: number, w: number, h: number) => `M${f(x)},${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`;

/** The strokes of a picture at a control's position: `x` (a slider's level, or a pad's across) and `y` (a pad's up). */
export function pictureStrokes(kind: PictureKind, x: number, y = 0): PictureStroke[] {
	x = clamp01(x);
	y = clamp01(y);
	switch (kind) {
		// Echo: the top half of rings out from the bottom middle, as Live's Echo
		// draws them (user, 2026-10-26), a dot at each crest: more rings and
		// longer-lived with feedback, spread wider with time.
		case 'rings': {
			const n = 3 + Math.round(y * 9);
			const reach = 0.6 + 0.4 * x;
			return Array.from({ length: n }, (_, i) => {
				const r = reach * Math.pow((i + 1) / n, 1.4);
				const rx = 49 * r;
				const ry = 92 * r;
				const top = 100 - ry;
				const o = 0.35 + 0.6 * ((i + 1) / n);
				return [
					{ d: `M${f(50 - rx)},100A${f(rx)},${f(ry)} 0 0 1 ${f(50 + rx)},100`, o },
					{ d: `M${f(50)},${f(top)}m-1.2,0a1.2,1.2 0 1,0 2.4,0a1.2,1.2 0 1,0 -2.4,0`, o: 0.95, fill: true }
				];
			}).flat();
		}
		// Chorus: two voices drifting apart at its rate, wider with its mix.
		case 'waves': {
			const cycles = 1 + x * 4;
			const amp = 6 + y * 28;
			return [0, 0.35].map((phase, i) => ({ d: trace((u) => 50 + amp * Math.sin(2 * Math.PI * (u * cycles + phase))), o: i ? 0.45 : 0.8 }));
		}
		// Tremolo: a tone whose level swells at the LFO's rate, by its depth.
		case 'tremolo': {
			const lfo = 1 + x * 5;
			return [
				{ d: trace((u) => 50 + 34 * (1 - y * (0.5 + 0.5 * Math.sin(2 * Math.PI * u * lfo))) * Math.sin(2 * Math.PI * u * 12), 160), o: 0.5 }
			];
		}
		// Drum Buss: a hit, its attack sharpened (right) or softened (left) by Transients.
		case 'transient': {
			const peak = 15 + (1 - x) * 40;
			const decay = 3 + (1 - x) * 6;
			return [
				{ d: trace((u) => 92 - (92 - peak) * Math.exp(-decay * u) * (u < 0.04 ? u / 0.04 : 1)), o: 0.8 },
				{ d: trace((u) => 92 - (92 - peak) * y * Math.exp(-decay * 0.6 * u)), o: 0.35 }
			];
		}
		// Gate: what opens over the threshold line, closing over its release.
		case 'gate': {
			const th = 85 - y * 70;
			const rel = 0.05 + x * 0.6;
			return [
				{ d: `M0,${f(th)}H100`, o: 0.45 },
				{ d: trace((u) => (u < 0.15 ? 90 : u < 0.4 ? 20 : 20 + 70 * Math.min(1, (u - 0.4) / rel))), o: 0.85 }
			];
		}
		// Comb: teeth spaced by its tune, taller with feedback.
		case 'comb': {
			const n = 4 + Math.round(x * 14);
			return Array.from({ length: n }, (_, i) => ({ d: `M${f(((i + 0.5) / n) * 100)},92V${f(92 - 15 - y * 70)}`, o: 0.75 }));
		}
		// Phaser: notches swept through the spectrum, deeper with feedback.
		case 'notches': {
			const n = 2 + Math.round(x * 6);
			return [{ d: trace((u) => 20 + (55 + y * 20) * Math.pow(Math.abs(Math.cos(Math.PI * u * n)), 0.6 + y * 2), 160), o: 0.8 }];
		}
		// Redux: a sine held in steps, coarser as the sample rate drops (up).
		case 'stairs': {
			const steps = Math.round(4 + (1 - y) * 28);
			return [
				{ d: trace((u) => 50 - 36 * Math.sin(2 * Math.PI * (Math.floor(u * steps) / steps) * 1.5), 240), o: 0.85 },
				{ d: trace((u) => 50 - 36 * Math.sin(2 * Math.PI * u * 1.5)), o: 0.25 }
			];
		}
		// Saturator: its waveshaper, from a straight line to a squashed S.
		case 'shaper': {
			const k = 0.5 + x * 7;
			return [
				{ d: 'M0,50H100M50,0V100', o: 0.2 },
				{ d: trace((u) => 50 - 42 * (Math.tanh(k * (2 * u - 1)) / Math.tanh(k))), o: 0.85 }
			];
		}
		// Pedal: a sine clipped harder with drive.
		case 'clip': {
			const ceiling = 1 - x * 0.75;
			return [{ d: trace((u) => 50 - (38 * Math.max(-ceiling, Math.min(ceiling, Math.sin(2 * Math.PI * u * 2)))) / ceiling, 160), o: 0.85 }];
		}
		// Pedal: a stompbox (user, 2026-10-26: "should show a guitar pedal"),
		// its drive knob turned to the drive, its light lit once it drives.
		case 'stompbox': {
			const angle = (-135 + x * 270) * (Math.PI / 180);
			const knob = { cx: 50, cy: 38, r: 11 };
			return [
				{ d: 'M28,10h44a6,6 0 0 1 6,6v72a6,6 0 0 1 -6,6h-44a6,6 0 0 1 -6,-6v-72a6,6 0 0 1 6,-6Z', o: 0.75 },
				{ d: circle(knob.cx, knob.cy, knob.r), o: 0.85 },
				{ d: `M${knob.cx},${knob.cy}L${f(knob.cx + Math.sin(angle) * knob.r * 0.85)},${f(knob.cy - Math.cos(angle) * knob.r * 0.85)}`, o: 0.95 },
				{ d: circle(50, 18, 2.2), o: x > 0.02 ? 0.95 : 0.25, fill: true },
				{ d: circle(50, 74, 8), o: 0.7 },
				{ d: 'M36,58H64', o: 0.35 }
			];
		}
		// Glue / Compressor: input across, output up; above the threshold the line flattens.
		case 'compress': {
			const th = 0.85 - x * 0.6;
			return [
				{ d: 'M0,100L100,0', o: 0.2 },
				{ d: trace((u) => 100 - 100 * (u < th ? u : th + (u - th) * 0.25)), o: 0.85 }
			];
		}
		// Multiband: 1 : 1 at the middle; compression flattens the top, expansion steepens the bottom.
		case 'ratio': {
			const slope = x >= 0.5 ? 1 - (x - 0.5) * 1.8 : 1 + (0.5 - x) * 3;
			return [
				{ d: 'M0,100L100,0', o: 0.2 },
				{ d: trace((u) => 100 - 100 * Math.max(0, Math.min(1, 0.5 + (u - 0.5) * slope))), o: 0.85 }
			];
		}
		// Beat Repeat: a slice and its repeats, more the likelier.
		case 'repeat': {
			const n = 1 + Math.round(x * 7);
			return Array.from({ length: n }, (_, i) => ({ d: bar(4 + i * 12, 30, 9, 40), o: i ? 0.75 * (1 - i / 9) : 0.9, fill: true }));
		}
		// Random: notes thrown off their pitch, the further the likelier.
		case 'scatter': {
			return Array.from({ length: 12 }, (_, i) => ({ d: bar(4 + i * 8, 46 - (hash(i) - 0.5) * 80 * x, 6, 8), o: 0.8, fill: true }));
		}
		// Blur: copies of one wave smeared over each other, more with the mix.
		case 'smear': {
			const n = 1 + Math.round(x * 5);
			return Array.from({ length: n }, (_, i) => ({ d: trace((u) => 50 + 26 * Math.sin(2 * Math.PI * (u * 2 + i * 0.07))), o: 0.85 / (1 + i * 0.6) }));
		}
		// GlitchLoop: a wave cut into jumbled pieces, the more the wetter.
		case 'glitch': {
			const pieces = 8;
			return [
				{
					d: trace((u) => {
						const p = Math.floor(u * pieces);
						const shift = (hash(p) - 0.5) * x;
						return 50 - 34 * Math.sin(2 * Math.PI * (u + shift) * 2);
					}, 160),
					o: 0.85
				}
			];
		}
		// Octave: the note and the octave below it, louder with the mix.
		case 'octaves':
			return [
				{ d: trace((u) => 50 - 22 * Math.sin(2 * Math.PI * u * 4)), o: 0.4 },
				{ d: trace((u) => 50 - 40 * x * Math.sin(2 * Math.PI * u * 2)), o: 0.85 }
			];
		// Pitch Hack: a note played backwards, swelling into its attack, louder with the mix.
		case 'reverse':
			return [
				{ d: trace((u) => 50 - 38 * Math.pow(u, 2.5) * Math.sin(2 * Math.PI * u * 9), 200), o: 0.25 + 0.6 * x },
				{ d: 'M100,12V88', o: 0.3 + 0.5 * x }
			];
		// Shifter (ring): the tone times a carrier that rises with the slider.
		case 'ringmod': {
			const carrier = 3 + x * 30;
			return [{ d: trace((u) => 50 - 36 * Math.sin(2 * Math.PI * u * 2) * Math.sin(2 * Math.PI * u * carrier), 240), o: 0.85 }];
		}
		// Note Chance: twelve notes, the ones that get through lit. Some always
		// drop and some always pass (user, 2026-10-26: "should show some of the
		// notes deactivated"), so it reads as chance at 100 % too; more pass the likelier.
		case 'chance':
			return Array.from({ length: 12 }, (_, i) => ({ d: bar(4 + i * 8, 40, 6, 20), o: hash(i + 7) < 0.15 + 0.65 * x ? 0.85 : 0.15, fill: true }));
		// Velocity: twelve notes' velocities, spread by its randomness.
		case 'velocity':
			return Array.from({ length: 12 }, (_, i) => {
				const h = Math.max(6, 55 + (hash(i + 3) - 0.5) * 90 * x);
				return { d: bar(4 + i * 8, 92 - h, 6, h), o: 0.8, fill: true };
			});
		// Arpeggiator: a rising run, faster with the rate, each note as long as the gate.
		case 'arp': {
			const n = 3 + Math.round(x * 9);
			const w = (92 / n) * (0.15 + y * 0.85);
			return Array.from({ length: n }, (_, i) => ({ d: bar(4 + (i * 92) / n, 82 - ((i % 4) / 3) * 60, w, 8), o: 0.85, fill: true }));
		}
		// Chord: the played note and the one Shift adds, above or below it.
		case 'chord':
			return [
				{ d: bar(20, 46, 60, 8), o: 0.85, fill: true },
				{ d: bar(20, 46 - (x - 0.5) * 80, 60, 8), o: Math.abs(x - 0.5) < 0.01 ? 0.15 : 0.6, fill: true }
			];
	}
}

/** Pictures draw where a provider asks for them (the chain overview, a browser tile), not on the FX grid. */
export const PICTURE_CONTEXT = Symbol('device-pictures');
