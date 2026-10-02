/**
 * The Reverb view's picture of the sound: the tail, drawn as a stack of
 * ridges — one per frequency band, lows at the front (bottom), highs at
 * the back (top) — with time running left to right from the dry hit.
 *
 * A ridge's height is its band's level on a dB scale (0 dB at the top of
 * its amplitude, -60 dB at its baseline), so a tail decaying at a steady
 * rate draws as a straight fall and ends exactly at its RT60. The time
 * axis is logarithmic past 100 ms, so 100 ms, 1 s and 10 s sit roughly
 * evenly and the whole of Live's 0.1..60 s Decay rail fits.
 *
 * What is measured and what is stylized: the times (Decay, Predelay,
 * Delay, Feedback spacing), the multipliers and the crossovers are Live's
 * own values, so a 3.5 s Decay ends on the 3.5 s point of the axis. How
 * Damping, Lo Damp, Shape, Diffusion, Mod, Shimmer, Tides and Vintage
 * bend the picture is a drawing of what each does, not a simulation of
 * the DSP.
 *
 * Pure and deterministic (noise is hashed, never random), so a shot and a
 * test see the same picture every time.
 */
import type { AlgorithmKey } from '$lib/components/v6/device-panel/hybridReverbParams';

export interface TailInput {
	algo: AlgorithmKey;
	/** Seconds: the nominal RT60, Live's Decay. */
	decay: number;
	/** Seconds from the dry hit to the tail: Predelay plus the algorithm's Delay. */
	onset: number;
	/** Seconds between Predelay Feedback repeats (the predelay itself). */
	echoSpacing: number;
	/** Predelay Feedback gain, 0..0.95. */
	feedback: number;
	size: number;
	damping: number;
	diffusion: number;
	mod: number;
	/** Dark Hall: small and resonant (0) to large and diffused (1). */
	shape: number;
	bassMult: number;
	bassX: number;
	lowDamp: number;
	distance: number;
	shimmer: number;
	/** Semitones. */
	pitch: number;
	tide: number;
	/** Seconds per Tides cycle at the song's tempo. */
	tidePeriod: number;
	/** Noise (0) → sine (0.5) → square (1). */
	wave: number;
	lowMult: number;
	highMult: number;
	xOver: number;
	freeze: boolean;
	/** Dry/Wet, 0..1. */
	wet: number;
	/** The wet path's gain at a frequency, in dB: EQ and Send. 0 = flat. */
	levelDb: (hz: number) => number;
	/** 0 Off … 4 Extreme. */
	vintage: number;
}

export interface Ridge {
	hz: number;
	/** Baseline height, 0..1 up from the bottom of the picture. */
	base: number;
	/** The ridge's top at each of `SAMPLE_X`, 0..1 up. */
	ys: number[];
}

export interface TailPortrait {
	/** Back to front: highs first, so each lower ridge covers the ones behind it. */
	ridges: Ridge[];
	/** The dry hit's height above the front baseline, 0..1 of the picture: Dry/Wet's other half. */
	dry: number;
	/** Where the Decay ends on the time axis — the XY handle's x. */
	tailEndX: number;
	/** The Dark Hall's Bass X or Prism's X-Over, where it divides the bands. */
	crossover: { hz: number; y: number } | null;
	/**
	 * Shimmer: the path one band's energy takes through the pitch shifter,
	 * a point a pass — up the stack for a rise, down for a fall — fading as
	 * each pass loses its few dB. Null for the other algorithms.
	 */
	climb: { x: number; y: number }[] | null;
}

// ── Axes ───────────────────────────────────────────────────────────────

const AXIS_KNEE = 0.1;
const AXIS_MAX = 60;
const AXIS_LEFT = 0.035;
const AXIS_RIGHT = 0.985;
const AXIS_SPAN = Math.log1p(AXIS_MAX / AXIS_KNEE);

/** Seconds since the dry hit → 0..1 across the picture. */
export function timeToX(seconds: number): number {
	return AXIS_LEFT + ((AXIS_RIGHT - AXIS_LEFT) * Math.log1p(Math.max(0, seconds) / AXIS_KNEE)) / AXIS_SPAN;
}
export function xToTime(x: number): number {
	const u = Math.max(0, (x - AXIS_LEFT) / (AXIS_RIGHT - AXIS_LEFT));
	return AXIS_KNEE * Math.expm1(u * AXIS_SPAN);
}
/** Seconds of the axis per unit of x at a time — for anti-aliasing. */
function secondsPerX(seconds: number): number {
	return ((AXIS_KNEE + seconds) * AXIS_SPAN) / (AXIS_RIGHT - AXIS_LEFT);
}

