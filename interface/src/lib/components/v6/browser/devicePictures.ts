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
	| 'drum'
	| 'gate'
	| 'comb'
	| 'notches'
	| 'stairs'
	| 'shaper'
	| 'stompbox'
	| 'eqcurve'
	| 'wheels'
	| 'tail'
	| 'stack'
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

const circle = (cx: number, cy: number, r: number) => `M${f(cx - r)},${f(cy)}a${f(r)},${f(r)} 0 1,0 ${f(2 * r)},0a${f(r)},${f(r)} 0 1,0 ${f(-2 * r)},0`;
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
		// Tremolo: one cycle of its swell (the user, 2026-10-26: simpler, "just
		// one cycle"), deeper with its depth.
		case 'tremolo': {
			const amp = 8 + y * 32;
			return [
				{ d: 'M0,50H100', o: 0.2 },
				{ d: trace((u) => 50 - amp * Math.sin(2 * Math.PI * u)), o: 0.85 }
			];
		}
		// Drum Buss: a drum (user, 2026-10-26: "should show a drum"), its
		// head struck harder the sharper the transients (right), filled in
		// with the mix (up).
		case 'drum': {
			const ellipse = (cy: number) => `M20,${cy}a30,9 0 1,0 60,0a30,9 0 1,0 -60,0`;
			const strike = 5 + x * 16;
			const hits = [-0.45, 0, 0.45].map((a) => {
				const sx = 50 + Math.sin(a) * 8;
				const sy = 26 - Math.cos(a) * 2;
				return `M${f(sx)},${f(sy)}L${f(sx + Math.sin(a) * strike)},${f(sy - Math.cos(a) * strike)}`;
			});
			return [
				{ d: ellipse(40), o: 0.1 + 0.35 * y, fill: true },
				{ d: ellipse(40), o: 0.85 },
				{ d: 'M20,40V72M80,40V72M20,72a30,9 0 0,0 60,0', o: 0.85 },
				{ d: 'M20,48L35,68L50,50L65,68L80,48', o: 0.35 },
				{ d: hits.join(''), o: 0.3 + 0.6 * x }
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
		// Comb: an actual comb (the user, 2026-10-26), its spine over its
		// teeth: more teeth as its tune rises, longer with feedback.
		case 'comb': {
			const n = 8 + Math.round(x * 12);
			const left = 12;
			const right = 88;
			const spine = { top: 24, h: 12 };
			const len = 16 + y * 34;
			const teeth = Array.from({ length: n }, (_, i) => {
				const tx = left + 3 + ((right - left - 6) * i) / (n - 1);
				return `M${f(tx)},${spine.top + spine.h}V${f(spine.top + spine.h + len)}`;
			}).join('');
			return [
				{ d: `M${left + 4},${spine.top}H${right - 4}a4,4 0 0 1 4,4V${spine.top + spine.h}H${left}V${spine.top + 4}a4,4 0 0 1 4,-4Z`, o: 0.8, fill: true },
				{ d: teeth, o: 0.85 }
			];
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
		// Saturator: a sine through its waveshaper, its peaks clipped flatter
		// as the drive rises (the user, 2026-10-26: "a clipped curve", not the
		// flat transfer line), the clean sine faint behind it. Some clipping
		// even at rest, so it always reads as saturation.
		case 'shaper': {
			const k = 3 + x * 7;
			return [
				{ d: trace((u) => 50 - 34 * Math.sin(2 * Math.PI * u * 2), 160), o: 0.2 },
				{ d: trace((u) => 50 - 36 * (Math.tanh(k * Math.sin(2 * Math.PI * u * 2)) / Math.tanh(k)), 160), o: 0.85 }
			];
		}
		// A reverb (Hybrid Reverb, the user, 2026-10-26): a hit and its tail
		// dying away, longer with the decay, louder with the mix.
		case 'tail': {
			const fade = 6 - 4.5 * x;
			const amp = 24 + 20 * y;
			return [
				{ d: 'M0,50H100', o: 0.2 },
				{ d: trace((u) => 50 - amp * Math.exp(-u * fade) * Math.sin(2 * Math.PI * u * 14 + 0.6) * (0.65 + 0.35 * Math.sin(u * 37)), 240), o: 0.85 }
			];
		}
		// MidiWheels: its two wheels side by side, pitch centred, mod at rest
		// (the user, 2026-10-26).
		case 'wheels':
			return [
				{ d: 'M26,10h16a4,4 0 0 1 4,4v72a4,4 0 0 1 -4,4h-16a4,4 0 0 1 -4,-4v-72a4,4 0 0 1 4,-4Z', o: 0.8 },
				{ d: 'M58,10h16a4,4 0 0 1 4,4v72a4,4 0 0 1 -4,4h-16a4,4 0 0 1 -4,-4v-72a4,4 0 0 1 4,-4Z', o: 0.8 },
				{ d: 'M24,50H44', o: 0.95 },
				{ d: 'M56,82H76', o: 0.95 },
				{ d: 'M27,24H41M27,32H41M27,68H41M27,76H41M59,24H73M59,32H73M59,40H73M59,48H73', o: 0.3 }
			];
		// An EQ, generic (the Recent column's Channel EQ, the user,
		// 2026-10-26): a low shelf lifted, a dip in the mids, an air lift.
		case 'eqcurve':
			return [
				{ d: 'M0,50H100', o: 0.2 },
				{ d: trace((u) => 50 - 32 / (1 + Math.exp((u - 0.2) * 24)) + 34 * Math.exp(-(((u - 0.52) / 0.1) ** 2)) - 26 / (1 + Math.exp(-(u - 0.8) * 24))), o: 0.85 }
			];
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
		// Bass Amp: a full stack (user, 2026-10-26), a head on two 2 x 2
		// cabinets, its speakers lit as the macro turns up.
		case 'stack': {
			const cone = 0.2 + 0.7 * x;
			// Two cabinets 38 tall under a 16-tall head, four speakers each.
			const cabs = [22, 61];
			const speakers = (top: number) => [9.5, 28.5].flatMap((dy) => [36, 64].map((cx) => [cx, top + dy]));
			return [
				{ d: bar(18, 1, 64, 17), o: 0.85 },
				{ d: [30, 42, 54, 66].map((k) => circle(k, 9.5, 2.4)).join(''), o: 0.8 },
				...cabs.map((top) => ({ d: bar(18, top, 64, 38), o: 0.85 })),
				...cabs.map((top) => ({ d: speakers(top).map(([cx, cy]) => circle(cx, cy, 7)).join(''), o: 0.75 })),
				...cabs.map((top) => ({ d: speakers(top).map(([cx, cy]) => circle(cx, cy, 2.8)).join(''), o: cone, fill: true }))
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
		// Multiband: three compressor knees side by side, bass, mid and treble,
		// split by two dividers (the user's sketch, 2026-10-26): a steep rise
		// to the threshold, then a flatter line above it, flatter the higher
		// the ratio. A mild knee even at 1 : 1, so it reads as a compressor.
		case 'ratio': {
			const upper = 0.5 - Math.max(0, x - 0.5) * 0.8;
			const knees = [0, 1, 2].map((band) => {
				const left = band * (100 / 3);
				const kx = left + 11;
				const ky = 44;
				const ex = left + 27;
				return `M${f(left + 5)},84L${f(kx)},${ky}L${f(ex)},${f(ky - (ex - kx) * upper)}`;
			});
			return [
				{ d: 'M33.3,14V86M66.7,14V86', o: 0.35 },
				{ d: knees.join(''), o: 0.9 }
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
		// Blur: a face, smeared (the user, 2026-10-26: "someone's face, but
		// blurry"): copies of it slid apart and fading, more and further apart
		// the wetter.
		case 'smear': {
			const copies = 2 + Math.round(x * 4);
			const face = (dx: number, dy: number) =>
				`${circle(50 + dx, 50 + dy, 30)}${circle(39 + dx, 43 + dy, 3.5)}${circle(61 + dx, 43 + dy, 3.5)}M${f(36 + dx)},${f(60 + dy)}Q${f(50 + dx)},${f(72 + dy)} ${f(64 + dx)},${f(60 + dy)}`;
			return Array.from({ length: copies }, (_, i) => {
				const t = copies === 1 ? 0 : i / (copies - 1);
				const spread = 3 + x * 7;
				return { d: face((t - 0.5) * 2 * spread, (t - 0.5) * spread * 0.5), o: 0.8 - Math.abs(t - 0.5) * 0.6 };
			});
		}
		// GlitchLoop: psychedelic bubbles (the user, 2026-10-26), overlapping
		// and ringed, more of them the wetter.
		case 'glitch': {
			const n = 4 + Math.round(x * 6);
			return Array.from({ length: n }, (_, i) => {
				const cx = 14 + hash(i + 11) * 72;
				const cy = 16 + hash(i + 23) * 68;
				const r = 7 + hash(i + 37) * 16;
				const rings = 1 + Math.floor(hash(i + 51) * 3);
				const d = Array.from({ length: rings }, (_, k) => circle(cx, cy, r * (1 - k * 0.3))).join('');
				return { d, o: 0.45 + 0.45 * hash(i + 71) };
			});
		}
		// Octave (Pitch Shift): a keyboard on its side with an up arrow beside
		// it (the user, 2026-10-26), the arrow stronger with the mix.
		case 'octaves': {
			const keys = 7;
			const top = 12;
			const kh = 76 / keys;
			const left = 22;
			const w = 30;
			const whites = Array.from({ length: keys }, (_, i) => bar(left, top + i * kh, w, kh)).join('');
			// Black keys between white ones, as on a piano (none between E-F and B-C).
			const blacks = [0, 1, 3, 4, 5]
				.map((i) => bar(left, top + (i + 1) * kh - kh * 0.3, w * 0.6, kh * 0.6))
				.join('');
			return [
				{ d: whites, o: 0.7 },
				{ d: blacks, o: 0.55, fill: true },
				{ d: 'M72,84V18M60,32L72,18L84,32', o: 0.4 + 0.55 * x }
			];
		}
		// Pitch Hack: a backward arrow, for its reverse (the user, 2026-10-26),
		// stronger with the mix.
		case 'reverse':
			return [
				{ d: 'M84,50H18M38,30L18,50L38,70', o: 0.35 + 0.6 * x },
				{ d: 'M84,36V64', o: 0.25 + 0.4 * x }
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
		// Velocity: twelve notes' velocities as a bar graph on one baseline,
		// their tops always uneven (user, 2026-10-26: "steps of varying
		// heights… just the top varies") and more so with its randomness.
		case 'velocity':
			return Array.from({ length: 12 }, (_, i) => {
				const h = Math.max(8, 50 + (hash(i + 3) - 0.5) * 84 * (0.35 + 0.65 * x));
				return { d: bar(4 + i * 8, 92 - h, 6, h), o: 0.8, fill: true };
			});
		// Arpeggiator: a rising run, faster with the rate, each note as long as the gate.
		case 'arp': {
			const n = 3 + Math.round(x * 9);
			const w = (92 / n) * (0.15 + y * 0.85);
			return Array.from({ length: n }, (_, i) => ({ d: bar(4 + (i * 92) / n, 82 - ((i % 4) / 3) * 60, w, 8), o: 0.85, fill: true }));
		}
		// Chord: an octave of piano keys (the user, 2026-10-26), the played
		// triad lit and the note Shift adds lit too, above or below. Each white
		// key's outline is notched around the black keys beside it, so no two
		// shapes overlap; black keys are solid, and a played one is hollowed.
		case 'chord': {
			const WHITE = 7;
			const left = 4;
			const kw = 92 / WHITE;
			const top = 22;
			const bottom = 78;
			const g = 1.4;
			const whiteSemis = [0, 2, 4, 5, 7, 9, 11];
			/** A black key on the boundary after these white keys. */
			const blackAfter = new Set([0, 1, 3, 4, 5]);
			const bw = kw * 0.56;
			const bh = (bottom - top) * 0.58;
			const shift = Math.round((x - 0.5) * 24);
			const added = ((shift % 12) + 12) % 12;
			const played = new Set([0, 4, 7, ...(shift !== 0 ? [added] : [])]);
			const whiteKey = (i: number) => {
				const x0 = left + i * kw + g / 2;
				const x1 = left + (i + 1) * kw - g / 2;
				const notchY = top + bh + g;
				const leftNotch = i > 0 && blackAfter.has(i - 1);
				const rightNotch = blackAfter.has(i);
				const lx = left + i * kw + bw / 2 + g / 2;
				const rx = left + (i + 1) * kw - bw / 2 - g / 2;
				let d = `M${f(x0)},${bottom}`;
				d += leftNotch ? `V${f(notchY)}H${f(lx)}V${top}` : `V${top}`;
				d += rightNotch ? `H${f(rx)}V${f(notchY)}H${f(x1)}` : `H${f(x1)}`;
				return d + `V${bottom}Z`;
			};
			const strokes: PictureStroke[] = [];
			const lit = whiteSemis.flatMap((semi, i) => (played.has(semi) ? [whiteKey(i)] : []));
			if (lit.length) strokes.push({ d: lit.join(''), o: 0.5, fill: true });
			strokes.push({ d: whiteSemis.map((_, i) => whiteKey(i)).join(''), o: 0.95 });
			for (const i of blackAfter) {
				const bx = left + (i + 1) * kw - bw / 2;
				const key = bar(bx, top, bw, bh);
				if (played.has(whiteSemis[i] + 1)) strokes.push({ d: key, o: 0.95 });
				else strokes.push({ d: key, o: 0.95, fill: true });
			}
			return strokes;
		}
	}
}

/** Pictures draw where a provider asks for them (the chain overview, a browser tile), not on the FX grid. */
export const PICTURE_CONTEXT = Symbol('device-pictures');
