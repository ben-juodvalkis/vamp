/**
 * Tests for the drag machine — the pure half of `use:drag`, and the
 * axis-commit logic `useStripGestures` now runs on.
 *
 * The safety-critical contracts, all of which would be felt live:
 *
 *  - a cross-axis gesture (row scroll) never dispatches a tap
 *  - `pointercancel` never dispatches a tap
 *  - a press already spent by a hold never also taps
 *  - a teardown mid-drag still closes the drag, so callers that pair
 *    start/end to open shared state cannot strand it open
 *  - two fingers are two drags, and neither one's release ends the other
 */

import { describe, it, expect } from 'vitest';

import {
	createDragMachine,
	DRAG_THRESHOLD,
	TOUCH_DRAG_THRESHOLD,
	type DragEvent
} from '$lib/actions/dragMachine';

function types(events: DragEvent[]) {
	return events.map((e) => e.type);
}

function shape(events: DragEvent[]) {
	return events.map((e) => ({ type: e.type, pointerId: e.drag.pointerId }));
}

describe('createDragMachine — axis commit', () => {
	it('commits to the drag on a vertical-dominant move (commit: y)', () => {
		const m = createDragMachine({ commit: 'y' });
		expect(types(m.down({ pointerId: 1, x: 0, y: 0, now: 0 }))).toEqual(['down']);
		// The committing move is also a move: `dy` already includes the
		// threshold travel, so a fader that skipped it would sit one
		// threshold behind the finger for the rest of the gesture.
		expect(types(m.move({ pointerId: 1, x: 0, y: -20, now: 10 }))).toEqual([
			'pressend',
			'start',
			'move'
		]);
		expect(types(m.move({ pointerId: 1, x: 0, y: -40, now: 20 }))).toEqual(['move']);
		expect(types(m.up({ pointerId: 1, x: 0, y: -40, now: 30 }))).toEqual(['end']);
	});

	it('commits to cross on a horizontal-dominant move (commit: y)', () => {
		const m = createDragMachine({ commit: 'y' });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		expect(types(m.move({ pointerId: 1, x: 30, y: 2, now: 10 }))).toEqual([
			'pressend',
			'cross',
			'crossmove'
		]);
		expect(types(m.move({ pointerId: 1, x: 60, y: 2, now: 20 }))).toEqual([
			'crossmove'
		]);
		// A row scroll is never a tap.
		expect(types(m.up({ pointerId: 1, x: 60, y: 2, now: 30 }))).toEqual([]);
	});

	it('mirrors the rule for commit: x', () => {
		const m = createDragMachine({ commit: 'x' });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		expect(types(m.move({ pointerId: 1, x: 30, y: 0, now: 10 }))).toEqual([
			'pressend',
			'start',
			'move'
		]);
		const n = createDragMachine({ commit: 'x' });
		n.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		expect(types(n.move({ pointerId: 1, x: 0, y: 30, now: 10 }))).toEqual([
			'pressend',
			'cross',
			'crossmove'
		]);
	});

	it('gives a dead diagonal to the drag axis, not the cross axis', () => {
		const m = createDragMachine({ commit: 'y', threshold: 10 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		expect(types(m.move({ pointerId: 1, x: 20, y: -20, now: 10 }))).toEqual([
			'pressend',
			'start',
			'move'
		]);
	});

	it('commit: either takes whichever axis trips first and never crosses', () => {
		const m = createDragMachine({ commit: 'either', threshold: 10 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		expect(types(m.move({ pointerId: 1, x: 30, y: 0, now: 10 }))).toEqual([
			'pressend',
			'start',
			'move'
		]);
	});

	it('commit: immediate opens the drag at pointerdown', () => {
		const m = createDragMachine({ commit: 'immediate' });
		expect(types(m.down({ pointerId: 1, x: 5, y: 5, now: 0 }))).toEqual([
			'down',
			'pressend',
			'start'
		]);
		// Every move counts — no dead zone at the head of the gesture.
		expect(types(m.move({ pointerId: 1, x: 5, y: 6, now: 5 }))).toEqual(['move']);
		expect(m.isDragging).toBe(true);
	});

	it('stays undecided below the threshold', () => {
		const m = createDragMachine({ commit: 'y', threshold: 12 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		expect(m.move({ pointerId: 1, x: 0, y: -11, now: 5 })).toEqual([]);
		expect(m.isDragging).toBe(false);
	});

	it('takes a live pointerType from a move when one is supplied', () => {
		// A real PointerEvent never changes type mid-gesture, so this
		// only matters as fidelity to what `useStripGestures` did before
		// the extraction: it read the threshold off the MOVE event.
		const m = createDragMachine({ commit: 'y' });
		m.down({ pointerId: 1, pointerType: 'touch', x: 0, y: 0, now: 0 });
		expect(
			types(
				m.move({ pointerId: 1, pointerType: 'mouse', x: 0, y: -DRAG_THRESHOLD, now: 5 })
			)
		).toEqual(['pressend', 'start', 'move']);
	});

	it('uses the tight threshold for mouse and the loose one for touch', () => {
		const mouse = createDragMachine({ commit: 'y' });
		mouse.down({ pointerId: 1, pointerType: 'mouse', x: 0, y: 0, now: 0 });
		expect(types(mouse.move({ pointerId: 1, x: 0, y: -DRAG_THRESHOLD, now: 5 }))).toEqual(
			['pressend', 'start', 'move']
		);

		const touch = createDragMachine({ commit: 'y' });
		touch.down({ pointerId: 1, pointerType: 'touch', x: 0, y: 0, now: 0 });
		expect(touch.move({ pointerId: 1, x: 0, y: -DRAG_THRESHOLD, now: 5 })).toEqual([]);
		expect(
			types(touch.move({ pointerId: 1, x: 0, y: -TOUCH_DRAG_THRESHOLD, now: 6 }))
		).toEqual(['pressend', 'start', 'move']);
	});
});

describe('createDragMachine — deltas', () => {
	it('reports dy as pixels travelled UP and dx as pixels RIGHT', () => {
		const m = createDragMachine({ commit: 'either', threshold: 1 });
		m.down({ pointerId: 1, x: 100, y: 200, now: 0 });
		const [, start] = m.move({ pointerId: 1, x: 130, y: 150, now: 10 });
		expect(start.drag).toMatchObject({ dx: 30, dy: 50 });
		const [move] = m.move({ pointerId: 1, x: 70, y: 260, now: 20 });
		expect(move.drag).toMatchObject({ dx: -30, dy: -60 });
	});

	it('keeps the down point fixed for the life of the drag', () => {
		const m = createDragMachine({ commit: 'immediate' });
		m.down({ pointerId: 1, x: 42, y: 84, now: 0 });
		const [move] = m.move({ pointerId: 1, x: 900, y: 900, now: 10 });
		expect(move.drag).toMatchObject({ downX: 42, downY: 84 });
	});
});

describe('createDragMachine — tap, hold and cancel', () => {
	it('dispatches a tap when the gesture never commits', () => {
		const m = createDragMachine({ commit: 'y' });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		m.move({ pointerId: 1, x: 2, y: 2, now: 5 });
		expect(types(m.up({ pointerId: 1, x: 2, y: 2, now: 90 }))).toEqual([
			'pressend',
			'tap'
		]);
	});

	it('never taps after a cancel', () => {
		const m = createDragMachine({ commit: 'y' });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		expect(types(m.cancel({ pointerId: 1, x: 0, y: 0, now: 20 }))).toEqual(['pressend']);
	});

	it('never taps after a hold has fired', () => {
		const m = createDragMachine({ commit: 'y', holdMs: 500 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		expect(types(m.tick(500))).toEqual(['hold']);
		expect(types(m.up({ pointerId: 1, x: 0, y: 0, now: 700 }))).toEqual(['pressend']);
	});

	it('does not fire a hold once the gesture has committed to an axis', () => {
		const m = createDragMachine({ commit: 'y', holdMs: 500, threshold: 10 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		m.move({ pointerId: 1, x: 0, y: -40, now: 100 });
		expect(m.tick(600)).toEqual([]);
	});

	it('closes the press exactly once, whichever way it ends', () => {
		const committed = createDragMachine({ commit: 'y', threshold: 10 });
		committed.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		const atCommit = types(committed.move({ pointerId: 1, x: 0, y: -20, now: 10 }));
		const atRelease = types(committed.up({ pointerId: 1, x: 0, y: -20, now: 20 }));
		expect(atCommit.filter((t) => t === 'pressend')).toHaveLength(1);
		// A press that ended at commit does NOT end again on release — a
		// scroll must not leave a cell lit for the length of the swipe.
		expect(atRelease.filter((t) => t === 'pressend')).toHaveLength(0);
	});
});

describe('createDragMachine — an inert cross axis (crossInert)', () => {
	// The strip fader with no row to scroll. By default a press that leans
	// sideways past the threshold is `cross` for good — right when that
	// axis pans the row, and a silently dead fader drag when it pans
	// nothing, which is what the performer saw: "sometimes the drag does
	// nothing, and the next one works".

	it('a sideways start no longer locks the drag axis out', () => {
		const m = createDragMachine({ commit: 'y', threshold: 12 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0, crossInert: true });
		// 13px right, 2px up: `cross` under the default rule.
		expect(types(m.move({ pointerId: 1, x: 13, y: -2, now: 10 }))).toEqual(['pressend']);
		expect(types(m.move({ pointerId: 1, x: 14, y: -30, now: 20 }))).toEqual(['start', 'move']);
		expect(types(m.move({ pointerId: 1, x: 14, y: -50, now: 30 }))).toEqual(['move']);
		expect(types(m.up({ pointerId: 1, x: 14, y: -50, now: 40 }))).toEqual(['end']);
	});

	it('the default still locks, so a row that can scroll keeps its pan', () => {
		const m = createDragMachine({ commit: 'y', threshold: 12 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		expect(types(m.move({ pointerId: 1, x: 13, y: -2, now: 10 }))).toEqual([
			'pressend',
			'cross',
			'crossmove'
		]);
		expect(types(m.move({ pointerId: 1, x: 14, y: -30, now: 20 }))).toEqual(['crossmove']);
	});

	it('measures dominance from the press point, as the first commit does', () => {
		// 20px sideways first: vertical has to go further than that before
		// it is the drag, so a mostly-sideways swipe drifting a little
		// never nudges the volume.
		const m = createDragMachine({ commit: 'y', threshold: 12 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0, crossInert: true });
		m.move({ pointerId: 1, x: 20, y: 0, now: 10 });
		expect(m.move({ pointerId: 1, x: 20, y: -19, now: 20 })).toEqual([]);
		expect(types(m.move({ pointerId: 1, x: 20, y: -21, now: 30 }))).toEqual(['start', 'move']);
	});

	it('never reports cross or crossmove', () => {
		const m = createDragMachine({ commit: 'y', threshold: 12 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0, crossInert: true });
		const all = [
			...m.move({ pointerId: 1, x: 20, y: 0, now: 10 }),
			...m.move({ pointerId: 1, x: 60, y: 3, now: 20 }),
			...m.move({ pointerId: 1, x: 120, y: 5, now: 30 })
		];
		expect(types(all)).toEqual(['pressend']);
	});

	it('sideways travel still ends the press: no tap', () => {
		const m = createDragMachine({ commit: 'y', threshold: 12 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0, crossInert: true });
		m.move({ pointerId: 1, x: 30, y: 0, now: 10 });
		expect(m.up({ pointerId: 1, x: 30, y: 0, now: 20 })).toEqual([]);
	});

	it('sideways travel still disqualifies the hold', () => {
		const m = createDragMachine({ commit: 'y', threshold: 12, holdMs: 500 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0, crossInert: true });
		m.move({ pointerId: 1, x: 30, y: 0, now: 10 });
		expect(m.tick(600)).toEqual([]);
		expect(m.up({ pointerId: 1, x: 30, y: 0, now: 700 })).toEqual([]);
	});

	it('jitter under the threshold is still a tap', () => {
		const m = createDragMachine({ commit: 'y', threshold: 12 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0, crossInert: true });
		m.move({ pointerId: 1, x: 11, y: 1, now: 10 });
		expect(types(m.up({ pointerId: 1, x: 11, y: 1, now: 20 }))).toEqual(['pressend', 'tap']);
	});

	it('mirrors for commit: x', () => {
		const m = createDragMachine({ commit: 'x', threshold: 12 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0, crossInert: true });
		expect(types(m.move({ pointerId: 1, x: 2, y: 13, now: 10 }))).toEqual(['pressend']);
		expect(types(m.move({ pointerId: 1, x: 30, y: 14, now: 20 }))).toEqual(['start', 'move']);
	});

	it('is latched per press, so the next press can lock again', () => {
		const m = createDragMachine({ commit: 'y', threshold: 12 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0, crossInert: true });
		m.up({ pointerId: 1, x: 0, y: 0, now: 10 });
		m.down({ pointerId: 2, x: 0, y: 0, now: 20 });
		expect(types(m.move({ pointerId: 2, x: 13, y: -2, now: 30 }))).toEqual([
			'pressend',
			'cross',
			'crossmove'
		]);
	});
});

describe('createDragMachine — teardown', () => {
	it('ends an in-flight drag so paired state cannot strand open', () => {
		const m = createDragMachine({ commit: 'immediate' });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		const events = m.teardown(100);
		expect(types(events)).toEqual(['end']);
		expect(events[0]).toMatchObject({ reason: 'teardown' });
		expect(m.openCount).toBe(0);
	});

	it('never taps on teardown', () => {
		const m = createDragMachine({ commit: 'y' });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		expect(types(m.teardown(50))).toEqual(['pressend']);
	});

	it('is idempotent', () => {
		const m = createDragMachine({ commit: 'immediate' });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		m.teardown(10);
		expect(m.teardown(20)).toEqual([]);
	});
});

describe('createDragMachine — concurrent pointers', () => {
	it('ignores a second finger on a single-pointer machine', () => {
		const m = createDragMachine({ commit: 'y' });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		expect(m.down({ pointerId: 2, x: 50, y: 0, now: 5 })).toEqual([]);
		expect(m.openCount).toBe(1);
	});

	it('runs two independent drags when multiPointer is on', () => {
		const m = createDragMachine({ commit: 'immediate', multiPointer: true });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		m.down({ pointerId: 2, x: 200, y: 0, now: 5 });
		expect(m.activePointers()).toEqual([1, 2]);

		const [moveA] = m.move({ pointerId: 1, x: 0, y: -10, now: 10 });
		const [moveB] = m.move({ pointerId: 2, x: 200, y: -40, now: 11 });
		expect(moveA.drag).toMatchObject({ pointerId: 1, dy: 10 });
		expect(moveB.drag).toMatchObject({ pointerId: 2, dy: 40 });

		// Finger 2 lifting must not end finger 1's drag.
		expect(shape(m.up({ pointerId: 2, x: 200, y: -40, now: 20 }))).toEqual([
			{ type: 'end', pointerId: 2 }
		]);
		expect(m.isActive(1)).toBe(true);
		expect(m.isDragging).toBe(true);
	});

	it('lets one pointer commit to the drag while another crosses', () => {
		const m = createDragMachine({ commit: 'y', multiPointer: true, threshold: 10 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		m.down({ pointerId: 2, x: 300, y: 0, now: 0 });
		expect(types(m.move({ pointerId: 1, x: 0, y: -30, now: 10 }))).toEqual([
			'pressend',
			'start',
			'move'
		]);
		expect(types(m.move({ pointerId: 2, x: 340, y: 0, now: 11 }))).toEqual([
			'pressend',
			'cross',
			'crossmove'
		]);
		// The cross release taps nothing; the drag release ends only itself.
		expect(types(m.up({ pointerId: 2, x: 340, y: 0, now: 20 }))).toEqual([]);
		expect(m.isDragging).toBe(true);
		expect(types(m.up({ pointerId: 1, x: 0, y: -30, now: 21 }))).toEqual(['end']);
		expect(m.isDragging).toBe(false);
	});

	it('drops events for a pointer it never claimed', () => {
		const m = createDragMachine({ commit: 'immediate' });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		expect(m.move({ pointerId: 42, x: 900, y: 900, now: 5 })).toEqual([]);
		expect(m.up({ pointerId: 42, x: 0, y: 0, now: 6 })).toEqual([]);
		expect(m.cancel({ pointerId: 42, x: 0, y: 0, now: 7 })).toEqual([]);
		expect(m.isActive(1)).toBe(true);
	});

	it('teardown ends every open drag', () => {
		const m = createDragMachine({ commit: 'immediate', multiPointer: true });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		m.down({ pointerId: 2, x: 0, y: 0, now: 0 });
		expect(shape(m.teardown(30))).toEqual([
			{ type: 'end', pointerId: 1 },
			{ type: 'end', pointerId: 2 }
		]);
	});
});