export const TIME_TICKS: readonly { seconds: number; label: string }[] = [
	{ seconds: 0.1, label: '100 ms' },
	{ seconds: 1, label: '1 s' },
	{ seconds: 10, label: '10 s' }
];

export const RIDGE_COUNT = 14;
const LOW_HZ = 60;
const HIGH_HZ = 12000;
export const BASE_BOTTOM = 0.09;
const BASE_TOP = 0.5;
/** A ridge at full level rises this far above its baseline. */
const RIDGE_AMPLITUDE = 0.27;
/** The top of the stack: the back ridge's baseline plus a full rise. */
export const STACK_TOP = BASE_TOP + RIDGE_AMPLITUDE;
const SAMPLES = 240;
export const SAMPLE_X: readonly number[] = Array.from({ length: SAMPLES }, (_, j) => j / (SAMPLES - 1));

const bandHz = (i: number) => LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, i / (RIDGE_COUNT - 1));
const bandBase = (i: number) => BASE_BOTTOM + ((BASE_TOP - BASE_BOTTOM) * i) / (RIDGE_COUNT - 1);
/** Semitones between neighbouring ridges (~7.1). */
const ST_PER_BAND = (12 * Math.log2(HIGH_HZ / LOW_HZ)) / (RIDGE_COUNT - 1);

/** The baseline height a frequency falls on. */
function hzToBase(hz: number): number {
	const i = ((RIDGE_COUNT - 1) * Math.log2(hz / LOW_HZ)) / Math.log2(HIGH_HZ / LOW_HZ);
	return bandBase(Math.min(RIDGE_COUNT - 1, Math.max(0, i)));
}

// ── Shaping ────────────────────────────────────────────────────────────

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
	const t = clamp01(v);
	return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const hash = (a: number, b: number) => {
	const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
	return s - Math.floor(s);
};

/** 0 at and below 800 Hz, 1 from 8 kHz: where Damping bites. */
const highs = (hz: number) => smooth(Math.log2(hz / 800) / Math.log2(10));
/** 1 at and below 80 Hz, 0 from 450 Hz: where Lo Damp bites. */
const lows = (hz: number) => 1 - smooth(Math.log2(hz / 80) / Math.log2(450 / 80));
/** 0 an octave-half below a crossover, 1 an octave-half above. */
const above = (hz: number, xo: number) => smooth(Math.log2(hz / xo) + 0.5);

const VINTAGE_TOP_HZ = [Infinity, 12000, 7000, 4500, 2500];
const VINTAGE_HOLD_X = [0, 0.004, 0.008, 0.012, 0.018];
const VINTAGE_STEP_Y = [0, 0, 0.05, 0.08, 0.12];

/** A band's own decay time, seconds. */
function rt60(input: TailInput, hz: number): number {
	const damp = 1 - 0.85 * input.damping * highs(hz);
	switch (input.algo) {
		case 'darkHall':
			return input.decay * lerp(input.bassMult, 1, above(hz, input.bassX)) * damp;
		case 'quartz':
			return input.decay * damp * (1 - 0.8 * input.lowDamp * lows(hz));
		case 'prism':
			return input.decay * lerp(input.lowMult, input.highMult, above(hz, input.xOver));
		default:
			return input.decay * damp;
	}
}

/** A band's level offset in dB-scale units (1 = 60 dB). */
function levelOffset(input: TailInput, hz: number): number {
	let db = input.levelDb(hz);
	if (input.algo !== 'prism') db -= 10 * input.damping * highs(hz);
	if (input.algo === 'quartz') db -= 10 * input.lowDamp * lows(hz);
	const top = VINTAGE_TOP_HZ[input.vintage] ?? Infinity;
	if (hz > top) db -= 30 * Math.log2(hz / top);
	return Math.max(-60, db) / 60;
}

/** Seconds for the tail to build to full level after its onset. */
function buildTime(input: TailInput): number {
	const base = 0.006 + 0.06 * input.size;
	if (input.algo === 'darkHall') return base * (0.4 + 1.2 * input.shape);
	if (input.algo === 'quartz') return base + 0.03 * input.distance;
	return base;
}

/** The early reflections, seconds after the onset, with their levels. */
function reflections(input: TailInput): { at: number; level: number }[] {
	const count = 4 + Math.round(5 * input.size);
	const window = (0.01 + 0.05 * input.size) * (input.algo === 'quartz' ? 1 + 2 * input.distance : 1);
	const strength =
		input.algo === 'quartz' ? 1 : input.algo === 'darkHall' ? 0.5 - 0.25 * input.shape : 0.45;
	return Array.from({ length: count }, (_, k) => ({
		at: window * Math.pow((k + 0.6) / count, 1.25),
		level: strength * (1 - (0.55 * k) / count)
	}));
}

