/**
 * Tests for the session grid's action-strip geometry.
 *
 * This module is the single source of the strip's width, read once to
 * PAINT the strip and again to TEST a press. That is the whole reason it
 * exists as a pure function, and it is what these tests pin: if the two
 * readings could ever disagree, a press landing on the button you can
 * see would select instead of firing — the kind of bug that only shows
 * up mid-set, on the iPad, at the moment it costs the most.
 */

import { describe, it, expect } from 'vitest';

import {
	actionStripWidth,
	isInActionStrip,
	ACTION_MIN_PX,
	ACTION_MAX_PX,
	ACTION_FRACTION
} from '$lib/components/v6/tracks/TrackStrip/utils/slotActionZone';

describe('actionStripWidth', () => {
	it('takes its fraction of the cell between the two bounds', () => {
		// 200 * 0.32 = 64, over the max; 130 * 0.32 = 41.6, inside.
		expect(actionStripWidth(130)).toBeCloseTo(130 * ACTION_FRACTION);
		expect(actionStripWidth(130)).toBeGreaterThan(ACTION_MIN_PX);
		expect(actionStripWidth(130)).toBeLessThan(ACTION_MAX_PX);
	});

	it('never exceeds the max however wide the column', () => {
		expect(actionStripWidth(400)).toBe(ACTION_MAX_PX);
		expect(actionStripWidth(10_000)).toBe(ACTION_MAX_PX);
	});

	it('holds the minimum on a narrow column', () => {
		// The 64px `--track-min-w` floor: 64 * 0.28 = 17.9, under the min —
		// and under half the cell too, so the floor is what binds there.
		expect(actionStripWidth(64)).toBe(32);
		expect(actionStripWidth(80)).toBe(ACTION_MIN_PX);
	});

	it('never takes more than half a cell, however narrow', () => {
		// Below 2 × the minimum the strip would leave the body with less
		// room than the strip itself — and selecting is the primary action.
		expect(actionStripWidth(50)).toBe(25);
		expect(actionStripWidth(20)).toBe(10);
	});

	it('is zero for a cell that has not been measured yet', () => {
		// Gates the paint AND the hit test, so a press before the first
		// measurement falls through to select — the safe half of the branch.
		expect(actionStripWidth(0)).toBe(0);
		expect(actionStripWidth(-5)).toBe(0);
		expect(actionStripWidth(Number.NaN)).toBe(0);
	});
});

describe('isInActionStrip', () => {
	// A typical column: 130px wide, so a 41.6px strip on its LEFT edge,
	// ending at x=141.6.
	const LEFT = 100;
	const RIGHT = 230;
	const BOUNDARY = LEFT + actionStripWidth(RIGHT - LEFT);

	it('treats the cell body as select', () => {
		expect(isInActionStrip(RIGHT, LEFT, RIGHT)).toBe(false);
		expect(isInActionStrip(RIGHT - 40, LEFT, RIGHT)).toBe(false);
		expect(isInActionStrip(BOUNDARY + 1, LEFT, RIGHT)).toBe(false);
	});

	it('treats the leading strip as action', () => {
		expect(isInActionStrip(LEFT, LEFT, RIGHT)).toBe(true);
		expect(isInActionStrip(LEFT + 5, LEFT, RIGHT)).toBe(true);
	});

	it('puts the boundary pixel itself on the action side', () => {
		// Matches the painted border, which the strip draws inside its box.
		expect(isInActionStrip(BOUNDARY, LEFT, RIGHT)).toBe(true);
	});

	it('reports no strip for an unmeasured cell', () => {
		expect(isInActionStrip(100, 100, 100)).toBe(false);
	});

	it('agrees with the painted width at every column size', () => {
		// The contract that matters: whatever width the cell paints, the
		// boundary tested here is exactly that far from the leading edge.
		for (const width of [80, 100, 130, 200, 400]) {
			const left = 0;
			const right = width;
			const painted = actionStripWidth(width);
			expect(isInActionStrip(left + painted, left, right)).toBe(true);
			expect(isInActionStrip(left + painted + 0.5, left, right)).toBe(false);
		}
	});
});
