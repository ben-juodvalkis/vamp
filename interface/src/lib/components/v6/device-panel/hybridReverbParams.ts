/**
 * Hybrid Reverb's parameter map (LOM class `Hybrid`), shared by the Reverb
 * tile and its central view.
 *
 * Indices, ranges and labels were read off the running device on
 * 2026-10-02 (Live 12 Beta, `str_for_value` per value). The curved rails
 * were sampled densely (Decay at 81 points, Predelay and Delay at 41) and
 * the fits below reproduce every label Live printed. Which controls each
 * algorithm has comes from Ableton's own DSP reference (`abl.dsp.darkhall~`
 * … `abl.dsp.tides~`) and the Live manual. Prism's `Pr Sixth` / `Pr Seventh`
 * (29, 30) appear in neither and are not drawn.
 *
 * Every value here is raw Live units. All are 0..1 but Predelay 16th
 * (0..16), Algo Type (0..4), Ti Rate (0..29), Routing (0..3), Vintage
 * (0..4) and the EQ slopes (0..9).
 */

export const HYBRID = {
	predelaySync: 1,
	predelay: 2,
	predelay16th: 3,
	predelayFb: 4,
	predelayFb16th: 5,
	algoType: 6,
	algoDelay: 7,
	freeze: 8,
	freezeIn: 9,
	decay: 10,
	size: 11,
	damping: 12,
	diffusion: 13,
	mod: 14,
	hallShape: 15,
	hallBassMult: 16,
	hallBassX: 17,
	shimmer: 18,
	shimmerPitch: 19,
	tide: 20,
	tidesRate: 21,
	tidesWave: 22,
	tidesPhase: 23,
	quartzLowDamp: 24,
	quartzDistance: 25,
	prismHighMult: 26,
	prismLowMult: 27,
	prismXOver: 28,
	eqOn: 31,
	eqLoType: 33,
	eqLoFreq: 34,
	eqLoGain: 35,
	eqLoSlope: 36,
	eqPeak1Freq: 37,
	eqPeak1Gain: 38,
	eqPeak1Q: 39,
	eqPeak2Freq: 40,
	eqPeak2Gain: 41,
	eqPeak2Q: 42,
	eqHiType: 43,
	eqHiFreq: 44,
	eqHiGain: 45,
	eqHiSlope: 46,
	sendGain: 47,
	routing: 48,
	vintage: 50,
	width: 51,
	bassMono: 52,
	dryWet: 53
} as const;

/** Routing (48): the view shows the algorithm unless it is Convolution alone. */
export const ROUTING_CONVOLUTION = 3;
export const ROUTING_ALGORITHM = 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

// ── Curves ─────────────────────────────────────────────────────────────

/**
 * Decay, 0.1..60 s: two power curves meeting at 3.5 s, flat where they
 * meet (Live: 0.5 → 3.50 s, 0.5125 → 3.51 s, 0.525 → 3.56 s).
 */
const DECAY_LO_EXP = 1.9174;
const DECAY_HI_EXP = 2.2963;
export function decaySeconds(v: number): number {
	const t = clamp01(v);
	return t <= 0.5 ? 0.1 + 3.4 * Math.pow(2 * t, DECAY_LO_EXP) : 3.5 + 56.5 * Math.pow(2 * t - 1, DECAY_HI_EXP);
}
export function decayValue(seconds: number): number {
	const s = clamp(seconds, 0.1, 60);
	return s <= 3.5 ? 0.5 * Math.pow((s - 0.1) / 3.4, 1 / DECAY_LO_EXP) : 0.5 + 0.5 * Math.pow((s - 3.5) / 56.5, 1 / DECAY_HI_EXP);
}

/** Predelay (0..4 s) and the algorithm's Delay (0..1 s) share one curve. */
const DELAY_EXP = 3.33;
export const predelaySeconds = (v: number) => 4 * Math.pow(clamp01(v), DELAY_EXP);
export const algoDelaySeconds = (v: number) => Math.pow(clamp01(v), DELAY_EXP);

