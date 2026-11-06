/**
 * Wavetable's two filters on one graph, as Live's panel draws them
 * (2026-11-05): Serial is one curve, the two responses multiplied (their dB
 * summed); Parallel and Split are each filter's own curve. A filter that is
 * off draws no curve and adds nothing to the serial one.
 *
 * `filter_routing` is Live's `WavetableDevice.FilterRouting`, read off the
 * running Live 12.4.25b1 on 2026-11-05: serial 0, parallel 1, split 2.
 *
 * Geometry is a 300 × 300 box (the SVG stretches it to the pad): frequency
 * across on Live's own 20 Hz..20.48 kHz log sweep, so a dot's X is the
 * parameter's own 0..1; 0 dB on the middle line, ±24 dB to the edges, as
 * `FilterCurve` draws a single filter.
 */
import { FilterResponseCalculator, type FilterType } from '$lib/utils/filterResponseCalculator';
import { FILTER_FREQ_RANGE, type InstrumentCurve } from '$lib/utils/instrumentFilterCurves';

export const FILTER_ROUTINGS = ['Serial', 'Parallel', 'Split'] as const;
export type FilterRouting = 0 | 1 | 2;

export interface GraphFilter {
	/** Cutoff, the parameter's own 0..1 (a log sweep over FILTER_FREQ_RANGE.wavetable). */
	x: number;
	/** Resonance, 0..1 of its rail. */
	y: number;
	curve: InstrumentCurve;
	on: boolean;
}

export const GRAPH_W = 300;
export const GRAPH_H = 300;
const DB_SPAN = 24;
const POINTS = 120;

const calculator = new FilterResponseCalculator(44100);
const [LO, HI] = FILTER_FREQ_RANGE.wavetable;
const FREQS = Array.from({ length: POINTS + 1 }, (_, i) => LO * Math.pow(HI / LO, i / POINTS));

/** Hz at a cutoff position 0..1. */
export const cutoffHz = (x: number) => LO * Math.pow(HI / LO, Math.min(1, Math.max(0, x)));

/** One filter's response in dB at each of the graph's frequencies. */
export function filterResponseDb(filter: GraphFilter): number[] {
	const frequency = cutoffHz(filter.x);
	const type = filter.curve.curveType as FilterType;
	const Q = calculator.normalizedToQ(Math.min(1, Math.max(0, filter.y)), 0.5, 30);
	const db = calculator.calculateFrequencyResponse(
		calculator.calculateCoefficients({ type, frequency, sampleRate: 44100, Q }),
		FREQS
	).magnitude;
	if (filter.curve.order < 2) return db;
	// The second stage steepens the slope and carries no resonance, as FilterCurve.
	const flat = calculator.calculateFrequencyResponse(
		calculator.calculateCoefficients({ type, frequency, sampleRate: 44100, Q: Math.SQRT1_2 }),
		FREQS
	).magnitude;
	return db.map((d, i) => d + flat[i] * (filter.curve.order - 1));
}

/** An SVG path through a response, clamped to the box. */
export function responsePath(db: number[]): string {
	let d = '';
	db.forEach((value, i) => {
		const x = (i / POINTS) * GRAPH_W;
		const clamped = Math.min(DB_SPAN, Math.max(-DB_SPAN * 1.5, Number.isFinite(value) ? value : -DB_SPAN * 1.5));
		const y = GRAPH_H / 2 - (clamped / DB_SPAN) * (GRAPH_H / 2);
		d += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
	});
	return d;
}

/**
 * The curves to draw: one combined curve in Serial (`filter` null), else
 * one per filter that is on. Nothing when both are off.
 */
export function graphCurves(filters: readonly [GraphFilter, GraphFilter], routing: number): { filter: 1 | 2 | null; d: string }[] {
	const on = ([1, 2] as const).filter((n) => filters[n - 1].on);
	if (on.length === 0) return [];
	if (routing === 0) {
		const responses = on.map((n) => filterResponseDb(filters[n - 1]));
		const sum = responses[0].map((_, i) => responses.reduce((acc, r) => acc + r[i], 0));
		return [{ filter: on.length === 1 ? on[0] : null, d: responsePath(sum) }];
	}
	return on.map((n) => ({ filter: n, d: responsePath(filterResponseDb(filters[n - 1])) }));
}

/** Which dot a touch at (x, y), both 0..1 with y up, lands nearer. Ties go to Filter 1. */
export function nearerFilter(filters: readonly [GraphFilter, GraphFilter], x: number, y: number): 1 | 2 {
	const d = (f: GraphFilter) => Math.hypot(f.x - x, f.y - y);
	return d(filters[1]) < d(filters[0]) ? 2 : 1;
}
