import { describe, it, expect } from 'vitest';
import {
	PAINT_VELOCITY,
	paintSteps,
	paintVelocity,
	stepTaken,
	stripStepAt,
	dragStart,
	dragVelocity,
	stripBlockAt,
	stripBlocks,
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

describe('padNotesStrip — blocks', () => {
	const win = { start: 4, end: 8 };
	it('draws a note where it starts, as long as it is, and drops those outside the window', () => {
		const blocks = stripBlocks(
			[
				{ noteId: 1, startBeats: 4, durationBeats: 0.25, velocity: 100 },
				{ noteId: 2, startBeats: 5.1, durationBeats: 1, velocity: 60 },
				{ noteId: 3, startBeats: 2, durationBeats: 0.25, velocity: 90 },
				{ noteId: 4, startBeats: 7.5, durationBeats: 2, velocity: 90 }
			],
			win
		);
		expect(blocks.map((b) => b.noteId)).toEqual([1, 2, 4]);
		expect(blocks[0].width).toBeCloseTo(0.0625);
		expect(blocks[1].left).toBeCloseTo(0.275);
		expect(blocks[1].width).toBeCloseTo(0.25);
		// Cut at the window's end.
		expect(blocks[2].width).toBeCloseTo(0.125);
	});
	it('takes the block a touch lands on, and only that', () => {
		const blocks = stripBlocks(
			[
				{ noteId: 1, startBeats: 4, durationBeats: 0.25, velocity: 100 },
				{ noteId: 2, startBeats: 6, durationBeats: 0.25, velocity: 60 }
			],
			win
		);
		expect(stripBlockAt(blocks, 0.03)).toBe(0);
		expect(stripBlockAt(blocks, 0.53)).toBe(1);
		// Just past a note's end is the empty step beside it.
		expect(stripBlockAt(blocks, 0.07)).toBeNull();
		expect(stripBlockAt(blocks, 0.3)).toBeNull();
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

describe('padNotesStrip — dragStart', () => {
	// 4 beats over 400px: a 16th step is 25px.
	const win = { start: 4, end: 8 };
	it('moves a note step to step', () => {
		expect(dragStart(5, 25, 400, win)).toBeCloseTo(5.25);
		expect(dragStart(5, -50, 400, win)).toBeCloseTo(4.5);
		expect(dragStart(5, 5, 400, win)).toBeCloseTo(5);
	});
	it('takes an off-step note to the step it is pulled toward first', () => {
		expect(dragStart(5.1, 2, 400, win)).toBeCloseTo(5.25);
		expect(dragStart(5.1, -2, 400, win)).toBeCloseTo(5);
	});
	it('keeps the note inside the window', () => {
		expect(dragStart(5, -400, 400, win)).toBeCloseTo(4);
		expect(dragStart(5, 400, 400, win)).toBeCloseTo(7.75);
	});
});

describe('padNotesStrip — painting notes on empty steps', () => {
	// 4 beats: sixteen 16th steps.
	const win = { start: 4, end: 8 };
	it('finds the step under a touch', () => {
		expect(stripStepAt(0, win)).toBe(0);
		expect(stripStepAt(0.5, win)).toBe(8);
		expect(stripStepAt(0.999, win)).toBe(15);
		expect(stripStepAt(1.2, win)).toBe(15);
	});
	it('knows a step that already holds one of the pad\'s notes', () => {
		const notes = [{ startBeats: 4.5 }, { startBeats: 5.3 }];
		expect(stepTaken(notes, 2, win)).toBe(true);
		expect(stepTaken(notes, 5, win)).toBe(true);
		expect(stepTaken(notes, 3, win)).toBe(false);
	});
	it('lays down every step crossed, either way, skipping taken ones and repeats', () => {
		const taken = (i: number) => i === 4;
		expect(paintSteps([2], 2, 6, taken)).toEqual([2, 3, 5, 6]);
		expect(paintSteps([2, 3, 5, 6], 6, 1, taken)).toEqual([2, 3, 5, 6, 1]);
		expect(paintSteps([], 4, 4, taken)).toEqual([]);
	});
	it('holds the velocity through the deadband, then follows the drag', () => {
		expect(paintVelocity(8, 127)).toBe(PAINT_VELOCITY);
		expect(paintVelocity(-10, 127)).toBe(PAINT_VELOCITY);
		expect(paintVelocity(32, 127)).toBe(120);
		expect(paintVelocity(-52, 127)).toBe(60);
	});
});
