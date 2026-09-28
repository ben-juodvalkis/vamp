import { describe, it, expect } from 'vitest';
import { contentLocal, velocityFromY } from '$lib/utils/clip/clipPointerMath';

describe('clipPointerMath — contentLocal', () => {
	const rect = { left: 100, top: 40 };
	const PITCH_AXIS_W = 36;
	const TIME_AXIS_H = 18;

	it('subtracts the rect origin and both axis gutters', () => {
		// x: 200 - 100 - 36 = 64 ; y: 90 - 40 - 18 = 32
		expect(contentLocal(200, 90, rect, PITCH_AXIS_W, TIME_AXIS_H)).toEqual({ x: 64, y: 32 });
	});

	it('yields negative coords inside the gutters (caller bounds-checks)', () => {
		const { x, y } = contentLocal(110, 45, rect, PITCH_AXIS_W, TIME_AXIS_H);
		expect(x).toBeLessThan(0);
		expect(y).toBeLessThan(0);
	});
});

describe('clipPointerMath — velocityFromY', () => {
	// Lane = bottom 56px of a 200px container at rectTop=0 → lane spans y∈[144,200].
	const rectTop = 0;
	const containerH = 200;
	const laneH = 56;
	const velMax = 127;

	it('maps the lane top to max velocity', () => {
		expect(velocityFromY(144, rectTop, containerH, laneH, velMax)).toBe(127);
	});

	it('maps the lane bottom to zero', () => {
		expect(velocityFromY(200, rectTop, containerH, laneH, velMax)).toBe(0);
	});

	it('maps the lane midpoint to ~half velocity', () => {
		expect(velocityFromY(172, rectTop, containerH, laneH, velMax)).toBe(64);
	});

	it('clamps above the lane top and below the bottom', () => {
		expect(velocityFromY(0, rectTop, containerH, laneH, velMax)).toBe(127);
		expect(velocityFromY(999, rectTop, containerH, laneH, velMax)).toBe(0);
	});
});