/**
 * How smooth the tail is: 1 is a wash, 0 a train of separate echoes.
 * Dark Hall has no Diffusion of its own; its Shape does the same work.
 */
function smoothness(input: TailInput): number {
	if (input.algo === 'quartz' || input.algo === 'shimmer') return input.diffusion;
	if (input.algo === 'darkHall') return 0.85 + 0.15 * input.shape;
	return 1;
}

function echoPeriod(input: TailInput): number {
	return 0.018 + 0.05 * input.size + (input.algo === 'quartz' ? 0.09 * input.distance : 0);
}

/**
 * One band's level (0..~1.1, dB scale, before Dry/Wet) at `tau` seconds
 * after the tail's onset, drawn at `t` on the axis: build, decay (or hold,
 * frozen), texture.
 */
function tailLevel(input: TailInput, hz: number, t: number, tau: number, x: number, band: number): number {
	if (tau <= 0) return 0;
	// Axis seconds one sample spans here. A texture finer than a few samples
	// would alias; each one below says what it is drawn as instead.
	const sampleSeconds = secondsPerX(t) / SAMPLES;
	const rise = 1 - Math.exp((-3 * tau) / buildTime(input));
	const rt = rt60(input, hz);
	const fall = input.freeze ? 1 : Math.max(0, 1 - tau / rt);
	let h = rise * fall;
	if (h <= 0) return 0;

	// Echo texture: the train of repeats a sparse tail is made of. Where the
	// axis packs them too close to draw, they merge into the solid tail an
	// impulse response looks like zoomed out, crossfading so no step shows.
	const s = smoothness(input);
	if (s < 1) {
		const period = echoPeriod(input);
		const seen = smooth((period / sampleSeconds - 3) / 5);
		const phase = (tau / period) % 1;
		const pulse = Math.exp(-Math.pow((phase - 0.5) / 0.14, 2));
		h *= s + (1 - s) * (seen * pulse + (1 - seen));
	}

	if (input.mod > 0 && input.algo !== 'tides' && input.algo !== 'prism') {
		h *= 1 + 0.1 * input.mod * Math.sin(2 * Math.PI * (x * 9 + band * 0.31));
	}

	// Tides: each band's level swells and dips with the filter, a little
	// later than the band below it, so the ripple runs up the spectrum. Too
	// fast for the axis to draw, it is its average.
	if (input.algo === 'tides' && input.tide > 0) {
		const seen = smooth((input.tidePeriod / sampleSeconds - 2.5) / 4);
		const phi = tau / input.tidePeriod - band * 0.18;
		const sine = 0.5 + 0.5 * Math.cos(2 * Math.PI * phi);
		const square = phi - Math.floor(phi) < 0.5 ? 1 : 0;
		const noise = hash(Math.floor(phi * 2), band);
		const v = input.wave < 0.5 ? lerp(noise, sine, input.wave * 2) : lerp(sine, square, (input.wave - 0.5) * 2);
		h *= 1 - 0.85 * input.tide * (1 - (seen * v + (1 - seen) * 0.5));
	}
	return h;
}

/**
 * A band's tail with its Feedback repeats, at `t` seconds since the dry hit.
 * `repeats` is false for Shimmer's passes, which are repeats already: the
 * product of the two loops is what would make a drag stutter.
 */
function bandLevel(input: TailInput, hz: number, t: number, x: number, band: number, repeats = true): number {
	let h = tailLevel(input, hz, t, t - input.onset, x, band);
	if (repeats && input.feedback > 0.01 && input.echoSpacing > 0.001) {
		for (let n = 1; n <= 8; n++) {
			const gain = Math.pow(input.feedback, n);
			if (gain < 0.02) break;
			const repeat = tailLevel(input, hz, t, t - input.onset - n * input.echoSpacing, x, band);
			if (repeat > 0) h = Math.max(h, repeat + (20 * Math.log10(gain)) / 60);
		}
	}
	return h;
}

/**
 * Shimmer: energy fed back through the pitch shifter climbs (or falls) the
 * bands, a pass at a time, losing a few dB each pass — more the lower
 * Shimmer is. The highs it reaches keep ringing after their own tail.
 */
function shimmerLevel(input: TailInput, band: number, t: number, x: number): number {
	if (input.algo !== 'shimmer' || input.shimmer <= 0) return 0;
	const pass = 0.3 + 0.4 * input.size;
	const shift = input.pitch / ST_PER_BAND;
	const lossDb = 2 + 16 * (1 - input.shimmer);
	let best = 0;
	for (let n = 1; n <= 8; n++) {
		const from = band - n * shift;
		if (from < -0.5 || from > RIDGE_COUNT - 0.5) break;
		const hz = LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, from / (RIDGE_COUNT - 1));
		const h = bandLevel(input, hz, t - n * pass, x, from, false) - (n * lossDb) / 60;
		if (h > best) best = h;
	}
	return Math.min(1.1, best);
}

