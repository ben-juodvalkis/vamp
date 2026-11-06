import { describe, it, expect } from 'vitest';
import { graphCurves, nearerFilter, filterResponseDb, cutoffHz, type GraphFilter } from '$lib/utils/wavetableFilterGraph';

const lp = (x: number, on = true): GraphFilter => ({ x, y: 0.3, curve: { curveType: 'lowpass', order: 1 }, on });
const hp = (x: number, on = true): GraphFilter => ({ x, y: 0.3, curve: { curveType: 'highpass', order: 1 }, on });

describe('wavetableFilterGraph', () => {
	it('sweeps Live’s 20 Hz..20.48 kHz', () => {
		expect(cutoffHz(0)).toBeCloseTo(20);
		expect(cutoffHz(1)).toBeCloseTo(20480);
	});

	it('Serial draws one curve, the dB of both summed', () => {
		const filters = [hp(0.3), lp(0.7)] as const;
		const curves = graphCurves(filters, 0);
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

	it('a 24 dB slope falls further past the cutoff than 12 dB', () => {
		const f12 = filterResponseDb(lp(0.3));
		const f24 = filterResponseDb({ ...lp(0.3), curve: { curveType: 'lowpass', order: 2 } });
		expect(f24[f24.length - 1]).toBeLessThan(f12[f12.length - 1]);
	});

	it('a press grabs the nearer dot', () => {
		const filters = [lp(0.2), lp(0.8)] as const;
		expect(nearerFilter(filters, 0.25, 0.3)).toBe(1);
		expect(nearerFilter(filters, 0.75, 0.3)).toBe(2);
	});
});
