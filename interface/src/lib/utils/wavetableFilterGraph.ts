/**
 * Wavetable's two filters on one pad, as Live's panel draws them
 * (2026-11-05, ADR-507): Serial is one curve, the two responses multiplied
 * (their dB summed); Parallel and Split are each filter's own curve. A
 * filter that is off draws no curve and adds nothing to the serial one.
 *
 * `filter_routing` is Live's `WavetableDevice.FilterRouting`, read off the
 * running Live 12.4.25b1 on 2026-11-05: serial 0, parallel 1, split 2.
 * The pad's axis is the filters' own cutoff sweep, so a dot's X is the
 * parameter's 0..1.
 */
import { FILTER_FREQ_RANGE, type InstrumentCurve } from '$lib/utils/instrumentFilterCurves';
import { axisHz, responseDb, responsePath, seriesDb, type GraphAxis } from '$lib/utils/filterGraph';

export const FILTER_ROUTINGS = ['Serial', 'Parallel', 'Split'] as const;
export const WAVETABLE_AXIS: GraphAxis = FILTER_FREQ_RANGE.wavetable;

export interface GraphFilter {
	/** Cutoff, the parameter's own 0..1. */
	x: number;
	/** Resonance, 0..1 of its rail. */
	y: number;
	curve: InstrumentCurve;
	on: boolean;
}

const response = (f: GraphFilter) => responseDb(WAVETABLE_AXIS, { hz: axisHz(WAVETABLE_AXIS, f.x), res: f.y, curve: f.curve });

/**
 * The curves to draw: one combined curve in Serial (`filter` null, or the
 * one filter that is on), else one per filter that is on. Nothing when both
 * are off.
 */
export function graphCurves(filters: readonly [GraphFilter, GraphFilter], routing: number): { filter: 1 | 2 | null; d: string }[] {
	const on = ([1, 2] as const).filter((n) => filters[n - 1].on);
	if (on.length === 0) return [];
	if (routing === 0) {
		return [{ filter: on.length === 1 ? on[0] : null, d: responsePath(seriesDb(on.map((n) => response(filters[n - 1])))) }];
	}
	return on.map((n) => ({ filter: n, d: responsePath(response(filters[n - 1])) }));
}