/** Dark Hall's Bass Mult, 25..400 % (×0.25..×4). */
export const bassMult = (v: number) => 0.25 * Math.pow(16, clamp01(v));
/** Dark Hall's Bass X, 80 Hz..1 kHz. */
export const bassXHz = (v: number) => 80 * Math.pow(12.5, clamp01(v));
/** Prism's Low and High Mult, 10..500 % (×0.1..×5). */
export const prismMult = (v: number) => 0.1 * Math.pow(50, clamp01(v));
/** Prism's X-Over, 400 Hz..5.5 kHz. */
export const prismXOverHz = (v: number) => 400 * Math.pow(13.75, clamp01(v));
/** Every EQ frequency, 20 Hz..20 kHz. */
export const eqFreqHz = (v: number) => 20 * Math.pow(1000, clamp01(v));
/** Every EQ gain, -12..12 dB. */
export const eqGainDb = (v: number) => -12 + 24 * clamp01(v);
/** Every EQ Q, 0.10..4.00. */
export const eqQ = (v: number) => 0.1 + 3.9 * clamp01(v);
/** EQ Lo / Hi Slope, by step. */
export const EQ_SLOPES_DB = [6, 12, 18, 24, 36, 48, 60, 72, 84, 96] as const;
/** Shimmer's Pitch, -12..12 semitones. */
export const shimmerSemitones = (v: number) => -12 + 24 * clamp01(v);
/** Predelay Feedback (either mode), 0..95 %. */
export const feedbackGain = (v: number) => 0.95 * clamp01(v);

// ── Ti Rate, a note value ──────────────────────────────────────────────

export const TIDES_RATE_LABELS = [
	'1/128 T', '1/128', '1/64 T', '1/128 D', '1/64', '1/32 T', '1/64 D', '1/32',
	'1/16 T', '1/32 D', '1/16', '1/8 T', '1/16 D', '1/8', '1/4 T', '1/8 D', '1/4',
	'1/2 T', '1/4 D', '1/2', '1 T', '1/2 D', '1', '2 T', '1 D', '2', '4 T', '2 D',
	'4', '4 D'
] as const;
export const TIDES_RATE_MAX = TIDES_RATE_LABELS.length - 1;

const step = (value: number, max: number) => clamp(Math.round(value), 0, max);

export function tidesRateLabel(value: number): string {
	return TIDES_RATE_LABELS[step(value, TIDES_RATE_MAX)];
}

/** One Ti Rate cycle in beats: "1/4" is a beat, T is 2/3 of it, D 1.5x. */
export function tidesRateBeats(value: number): number {
	const [note, kind] = tidesRateLabel(value).split(' ');
	const [num, den] = note.includes('/') ? note.split('/').map(Number) : [Number(note), 1];
	const beats = (4 * num) / den;
	return kind === 'T' ? (beats * 2) / 3 : kind === 'D' ? beats * 1.5 : beats;
}

export const VINTAGE_LABELS = ['Off', 'Subtle', 'Old', 'Older', 'Extreme'] as const;
export const VINTAGE_MAX = VINTAGE_LABELS.length - 1;

// ── Labels, in Live's own format ───────────────────────────────────────
// Live prints three significant figures for times, frequencies and the
// unitless Shape; whole percentages from 10 up and one decimal below. Its
// own strings carry stray spaces ("2  / 16", "50.0 "); these collapse them.

function sig3(x: number): string {
	const a = Math.abs(x);
	return a < 9.995 ? x.toFixed(2) : a < 99.95 ? x.toFixed(1) : x.toFixed(0);
}

export function timeLabel(seconds: number): string {
	return seconds < 0.9995 ? `${sig3(seconds * 1000)} ms` : `${sig3(seconds)} s`;
}

export function percentLabel(percent: number): string {
	return `${percent < 9.95 ? percent.toFixed(1) : Math.round(percent).toFixed(0)} %`;
}

