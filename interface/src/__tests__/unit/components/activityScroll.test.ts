/**
 * The activity view's scroll (ADR-543): how far a reading has scrolled, the
 * running history, a head that moves on smoothly at the measured rate, and
 * Live's gaps in the line filled.
 */
import { describe, it, expect } from 'vitest';
import { ActivityScroll, shiftBetween, fillGaps, LAG_COLUMNS, MAX_SHIFT } from '$lib/components/v6/central/views/panel/activityScroll';

/** A drum loop as Live draws it: a hit every 15 columns, decaying. */
const loop = (offset: number, n = 128) => Array.from({ length: n }, (_, i) => Math.max(0, 0.4 - ((i + offset) % 15) * 0.025));

describe('shiftBetween', () => {
	it('finds a scroll of a column or two, and none on a still picture', () => {
		expect(shiftBetween(loop(0), loop(0))).toBe(0);
		expect(shiftBetween(loop(0), loop(1))).toBe(1);
		expect(shiftBetween(loop(0), loop(3))).toBe(3);
	});

	it('never mistakes the previous hit for a long scroll', () => {
		// 15 columns on is the same picture again: read as still, not as 15.
		expect(shiftBetween(loop(0), loop(15))).toBe(0);
		expect(MAX_SHIFT).toBeLessThan(15);
	});
});

describe('fillGaps', () => {
	it('fills a gap from the columns either side, and an end from its one neighbor', () => {
		expect(fillGaps([0.8, null, 0.6])).toEqual([0.8, 0.7, 0.6]);
		expect(fillGaps([null, 0.5, null])).toEqual([0.5, 0.5, 0.5]);
		expect(fillGaps([null, null])).toEqual([0, 0]);
	});
});

describe('ActivityScroll', () => {
	it('keeps one history, a reading adding only the columns it scrolled in, the newest held back', () => {
		const s = new ActivityScroll();
		s.push(loop(0, 10), loop(0, 10), 0);
		expect(s.total).toBe(9);
		s.push(loop(2, 10), loop(2, 10), 33);
		expect(s.total).toBe(11);
		expect(s.at(s.fill, 10)).toBeCloseTo(loop(2, 10)[8], 6);
		expect(s.at(s.fill, 0)).toBeCloseTo(loop(0, 10)[0], 6);
	});

	it('never rewrites a column it holds: a reading half a column off moves nothing already drawn', () => {
		const s = new ActivityScroll();
		s.push(loop(0, 30), loop(0, 30), 0);
		const before = [...s.fill];
		s.push(loop(0, 30).map((v) => v + 0.01), loop(0, 30), 33);
		expect(s.fill).toEqual(before);
	});

	it('moves the head on at the measured rate, smoothly, never past the newest column', () => {
		const s = new ActivityScroll();
		// 30 columns a second: one every 33 ms.
		for (let k = 0; k <= 45; k++) s.push(loop(k), loop(k), k * 33.33);
		expect(s.rate).toBeGreaterThan(25);
		expect(s.rate).toBeLessThan(35);
		s.advance(10);
		expect(s.head).toBe(s.total - LAG_COLUMNS);
		// A new column in: the head eases toward it over frames, not in one jump.
		s.push(loop(46), loop(46), 46 * 33.33);
		const start = s.head;
		s.advance(1 / 60);
		expect(s.head - start).toBeGreaterThan(0.3);
		expect(s.head - start).toBeLessThan(0.7);
		s.advance(10);
		expect(s.head).toBe(s.total - LAG_COLUMNS);
	});
});
