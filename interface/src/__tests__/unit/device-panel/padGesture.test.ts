import { describe, it, expect } from 'vitest';
import {
	TAP_MS,
	TAP_SLOP_PX,
	isTap,
	pastSlop,
	relativeDragValue,
	dragSpan,
	relativeXY,
	relativeOrb
} from '$lib/components/v6/device-panel/padGesture';

describe('isTap / pastSlop', () => {
	it('a quick press that barely moved is a tap', () => {
		expect(isTap(0, 0, 0)).toBe(true);
		expect(isTap(TAP_SLOP_PX - 1, -(TAP_SLOP_PX - 1), TAP_MS - 1)).toBe(true);
	});
	it('a slow press, or one that moved the slop, is not', () => {
		expect(isTap(0, 0, TAP_MS)).toBe(false);
		expect(isTap(TAP_SLOP_PX, 0, 10)).toBe(false);
		expect(isTap(0, -TAP_SLOP_PX, 10)).toBe(false);
	});
	it('pastSlop is the slop on either axis', () => {
		expect(pastSlop(4, 4)).toBe(false);
		expect(pastSlop(5, 0)).toBe(true);
		expect(pastSlop(0, -5)).toBe(true);
	});
});

describe('relativeDragValue', () => {
	it('one size of travel sweeps the whole range', () => {
		expect(relativeDragValue({ startValue: 0, delta: 100, size: 100, min: 0, max: 1 })).toBe(1);
		expect(relativeDragValue({ startValue: -12, delta: 50, size: 100, min: -24, max: 24 })).toBe(12);
	});
	it('scales by sensitivity and clamps to the range', () => {
		expect(relativeDragValue({ startValue: 0.5, delta: 100, size: 100, min: 0, max: 1, sensitivity: 0.25 })).toBe(0.75);
		expect(relativeDragValue({ startValue: 0.5, delta: -400, size: 100, min: 0, max: 1 })).toBe(0);
	});
	it('a degenerate range or size leaves the value', () => {
		expect(relativeDragValue({ startValue: 0.3, delta: 50, size: 100, min: 1, max: 1 })).toBe(0.3);
		expect(relativeDragValue({ startValue: 0.3, delta: 50, size: 0, min: 0, max: 1 })).toBe(0.3);
	});
	it('dragSpan is the longer of the box and the value-box travel', () => {
		expect(dragSpan(100)).toBe(100);
		expect(dragSpan(100, 240)).toBe(240);
		expect(dragSpan(300, 240)).toBe(300);
	});
});

describe('relativeXY', () => {
	it('moves each axis by its share of the pad, up positive', () => {
		expect(relativeXY({ startX: 0.5, startY: 0.5, dx: 50, dy: 25, width: 200, height: 100 })).toEqual({ x: 0.75, y: 0.75 });
	});
	it('honours sensitivity and yTop, and clamps', () => {
		expect(relativeXY({ startX: 0, startY: 0, dx: 200, dy: 50, width: 200, height: 100, sensitivity: [0.5, 1], yTop: 0.5 })).toEqual({ x: 0.5, y: 1 });
		expect(relativeXY({ startX: 0.1, startY: 0.1, dx: -100, dy: -100, width: 100, height: 100 })).toEqual({ x: 0, y: 0 });
	});
});

describe('relativeOrb', () => {
	it('moves the dot from where it was', () => {
		// At the centre, a drag straight up by one radius puts the dot at 12 o'clock, rim.
		const r = relativeOrb({ startAngle: 0.3, startRadius: 0, dx: 0, dy: 40, unitPx: 40 });
		expect(r.radius).toBeCloseTo(1);
		expect(r.angle).toBeCloseTo(0);
	});
	it('clamps to the rim', () => {
		const r = relativeOrb({ startAngle: 0.25, startRadius: 1, dx: 400, dy: 0, unitPx: 40 });
		expect(r.radius).toBe(1);
		expect(r.angle).toBeCloseTo(0.25);
	});
	it('keeps the last angle at the centre', () => {
		const r = relativeOrb({ startAngle: 0.25, startRadius: 0.5, dx: -20, dy: 0, unitPx: 40, lastAngle: 0.6 });
		expect(r.radius).toBeCloseTo(0);
		expect(r.angle).toBe(0.6);
	});
});