export function hzLabel(hz: number): string {
	return hz < 999.5 ? `${sig3(hz)} Hz` : `${sig3(hz / 1000)} kHz`;
}

export const multLabel = (x: number) => `${Math.round(x * 100)} %`;
export const pitchLabel = (st: number) => `${st.toFixed(2)} st`;
export const degreeLabel = (deg: number) => `${deg < 9.95 ? deg.toFixed(1) : Math.round(deg).toFixed(0)}°`;
export const sixteenthsLabel = (n: number) => `${step(n, 16)} / 16`;
export const vintageLabel = (v: number) => VINTAGE_LABELS[step(v, VINTAGE_MAX)];
export const shapeLabel = (raw: number) => sig3(clamp01(raw) * 100);

// ── The five algorithms ────────────────────────────────────────────────

/** A control that draws as a 0..1 slider over a raw Live parameter. */
export interface HybridControl {
	index: number;
	name: string;
	/** Live's label for a raw value. */
	label: (raw: number) => string;
	/** The raw rail's top for a stepped parameter (Ti Rate, 29); 1 otherwise. */
	max?: number;
}

const pct = (raw: number) => percentLabel(clamp01(raw) * 100);

const DAMPING: HybridControl = { index: HYBRID.damping, name: 'Damping', label: pct };
const DIFFUSION: HybridControl = { index: HYBRID.diffusion, name: 'Diffusion', label: pct };
const MOD: HybridControl = { index: HYBRID.mod, name: 'Mod', label: pct };

export type AlgorithmKey = 'darkHall' | 'quartz' | 'shimmer' | 'tides' | 'prism';

export interface Algorithm {
	key: AlgorithmKey;
	/** Algo Type (6). */
	type: number;
	name: string;
	/** One line, in our words: what it sounds like. */
	blurb: string;
	/** Its own controls, signature first. Decay, Size, Delay and Freeze are every algorithm's. */
	controls: HybridControl[];
}

export const ALGORITHMS: readonly Algorithm[] = [
	{
		key: 'darkHall',
		type: 0,
		name: 'Dark Hall',
		blurb: 'Smooth, classic hall',
		controls: [
			{ index: HYBRID.hallShape, name: 'Shape', label: shapeLabel },
			{ index: HYBRID.hallBassMult, name: 'Bass Mult', label: (raw) => multLabel(bassMult(raw)) },
			{ index: HYBRID.hallBassX, name: 'Bass X', label: (raw) => hzLabel(bassXHz(raw)) },
			DAMPING,
			MOD
		]
	},
	{
		key: 'quartz',
		type: 1,
		name: 'Quartz',
		blurb: 'Hall with clear echoes',
		controls: [
			{ index: HYBRID.quartzDistance, name: 'Distance', label: pct },
			DIFFUSION,
			{ index: HYBRID.quartzLowDamp, name: 'Lo Damp', label: pct },
			DAMPING,
			MOD
		]
	},
	{
		key: 'shimmer',
		type: 2,
		name: 'Shimmer',
		blurb: 'Pitch-shifted feedback',
		controls: [
			{ index: HYBRID.shimmer, name: 'Shimmer', label: pct },
			{ index: HYBRID.shimmerPitch, name: 'Pitch', label: (raw) => pitchLabel(shimmerSemitones(raw)) },
			DIFFUSION,
			DAMPING,
			MOD
		]
	},
	{
		key: 'tides',
		type: 3,
		name: 'Tides',
		blurb: 'Rippling filter bands',
		controls: [
			{ index: HYBRID.tide, name: 'Tide', label: pct },
			{ index: HYBRID.tidesRate, name: 'Rate', label: tidesRateLabel, max: TIDES_RATE_MAX },
			{ index: HYBRID.tidesWave, name: 'Wave', label: pct },
			{ index: HYBRID.tidesPhase, name: 'Phase', label: (raw) => degreeLabel(clamp01(raw) * 180) },
			DAMPING
		]
	},
	{
		key: 'prism',
		type: 4,
		name: 'Prism',
		blurb: 'Split low / high decay',
		controls: [
			{ index: HYBRID.prismLowMult, name: 'Low Mult', label: (raw) => multLabel(prismMult(raw)) },
			{ index: HYBRID.prismHighMult, name: 'High Mult', label: (raw) => multLabel(prismMult(raw)) },
			{ index: HYBRID.prismXOver, name: 'X-Over', label: (raw) => hzLabel(prismXOverHz(raw)) }
		]
	}
];

