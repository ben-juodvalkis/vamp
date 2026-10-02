/**
 * The Hybrid Reverb's own EQ — the second tab of Live's device: a cut or a
 * shelf at each end, two peaks between. Per the Live manual, an end band
 * in Cut is a pass filter whose Slope (6..96 dB/oct) applies and whose
 * Gain does not; in Shelf, the Gain applies and the Slope does not. By
 * default the EQ follows both engines; Pre Algo puts it before the
 * algorithm. Either way it shapes what the reverb returns, so the tail
 * picture draws its gain per band.
 *
 * The curves: a cut is a Butterworth magnitude of the slope's order (-3 dB
 * at the corner); shelves (Q 0.71) and peaks are RBJ biquads at 48 kHz.
 * Live's own filter designs are not published, so these are the textbook
 * shapes at Live's frequencies, gains, Qs and slopes.
 */
import { FilterResponseCalculator, type BiquadCoefficients } from '$lib/utils/filterResponseCalculator';
import {
	EQ_SLOPES_DB,
	HYBRID,
	eqFreqHz,
	eqGainDb,
	eqGainLabel,
	eqQ,
	eqQLabel,
	eqSlopeLabel,
	hzLabel
} from '$lib/components/v6/device-panel/hybridReverbParams';

export type EqBandKey = 'lo' | 'peak1' | 'peak2' | 'hi';

