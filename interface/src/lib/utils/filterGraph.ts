/**
 * A filter's response drawn on a shared pad (2026-11-05): the curves under
 * `FilterDotsGraph`, the pad that carries a dot per filter (Wavetable's two
 * filters, Drift's low-pass and high-pass). Pure.
 *
 * Geometry is a 300 × 300 box the SVG stretches to the pad: frequency across
 * on a log sweep between the pad's own ends (`GraphAxis`, a device's own
 * cutoff range, so a dot's X is that parameter's 0..1), 0 dB on the middle
 * line and ±24 dB to the edges, as `FilterCurve` draws a single filter.
 */
import { FilterResponseCalculator, type FilterType } from '$lib/utils/filterResponseCalculator';
import type { InstrumentCurve } from '$lib/utils/instrumentFilterCurves';

/** The pad's frequency ends, Hz. */
export type GraphAxis = readonly [number, number];

export interface GraphResponse {
	/** Cutoff, Hz. */
	hz: number;
	/** Resonance 0..1 of its rail; a filter with none passes 0 (a flat Q). */
	res: number;
	curve: InstrumentCurve;
}

export const GRAPH_W = 300;
export const GRAPH_H = 300;
const DB_SPAN = 24;
const POINTS = 120;

const calculator = new FilterResponseCalculator(44100);

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** Hz at a position 0..1 across the axis. */
export function axisHz(axis: GraphAxis, x: number): number {
	return axis[0] * Math.pow(axis[1] / axis[0], clamp01(x));
}

/** Where `hz` sits across the axis, 0..1 (clamped). */
export function axisX(axis: GraphAxis, hz: number): number {
	return clamp01(Math.log(hz / axis[0]) / Math.log(axis[1] / axis[0]));
}

function frequencies(axis: GraphAxis): number[] {
	return Array.from({ length: POINTS + 1 }, (_, i) => axisHz(axis, i / POINTS));
}

/** One filter's response in dB at each of the pad's frequencies. */
export function responseDb(axis: GraphAxis, filter: GraphResponse): number[] {
	const freqs = frequencies(axis);
	const type = filter.curve.curveType as FilterType;
	const Q = calculator.normalizedToQ(clamp01(filter.res), 0.5, 30);
	const db = calculator.calculateFrequencyResponse(
		calculator.calculateCoefficients({ type, frequency: filter.hz, sampleRate: 44100, Q }),
		freqs
	).magnitude;
	if (filter.curve.order < 2) return db;
	// The second stage steepens the slope and carries no resonance, as FilterCurve.
	const flat = calculator.calculateFrequencyResponse(
		calculator.calculateCoefficients({ type, frequency: filter.hz, sampleRate: 44100, Q: Math.SQRT1_2 }),
		freqs
	).magnitude;
	return db.map((d, i) => d + flat[i] * (filter.curve.order - 1));
}

/** Filters in series: their responses multiplied, their dB summed. */
export function seriesDb(responses: number[][]): number[] {
	if (responses.length === 0) return [];
	return responses[0].map((_, i) => responses.reduce((acc, r) => acc + r[i], 0));
}

/** An SVG path through a response, clamped to the box. */
export function responsePath(db: number[]): string {
	let d = '';
	db.forEach((value, i) => {
		const x = (i / (db.length - 1)) * GRAPH_W;
		const clamped = Math.min(DB_SPAN, Math.max(-DB_SPAN * 1.5, Number.isFinite(value) ? value : -DB_SPAN * 1.5));
		const y = GRAPH_H / 2 - (clamped / DB_SPAN) * (GRAPH_H / 2);
		d += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
	});
	return d;
}

/** Which of `dots` a touch at (x, y), both 0..1 with y up, lands nearest. Ties go to the first. */
export function nearestDot(dots: readonly { x: number; y: number }[], x: number, y: number): number {
	let best = 0;
	let bestD = Infinity;
	dots.forEach((dot, i) => {
		const d = Math.hypot(dot.x - x, dot.y - y);
		if (d < bestD) {
			best = i;
			bestD = d;
		}
	});
	return best;
}
