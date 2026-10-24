import { describe, it, expect } from 'vitest';
import {
	dragVelocity,
	stripBarAt,
	stripBars,
	stripStepBeats,
	stripSteps
} from '$lib/components/v6/central/views/drum/padNotesStrip';

describe('padNotesStrip — steps', () => {
	it('picks 16ths up to 2 bars, 8ths up to 4, beats past that', () => {
		expect(stripStepBeats(4)).toBe(0.25);
		expect(stripStepBeats(8)).toBe(0.25);
		expect(stripStepBeats(16)).toBe(0.5);
		expect(stripStepBeats(32)).toBe(1);
	});
	it('marks the step lines that fall on a beat', () => {
		const steps = stripSteps({ start: 0, end: 4 });
		expect(steps).toHaveLength(15);
		expect(steps[3]).toEqual({ at: 0.25, beat: true });
		expect(steps[0].beat).toBe(false);
	});
});

describe('padNotesStrip — bars', () => {
	const win = { start: 4, end: 8 };
	it('draws a note where it starts, a step wide, and drops those outside the loop', () => {
		const bars = stripBars(
			[
				{ noteId: 1, startBeats: 4, velocity: 100 },
				{ noteId: 2, startBeats: 5.1, velocity: 60 },
				{ noteId: 3, startBeats: 2, velocity: 90 },
				{ noteId: 4, startBeats: 8, velocity: 90 }
			],
			win
		);
		expect(bars.map((b) => b.noteId)).toEqual([1, 2]);
		expect(bars[0].left).toBe(0);
		expect(bars[0].width).toBeCloseTo(0.0625);
		expect(bars[1].left).toBeCloseTo(0.275);
	});
	it('takes the nearest bar within half a step of a touch, else none', () => {
		const bars = stripBars([{ noteId: 1, startBeats: 4, velocity: 100 }, { noteId: 2, startBeats: 6, velocity: 60 }], win);
		expect(stripBarAt(bars, 0.03)).toBe(0);
		expect(stripBarAt(bars, 0.53)).toBe(1);
		expect(stripBarAt(bars, 0.3)).toBeNull();
	});
});

describe('padNotesStrip — dragVelocity', () => {
	it('moves the velocity by the drag, the strip height being the whole range', () => {
		expect(dragVelocity(64, 25, 127)).toBe(89);
		expect(dragVelocity(64, 0, 100)).toBe(64);
		expect(dragVelocity(100, -10, 127)).toBe(90);
	});
	it('never goes below 1 or above 127', () => {
		expect(dragVelocity(10, -500, 100)).toBe(1);
		expect(dragVelocity(120, 500, 100)).toBe(127);
	});
});