export interface EqBand {
	key: EqBandKey;
	/** Live's name for the band. */
	name: string;
	/** The handle's mark. */
	mark: string;
	kind: 'cut' | 'shelf' | 'peak';
	/** Which end an end band sits at; null for a peak. */
	end: 'low' | 'high' | null;
	freqIndex: number;
	gainIndex: number;
	qIndex: number | null;
	slopeIndex: number | null;
	typeIndex: number | null;
	/** Raw values: freq, gain and q 0..1, slope 0..9. */
	freq: number;
	gain: number;
	q: number;
	slope: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const slopeStep = (v: number) => Math.min(EQ_SLOPES_DB.length - 1, Math.max(0, Math.round(v)));

/** The four bands, read through `raw` (Live's value per parameter index). */
export function eqBands(raw: (index: number) => number): EqBand[] {
	const end = (key: 'lo' | 'hi'): EqBand => {
		const lo = key === 'lo';
		const typeIndex = lo ? HYBRID.eqLoType : HYBRID.eqHiType;
		const slopeIndex = lo ? HYBRID.eqLoSlope : HYBRID.eqHiSlope;
		return {
			key,
			name: lo ? 'Lo' : 'Hi',
			mark: lo ? 'Lo' : 'Hi',
			kind: raw(typeIndex) >= 0.5 ? 'shelf' : 'cut',
			end: lo ? 'low' : 'high',
			freqIndex: lo ? HYBRID.eqLoFreq : HYBRID.eqHiFreq,
			gainIndex: lo ? HYBRID.eqLoGain : HYBRID.eqHiGain,
			qIndex: null,
			slopeIndex,
			typeIndex,
			freq: raw(lo ? HYBRID.eqLoFreq : HYBRID.eqHiFreq),
			gain: raw(lo ? HYBRID.eqLoGain : HYBRID.eqHiGain),
			q: 0,
			slope: raw(slopeIndex)
		};
	};
	const peak = (n: 1 | 2): EqBand => {
		const [freqIndex, gainIndex, qIndex] =
			n === 1
				? [HYBRID.eqPeak1Freq, HYBRID.eqPeak1Gain, HYBRID.eqPeak1Q]
				: [HYBRID.eqPeak2Freq, HYBRID.eqPeak2Gain, HYBRID.eqPeak2Q];
		return {
			key: n === 1 ? 'peak1' : 'peak2',
			name: `Peak ${n}`,
			mark: String(n),
			kind: 'peak',
			end: null,
			freqIndex,
			gainIndex,
			qIndex,
			slopeIndex: null,
			typeIndex: null,
			freq: raw(freqIndex),
			gain: raw(gainIndex),
			q: raw(qIndex),
			slope: 0
		};
	};
	return [end('lo'), peak(1), peak(2), end('hi')];
}

// ── Response ───────────────────────────────────────────────────────────

const SAMPLE_RATE = 48000;
const calculator = new FilterResponseCalculator(SAMPLE_RATE);

function coefficients(b: EqBand): BiquadCoefficients | null {
	if (b.kind === 'cut') return null;
	return calculator.calculateCoefficients({
		type: b.kind === 'peak' ? 'peak' : b.end === 'low' ? 'lowshelf' : 'highshelf',
		frequency: eqFreqHz(b.freq),
		sampleRate: SAMPLE_RATE,
		Q: b.kind === 'peak' ? eqQ(b.q) : 0.7071,
		gain: eqGainDb(b.gain)
	});
}

function cutDb(b: EqBand, hz: number): number {
	const order = EQ_SLOPES_DB[slopeStep(b.slope)] / 6;
	const fc = eqFreqHz(b.freq);
	const ratio = b.end === 'low' ? fc / hz : hz / fc;
	return -10 * Math.log10(1 + Math.pow(ratio, 2 * order));
}

/** One band's gain in dB at each frequency. */
export function bandCurveDb(b: EqBand, hzs: readonly number[]): number[] {
	const c = coefficients(b);
	if (!c) return hzs.map((hz) => cutDb(b, hz));
	return calculator.calculateFrequencyResponse(c, [...hzs]).magnitude;
}

/** The whole EQ's gain in dB at each frequency; 0 everywhere when it is off. */
export function eqCurveDb(bands: readonly EqBand[], on: boolean, hzs: readonly number[]): number[] {
	const sum = hzs.map(() => 0);
	if (!on) return sum;
	for (const b of bands) bandCurveDb(b, hzs).forEach((db, i) => (sum[i] += db));
	return sum;
}

/** The wet path's gain at a frequency: the EQ plus Send. For the tail picture. */
export function wetLevelDb(bands: readonly EqBand[], on: boolean, send: number): (hz: number) => number {
	const sendDb = send > 0 ? 20 * Math.log10(send) : -60;
	const shaped = bands.map((b) => ({ b, c: coefficients(b) }));
	return (hz) => {
		let db = sendDb;
		if (!on) return db;
		for (const { b, c } of shaped) {
			db += c ? calculator.calculateFrequencyResponse(c, [hz]).magnitude[0] : cutDb(b, hz);
		}
		return db;
	};
}

// ── The editor's plot ──────────────────────────────────────────────────
// 20 Hz..20 kHz across (Live's EQ frequency rail is 20·1000^v, so x is the
// raw value itself), -24..+12 dB up: the ±12 dB of a gain with room below
// for a cut's fall.

export const EQ_X0 = 0.035;
export const EQ_X1 = 0.985;
export const EQ_Y0 = 0.1;
export const EQ_Y1 = 0.78;
export const DB_FLOOR = -24;
export const DB_CEIL = 12;

export const freqX = (raw: number) => EQ_X0 + (EQ_X1 - EQ_X0) * clamp01(raw);
export const hzX = (hz: number) => freqX(Math.log10(hz / 20) / 3);
export function dbY(db: number): number {
	const d = Math.min(DB_CEIL, Math.max(DB_FLOOR, db));
	return EQ_Y0 + ((EQ_Y1 - EQ_Y0) * (d - DB_FLOOR)) / (DB_CEIL - DB_FLOOR);
}

/** Where a band's handle sits: a cut on its -3 dB corner, the rest at their gain. */
export function handleAt(b: EqBand): { x: number; y: number } {
	return { x: freqX(b.freq), y: dbY(b.kind === 'cut' ? -3 : eqGainDb(b.gain)) };
}

/**
 * A relative drag on a band: `dx`/`dy` in px of a `width` × `height` pad
 * (dy up positive). Across moves the frequency; up moves the gain, except
 * on a cut, which has none.
 */
export function dragWrites(
	b: EqBand,
	start: { freq: number; gain: number },
	dx: number,
	dy: number,
	width: number,
	height: number
): [index: number, value: number][] {
	const freq = clamp01(start.freq + dx / (width * (EQ_X1 - EQ_X0)));
	const writes: [number, number][] = [[b.freqIndex, freq]];
	if (b.kind !== 'cut') {
		const db = eqGainDb(start.gain) + (dy / (height * (EQ_Y1 - EQ_Y0))) * (DB_CEIL - DB_FLOOR);
		writes.push([b.gainIndex, clamp01((db + 12) / 24)]);
	}
	return writes;
}

/** The band nearest a point on the pad (both 0..1, y up), by distance on screen. */
export function nearestBand(bands: readonly EqBand[], x: number, y: number, width: number, height: number): EqBand {
	let best = bands[0];
	let bestD = Infinity;
	for (const b of bands) {
		const h = handleAt(b);
		const d = Math.hypot((h.x - x) * width, (h.y - y) * height);
		if (d < bestD) {
			best = b;
			bestD = d;
		}
	}
	return best;
}

/** The readout for a band, in Live's words: "Lo Cut", "121 Hz · 18 dB". */
export function bandReadout(b: EqBand): { name: string; value: string } {
	const hz = hzLabel(eqFreqHz(b.freq));
	if (b.kind === 'cut') return { name: `${b.name} Cut`, value: `${hz} · ${eqSlopeLabel(b.slope)}` };
	if (b.kind === 'shelf') return { name: `${b.name} Shelf`, value: `${hz} · ${eqGainLabel(eqGainDb(b.gain))}` };
	return { name: b.name, value: `${hz} · ${eqGainLabel(eqGainDb(b.gain))} · Q ${eqQLabel(eqQ(b.q))}` };
}