export function algorithmFor(type: number): Algorithm {
	return ALGORITHMS[step(type, ALGORITHMS.length - 1)];
}

/** A slider position (0..1) to the raw value Live takes, and back. */
export function controlRaw(control: Pick<HybridControl, 'max'>, position: number): number {
	const max = control.max ?? 1;
	return max === 1 ? clamp01(position) : Math.round(clamp01(position) * max);
}
export function controlPosition(control: Pick<HybridControl, 'max'>, raw: number): number {
	return clamp01(raw / (control.max ?? 1));
}

/**
 * Live's default for every parameter the view reads: what it draws before
 * the device's values arrive (a ghost slot), from the dump's
 * `default_value`.
 */
export const LIVE_DEFAULTS: Readonly<Record<number, number>> = {
	[HYBRID.predelaySync]: 0,
	[HYBRID.predelay]: 0.165425,
	[HYBRID.predelay16th]: 2,
	[HYBRID.predelayFb]: 0,
	[HYBRID.predelayFb16th]: 0,
	[HYBRID.algoType]: 0,
	[HYBRID.algoDelay]: 0,
	[HYBRID.freeze]: 0,
	[HYBRID.freezeIn]: 0,
	[HYBRID.decay]: 0.5,
	[HYBRID.size]: 0.5,
	[HYBRID.damping]: 0.5,
	[HYBRID.diffusion]: 1,
	[HYBRID.mod]: 0.5,
	[HYBRID.hallShape]: 0.5,
	[HYBRID.hallBassMult]: 0.5,
	[HYBRID.hallBassX]: 0.674953,
	[HYBRID.shimmer]: 0.5,
	[HYBRID.shimmerPitch]: 1,
	[HYBRID.tide]: 0.5,
	[HYBRID.tidesRate]: 22,
	[HYBRID.tidesWave]: 0.5,
	[HYBRID.tidesPhase]: 0.5,
	[HYBRID.quartzLowDamp]: 0.5,
	[HYBRID.quartzDistance]: 0.5,
	[HYBRID.prismHighMult]: 0.588592,
	[HYBRID.prismLowMult]: 0.588592,
	[HYBRID.prismXOver]: 0.264455,
	[HYBRID.eqOn]: 1,
	[HYBRID.eqLoType]: 0,
	[HYBRID.eqLoFreq]: 0.200687,
	[HYBRID.eqLoGain]: 0.5,
	[HYBRID.eqLoSlope]: 1,
	[HYBRID.eqPeak1Freq]: 0.514689,
	[HYBRID.eqPeak1Gain]: 0.5,
	[HYBRID.eqPeak1Q]: 0.155668,
	[HYBRID.eqPeak2Freq]: 0.62502,
	[HYBRID.eqPeak2Gain]: 0.5,
	[HYBRID.eqPeak2Q]: 0.155668,
	[HYBRID.eqHiType]: 1,
	[HYBRID.eqHiFreq]: 0.76701,
	[HYBRID.eqHiGain]: 0.5,
	[HYBRID.eqHiSlope]: 1,
	[HYBRID.sendGain]: 1,
	[HYBRID.routing]: ROUTING_ALGORITHM,
	[HYBRID.vintage]: 0,
	[HYBRID.width]: 0.5,
	[HYBRID.bassMono]: 0,
	[HYBRID.dryWet]: 0.5
};