export function tailPortrait(input: TailInput): TailPortrait {
	const hold = VINTAGE_HOLD_X[input.vintage] ?? 0;
	const stepY = VINTAGE_STEP_Y[input.vintage] ?? 0;
	const wetScale = Math.sqrt(clamp01(input.wet));
	const er = reflections(input);
	const erX = er.map((r) => ({ x: timeToX(input.onset + r.at), level: r.level }));

	const ridges: Ridge[] = [];
	for (let i = RIDGE_COUNT - 1; i >= 0; i--) {
		const hz = bandHz(i);
		const base = bandBase(i);
		const offset = levelOffset(input, hz);
		const ys = SAMPLE_X.map((x) => {
			const xq = hold > 0 ? Math.floor(x / hold) * hold : x;
			const t = xToTime(xq);
			let h = Math.max(bandLevel(input, hz, t, xq, i), shimmerLevel(input, i, t, xq));
			if (h > 0) h = Math.max(0, h + offset);
			// Early reflections: a comb of narrow spikes just after the onset.
			for (const r of erX) {
				const d = Math.abs(xq - r.x);
				if (d < 0.0045) h = Math.max(h, Math.max(0, r.level * (1 - d / 0.0045) + offset));
			}
			if (stepY > 0) h = Math.round(h / stepY) * stepY;
			return base + RIDGE_AMPLITUDE * wetScale * Math.min(1.15, h);
		});
		ridges.push({ hz, base, ys });
	}

	let climb: { x: number; y: number }[] | null = null;
	if (input.algo === 'shimmer' && input.shimmer > 0) {
		const pass = 0.3 + 0.4 * input.size;
		const shift = input.pitch / ST_PER_BAND;
		const lossDb = 2 + 16 * (1 - input.shimmer);
		const start = shift >= 0 ? 2 : RIDGE_COUNT - 3;
		climb = [];
		for (let n = 0; n <= 8; n++) {
			const band = start + n * shift;
			const level = 0.9 - (n * lossDb) / 60;
			if (band < 0 || band > RIDGE_COUNT - 1 || level <= 0.1) break;
			climb.push({
				x: timeToX(input.onset + buildTime(input) + n * pass),
				y: bandBase(band) + RIDGE_AMPLITUDE * wetScale * level
			});
		}
		if (climb.length < 2) climb = null;
	}

	const xoHz = input.algo === 'darkHall' ? input.bassX : input.algo === 'prism' ? input.xOver : null;
	return {
		ridges,
		dry: (STACK_TOP - BASE_BOTTOM) * Math.sqrt(1 - clamp01(input.wet)),
		tailEndX: timeToX(input.onset + input.decay),
		crossover: xoHz === null ? null : { hz: xoHz, y: hzToBase(xoHz) },
		climb
	};
}

// ── The wet path's EQ and Send, as a gain per frequency ────────────────

export interface WetPath {
	eqOn: boolean;
	/** 0 Cut, 1 Shelf, for each end. */
	loType: number;
	loHz: number;
	loGainDb: number;
	loSlopeDb: number;
	peaks: { hz: number; gainDb: number; q: number }[];
	hiType: number;
	hiHz: number;
	hiGainDb: number;
	hiSlopeDb: number;
	/** Send, linear 0..1. */
	send: number;
}

/**
 * The gain the EQ and Send put on the reverb at a frequency, in dB. A cut
 * is a Butterworth magnitude of the slope's order (-3 dB at the corner);
 * shelves and peaks are drawn shapes, close enough to read as Live's.
 */
export function wetPathDb(path: WetPath): (hz: number) => number {
	const sendDb = path.send > 0 ? 20 * Math.log10(path.send) : -60;
	return (hz) => {
		let db = sendDb;
		if (!path.eqOn) return db;
		db +=
			path.loType === 0
				? -10 * Math.log10(1 + Math.pow(path.loHz / hz, path.loSlopeDb / 3))
				: path.loGainDb * (1 - smooth(Math.log2(hz / path.loHz) + 0.5));
		for (const p of path.peaks) db += p.gainDb * Math.exp(-Math.pow(Math.log2(hz / p.hz) * p.q * 1.4, 2));
		db +=
			path.hiType === 0
				? -10 * Math.log10(1 + Math.pow(hz / path.hiHz, path.hiSlopeDb / 3))
				: path.hiGainDb * smooth(Math.log2(hz / path.hiHz) + 0.5);
		return db;
	};
}
