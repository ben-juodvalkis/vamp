import { describe, it, expect } from 'vitest';
import { graphCurves, WAVETABLE_AXIS, type GraphFilter } from '$lib/utils/wavetableFilterGraph';
import { axisHz, axisX, responseDb, seriesDb, nearestDot } from '$lib/utils/filterGraph';

const lp = (x: number, on = true): GraphFilter => ({ x, y: 0.3, curve: { curveType: 'lowpass', order: 1 }, on });
const hp = (x: number, on = true): GraphFilter => ({ x, y: 0.3, curve: { curveType: 'highpass', order: 1 }, on });

describe('filterGraph', () => {
	it('sweeps an axis on a log scale, and back', () => {
		expect(axisHz(WAVETABLE_AXIS, 0)).toBeCloseTo(20);
		expect(axisHz(WAVETABLE_AXIS, 1)).toBeCloseTo(20480);
		expect(axisX([20, 20000], axisHz([20, 20000], 0.37))).toBeCloseTo(0.37);
		// Below the axis clamps to its end.
		expect(axisX([20, 20000], 10)).toBe(0);
	});

	it('a 24 dB slope falls further past the cutoff than 12 dB', () => {
		const at = (order: number) => responseDb([20, 20000], { hz: 500, res: 0.3, curve: { curveType: 'lowpass', order } });
		expect(at(2).at(-1)!).toBeLessThan(at(1).at(-1)!);
	});

	it('filters in series sum their dB', () => {
		expect(seriesDb([[1, -2], [3, 4]])).toEqual([4, 2]);
	});

	it('a press grabs the nearest dot', () => {
		const dots = [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.5 }];
		expect(nearestDot(dots, 0.25, 0.3)).toBe(0);
		expect(nearestDot(dots, 0.75, 0.3)).toBe(1);
	});
});

describe('wavetableFilterGraph', () => {
	it('Serial draws one curve', () => {
		const curves = graphCurves([hp(0.3), lp(0.7)] as const, 0);
		expect(curves).toHaveLength(1);
		expect(curves[0].filter).toBeNull();
	});

	it('Parallel and Split draw each filter that is on', () => {
		const filters = [hp(0.3), lp(0.7)] as const;
		expect(graphCurves(filters, 1).map((c) => c.filter)).toEqual([1, 2]);
		expect(graphCurves(filters, 2).map((c) => c.filter)).toEqual([1, 2]);
		expect(graphCurves([hp(0.3), lp(0.7, false)] as const, 1).map((c) => c.filter)).toEqual([1]);
	});

	it('a filter that is off adds nothing to the serial curve', () => {
		const alone = graphCurves([lp(0.5), lp(0.2, false)] as const, 0);
		expect(alone).toHaveLength(1);
		expect(alone[0].filter).toBe(1);
		expect(graphCurves([lp(0.5, false), lp(0.2, false)] as const, 0)).toEqual([]);
	});
});
