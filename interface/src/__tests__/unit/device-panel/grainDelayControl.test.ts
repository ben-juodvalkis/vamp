/**
 * Grain Delay's XY (2026-11-11): Pitch across, Feedback up, on the ranges
 * measured off the rig's device (device_dump.js): 3 Pitch -36..12, 5
 * Feedback 0..0.95.
 */
import { describe, expect, it } from 'vitest';
import { DEVICE_CONTROLS } from '$lib/components/v6/device-panel/deviceControls';

const control = DEVICE_CONTROLS.grainDelay!.control;
if (control.kind !== 'xy') throw new Error('Grain Delay is an XY');

describe('Grain Delay control', () => {
	it('writes Pitch in whole semitones across and Feedback up, in Live units', () => {
		expect(control.write(0, 0, () => undefined)).toEqual([[3, -36], [5, 0]]);
		expect(control.write(1, 1, () => undefined)).toEqual([[3, 12], [5, 0.95]]);
		expect(control.write(0.76, 0.5, () => undefined)).toEqual([[3, 0], [5, 0.475]]);
	});

	it('rests at no pitch shift and no feedback', () => {
		expect(control.read(() => undefined)).toEqual({ x: 0.75, y: 0 });
	});

	it('reads back what it wrote', () => {
		const values: Record<number, number> = { 3: 7, 5: 0.95 };
		expect(control.read((ref) => values[ref as number])).toEqual({ x: 43 / 48, y: 1 });
	});

	it('labels the pitch in semitones', () => {
		const label = control.label!;
		expect(label((ref) => ({ 3: 7 })[ref as number], () => '')).toBe('+7 st');
		expect(label((ref) => ({ 3: -12 })[ref as number], () => '')).toBe('-12 st');
		expect(label(() => undefined, () => '')).toBe('0 st');
	});
});
