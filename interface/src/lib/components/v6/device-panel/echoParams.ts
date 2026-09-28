/**
 * Echo's parameter map, shared by the grid tile and the central view so
 * the two faces cannot disagree about what a gesture writes.
 *
 * Indices are the user's (2026-09-14) and agree with the `Echo.adv`
 * artifact, whose device element is flat (no nested SideChain container
 * to drift the order): 1 Delay_SyncL, 2 Delay_TimeL, 4
 * Delay_SyncedSixteenthL, 16 Feedback, 19 InputGain, 20 OutputGain,
 * 29-32 the HP/LP filter, 52 DryWet. The value spans below are the user's
 * too, in Live's LOM units. Time Link is on in the preset, so R follows L.
 */

export type ParamWrite = readonly [index: number, value: number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + clamp01(t) * (b - a);
/** Where `v` sits between `a` (t = 0) and `b` (t = 1), clamped. */
const unlerp = (a: number, b: number, v: number) => clamp01((v - a) / (b - a));

/** The tile's synced sixteenths, left to right (1..4 — user, 2026-09-14). */
const TILE_SIXTEENTHS = [1, 4] as const;
/** The central view's synced sixteenths, bottom to top. */
const VIEW_SIXTEENTHS = [1, 16] as const;
/** Free time (param 2) across a time gesture — 1 → 0, as specified. */
const TIME_SPAN = [1, 0] as const;
/** The tile's mix ceiling: Y writes mix at half of feedback. */
const TILE_MIX_MAX = 0.5;

function sixteenthsLabel(n: number): string {
	const map: Record<number, string> = { 1: '1/16', 2: '1/8', 4: '1/4', 8: '1/2', 16: '1/1' };
	return map[n] ?? `${n}/16`;
}

export const ECHO = {
	sync: 1,
	time: 2,
	sixteenths: 4,
	feedback: 16,
	inputGain: 19,
	outputGain: 20,
	hpFreq: 29,
	hpRes: 30,
	lpFreq: 31,
	lpRes: 32,
	mix: 52,

	/**
	 * One time gesture (0..1) → both of Echo's time controls, so the finger
	 * means the same whether Sync is on or off. `wide` is the central
	 * view's 1..16 sixteenths; the tile spans 1..4.
	 */
	timeWrites(t: number, wide = false): ParamWrite[] {
		const [lo, hi] = wide ? VIEW_SIXTEENTHS : TILE_SIXTEENTHS;
		return [
			[4, Math.round(lerp(lo, hi, t))],
			[2, lerp(TIME_SPAN[0], TIME_SPAN[1], t)]
		];
	},

	/** The time position to draw, from whichever control Sync makes audible. */
	timeTFrom(synced: boolean, sixteenths: number | undefined, time: number | undefined, wide = false): number {
		const [lo, hi] = wide ? VIEW_SIXTEENTHS : TILE_SIXTEENTHS;
		if (synced) return sixteenths === undefined ? 0 : unlerp(lo, hi, sixteenths);
		return time === undefined ? 0 : unlerp(TIME_SPAN[0], TIME_SPAN[1], time);
	},

	/** Note value synced; Live's own display string when free (else the raw value). */
	timeLabel(synced: boolean, sixteenths: number | undefined, display: string | undefined, time: number | undefined): string {
		if (synced) return sixteenthsLabel(Math.round(sixteenths ?? TILE_SIXTEENTHS[0]));
		if (display) return display;
		return time === undefined ? '' : time.toFixed(2);
	},

	/** The tile's Y: feedback 0..1, mix 0..0.5 along with it. */
	feedbackMixWrites(t: number): ParamWrite[] {
		const y = clamp01(t);
		return [
			[16, y],
			[52, y * TILE_MIX_MAX]
		];
	}
} as const;

/**
 * Echo's LFO, as one rate control that follows LFO Sync (user, 2026-09-14).
 * Names and rails read off the running device (an Echo on Shaker,
 * 12.4.15b2): 34 `LFO Freq` 0..1, 35 `LFO Sync`, 36 `LFO Synced` 0..21,
 * 39 `Dly < Mod` 0..1, 40 `Flt < Mod` 0..1.
 *
 * The readouts are Live's own strings, sampled with `str_for_value`:
 * `LFO Freq` is exactly 0.01 Hz · 4000^v (0 → 0.01, 0.5 → 0.63, 0.8 →
 * 7.61, 0.9 → 17.5, 1 → 40.0 Hz), and `LFO Synced` is the 22 steps below,
 * slowest first. Up is faster in both modes.
 */
export const ECHO_LFO = {
	wave: 33,
	freq: 34,
	sync: 35,
	synced: 36,
	toTime: 39,
	toFilter: 40
} as const;

/** `LFO Wave` (33, quantized 0..5): Live's names via `str_for_value`, value = index. */
export const ECHO_LFO_WAVES = ['Sine', 'Triangle', 'Saw Up', 'Saw Down', 'Square', 'Random'] as const;

const LFO_SYNCED_LABELS = [
	'8', '6', '4', '3', '2', '1.5', '1', '3/4', '1/2', '3/8', '1/3',
	'5/16', '1/4', '3/16', '1/6', '1/8', '1/12', '1/16', '1/24', '1/32', '1/48', '1/64'
] as const;
const LFO_SYNCED_MAX = LFO_SYNCED_LABELS.length - 1;

/** Live's `LFO Freq` string for a 0..1 value: two decimals under 10 Hz, one above. */
export function lfoFreqLabel(v: number): string {
	const hz = 0.01 * Math.pow(4000, clamp01(v));
	return `${hz < 10 ? hz.toFixed(2) : hz.toFixed(1)} Hz`;
}

/** The rate gesture (0..1) → the one rate param Sync makes audible. */
export function lfoRateWrite(synced: boolean, t: number): ParamWrite {
	return synced
		? [ECHO_LFO.synced, Math.round(clamp01(t) * LFO_SYNCED_MAX)]
		: [ECHO_LFO.freq, clamp01(t)];
}

export function lfoRateT(synced: boolean, freq: number | undefined, syncedStep: number | undefined): number {
	if (synced) return syncedStep === undefined ? 0 : clamp01(Math.round(syncedStep) / LFO_SYNCED_MAX);
	return freq === undefined ? 0 : clamp01(freq);
}

export function lfoRateLabel(synced: boolean, freq: number | undefined, syncedStep: number | undefined): string {
	if (synced) {
		if (syncedStep === undefined) return '';
		return LFO_SYNCED_LABELS[Math.min(LFO_SYNCED_MAX, Math.max(0, Math.round(syncedStep)))];
	}
	return freq === undefined ? '' : lfoFreqLabel(freq);
}

/**
 * The filter graph's axes. X is frequency on a log 20 Hz..20 kHz axis
 * (FilterCurve's own), Y is resonance across its rail.
 *
 * The LOM range is read at runtime rather than assumed. Measured on the rig
 * (2026-09-14, an Echo on Shaker, 12.4.15b2): Live reports HP/LP Freq and
 * Res — like L Time, Feedback, Input Gain, Output and Dry Wet — on 0..1,
 * though the `.adv` stores Hz and dB. Only L 16th is in units (1..16). A
 * rail that tops out at 1 is passed through; a rail in Hz (should a Live
 * ever report one) goes through the log mapping.
 */
export const FILTER_HZ = [20, 20000] as const;

export function freqTFrom(value: number | undefined, range: { min: number; max: number } | undefined, atRest: number): number {
	if (value === undefined) return atRest;
	if (!range || range.max <= 1) return clamp01(value);
	const hz = Math.max(FILTER_HZ[0], value);
	return clamp01(Math.log(hz / FILTER_HZ[0]) / Math.log(FILTER_HZ[1] / FILTER_HZ[0]));
}

export function freqValueFor(t: number, range: { min: number; max: number } | undefined): number {
	const x = clamp01(t);
	if (!range || range.max <= 1) return x;
	const hz = FILTER_HZ[0] * Math.pow(FILTER_HZ[1] / FILTER_HZ[0], x);
	return Math.min(range.max, Math.max(range.min, hz));
}

export function resTFrom(value: number | undefined, range: { min: number; max: number } | undefined, atRest: number): number {
	if (value === undefined) return atRest;
	return range && range.max > range.min ? unlerp(range.min, range.max, value) : clamp01(value);
}

export function resValueFor(t: number, range: { min: number; max: number } | undefined): number {
	return range && range.max > range.min ? lerp(range.min, range.max, t) : clamp01(t);
}
