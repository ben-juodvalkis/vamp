/**
 * Tests for the press machine — the pure half of `use:press`.
 *
 * The contracts here are the ones that were unenforceable while the app
 * spoke `onclick` and `touches[0]`, and every one of them is felt live:
 *
 *  - two fingers on two controls are two independent presses, and neither
 *    one's release ends the other
 *  - `pointercancel` abandons (the browser claimed the gesture — the
 *    performer never released)
 *  - a teardown mid-press abandons, so a strip destroyed under a finger
 *    cannot leave a track soloed with nothing left to undo it
 *  - a press that travels past the slop is a pan, not a tap
 *
 * The machine takes `now` on every input and crosses its hold threshold
 * only on an explicit `tick`, so all of this is table-driven — no timers,
 * no DOM, no iPad.
 */

import { describe, it, expect } from 'vitest';

import {
	createPressMachine,
	PRESS_SLOP,
	type PressEvent
} from '$lib/actions/pressMachine';

/** Compact shape for comparing an event stream in a table. */
function shape(events: PressEvent[]) {
	return events.map((e) =>
		e.type === 'release'
			? { type: e.type, pointerId: e.press.pointerId, reason: e.reason }
			: { type: e.type, pointerId: e.press.pointerId }
	);
}

describe('createPressMachine — one press', () => {
	it('reports down then release-up for a plain tap', () => {
		const m = createPressMachine();
		expect(shape(m.down({ pointerId: 1, x: 10, y: 10, now: 0 }))).toEqual([
			{ type: 'down', pointerId: 1 }
		]);
		expect(shape(m.up({ pointerId: 1, x: 10, y: 10, now: 120 }))).toEqual([
			{ type: 'release', pointerId: 1, reason: 'up' }
		]);
		expect(m.openCount).toBe(0);
	});

	it('carries elapsed time on the release', () => {
		const m = createPressMachine();
		m.down({ pointerId: 1, now: 1000 });
		const [release] = m.up({ pointerId: 1, now: 1350 });
		expect(release).toMatchObject({ type: 'release', elapsedMs: 350 });
	});

	it('reports the DOWN point, not the release point', () => {
		const m = createPressMachine({ slop: 0 });
		m.down({ pointerId: 1, x: 40, y: 90, now: 0 });
		const [release] = m.up({ pointerId: 1, x: 400, y: 900, now: 50 });
		expect(release.press).toMatchObject({ x: 40, y: 90 });
	});

	it('abandons on pointercancel', () => {
		const m = createPressMachine();
		m.down({ pointerId: 1, now: 0 });
		expect(shape(m.cancel({ pointerId: 1, now: 20 }))).toEqual([
			{ type: 'release', pointerId: 1, reason: 'cancel' }
		]);
	});

	it('abandons on teardown mid-press', () => {
		const m = createPressMachine();
		m.down({ pointerId: 1, now: 0 });
		expect(shape(m.teardown(80))).toEqual([
			{ type: 'release', pointerId: 1, reason: 'teardown' }
		]);
		// Idempotent: a teardown after a normal release is a no-op, not a
		// second write.
		expect(m.teardown(90)).toEqual([]);
	});

	it('teardown after a release emits nothing', () => {
		const m = createPressMachine();
		m.down({ pointerId: 1, now: 0 });
		m.up({ pointerId: 1, now: 10 });
		expect(m.teardown(20)).toEqual([]);
	});
});

describe('createPressMachine — slop', () => {
	it('abandons once travel reaches the slop', () => {
		const m = createPressMachine({ slop: 12 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		expect(m.move({ pointerId: 1, x: 11, y: 0, now: 10 })).toEqual([]);
		expect(shape(m.move({ pointerId: 1, x: 12, y: 0, now: 20 }))).toEqual([
			{ type: 'release', pointerId: 1, reason: 'slop' }
		]);
	});

	it('measures travel radially, not per axis', () => {
		const m = createPressMachine({ slop: 10 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		// 8,6 → 10px of travel: neither axis alone would trip a 10px gate.
		expect(shape(m.move({ pointerId: 1, x: 8, y: 6, now: 10 }))).toEqual([
			{ type: 'release', pointerId: 1, reason: 'slop' }
		]);
	});

	it('remembers the FURTHEST travel, so coming back does not rescue it', () => {
		const m = createPressMachine({ slop: 10 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		m.move({ pointerId: 1, x: 5, y: 0, now: 5 });
		const back = m.move({ pointerId: 1, x: 0, y: 0, now: 10 });
		expect(back).toEqual([]);
		// travel high-water is 5, so 5px more still trips it.
		const [release] = m.move({ pointerId: 1, x: 10, y: 0, now: 15 });
		expect(release).toMatchObject({ reason: 'slop' });
	});

	it('slop: 0 disables abandonment entirely', () => {
		const m = createPressMachine({ slop: 0 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		expect(m.move({ pointerId: 1, x: 900, y: 900, now: 10 })).toEqual([]);
		expect(m.isActive(1)).toBe(true);
	});

	it('defaults to the touch slop', () => {
		const m = createPressMachine();
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		expect(m.move({ pointerId: 1, x: PRESS_SLOP - 1, y: 0, now: 5 })).toEqual([]);
		expect(m.move({ pointerId: 1, x: PRESS_SLOP, y: 0, now: 6 })).toHaveLength(1);
	});
});

describe('createPressMachine — hold', () => {
	it('reports a hold once the threshold is crossed, and only once', () => {
		const m = createPressMachine({ holdMs: 300 });
		m.down({ pointerId: 1, now: 0 });
		expect(m.tick(299)).toEqual([]);
		expect(shape(m.tick(300))).toEqual([{ type: 'hold', pointerId: 1 }]);
		expect(m.tick(900)).toEqual([]);
	});

	it('marks the press so a release can tell a hold from a tap', () => {
		const m = createPressMachine({ holdMs: 300 });
		m.down({ pointerId: 1, now: 0 });
		m.tick(400);
		const [release] = m.up({ pointerId: 1, now: 500 });
		expect(release.press.held).toBe(true);
	});

	it('never reports a hold when holdMs is unset', () => {
		const m = createPressMachine();
		m.down({ pointerId: 1, now: 0 });
		expect(m.tick(100_000)).toEqual([]);
	});

	it('a torn-down press reports no hold afterwards', () => {
		const m = createPressMachine({ holdMs: 300 });
		m.down({ pointerId: 1, now: 0 });
		m.teardown(10);
		expect(m.tick(1000)).toEqual([]);
	});
});

describe('createPressMachine — concurrent pointers', () => {
	it('ignores a second finger on a single-pointer machine', () => {
		const m = createPressMachine();
		m.down({ pointerId: 1, now: 0 });
		expect(m.down({ pointerId: 2, now: 5 })).toEqual([]);
		expect(m.openCount).toBe(1);
		// …and that second finger's release is not the first one's.
		expect(m.up({ pointerId: 2, now: 10 })).toEqual([]);
		expect(m.isActive(1)).toBe(true);
	});

	it('holds two independent presses when multiPointer is on', () => {
		const m = createPressMachine({ multiPointer: true });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		m.down({ pointerId: 2, x: 100, y: 0, now: 10 });
		expect(m.activePointers()).toEqual([1, 2]);

		// Releasing 2 leaves 1 alone — this is the case `changedTouches[0]`
		// could not express: the second finger's touchend was read as the
		// first finger's release.
		expect(shape(m.up({ pointerId: 2, now: 20 }))).toEqual([
			{ type: 'release', pointerId: 2, reason: 'up' }
		]);
		expect(m.isActive(1)).toBe(true);
		expect(m.openCount).toBe(1);

		expect(shape(m.up({ pointerId: 1, now: 30 }))).toEqual([
			{ type: 'release', pointerId: 1, reason: 'up' }
		]);
	});

	it('keeps per-pointer down points and elapsed times apart', () => {
		const m = createPressMachine({ multiPointer: true });
		m.down({ pointerId: 7, x: 5, y: 5, now: 100 });
		m.down({ pointerId: 9, x: 300, y: 40, now: 250 });
		const [a] = m.up({ pointerId: 7, now: 400 });
		const [b] = m.up({ pointerId: 9, now: 400 });
		expect(a).toMatchObject({ elapsedMs: 300 });
		expect(a.press).toMatchObject({ x: 5, y: 5 });
		expect(b).toMatchObject({ elapsedMs: 150 });
		expect(b.press).toMatchObject({ x: 300, y: 40 });
	});

	it('a move on one pointer cannot abandon the other', () => {
		const m = createPressMachine({ multiPointer: true, slop: 10 });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		m.down({ pointerId: 2, x: 0, y: 0, now: 0 });
		expect(shape(m.move({ pointerId: 2, x: 50, y: 0, now: 10 }))).toEqual([
			{ type: 'release', pointerId: 2, reason: 'slop' }
		]);
		expect(m.isActive(1)).toBe(true);
		expect(m.openCount).toBe(1);
	});

	it('teardown closes every open press, in arrival order', () => {
		const m = createPressMachine({ multiPointer: true });
		m.down({ pointerId: 3, now: 0 });
		m.down({ pointerId: 1, now: 0 });
		m.down({ pointerId: 2, now: 0 });
		expect(shape(m.teardown(50))).toEqual([
			{ type: 'release', pointerId: 3, reason: 'teardown' },
			{ type: 'release', pointerId: 1, reason: 'teardown' },
			{ type: 'release', pointerId: 2, reason: 'teardown' }
		]);
		expect(m.openCount).toBe(0);
	});

	it('a hold tick reports each held pointer once', () => {
		const m = createPressMachine({ multiPointer: true, holdMs: 300 });
		m.down({ pointerId: 1, now: 0 });
		m.down({ pointerId: 2, now: 200 });
		expect(shape(m.tick(350))).toEqual([{ type: 'hold', pointerId: 1 }]);
		expect(shape(m.tick(500))).toEqual([{ type: 'hold', pointerId: 2 }]);
	});

	it('re-uses a pointer id after its press has closed', () => {
		// Browsers recycle pointerIds. A machine that leaked the old entry
		// would ignore the new press.
		const m = createPressMachine();
		m.down({ pointerId: 1, now: 0 });
		m.up({ pointerId: 1, now: 10 });
		expect(shape(m.down({ pointerId: 1, now: 20 }))).toEqual([
			{ type: 'down', pointerId: 1 }
		]);
	});

	it('ignores a duplicate down for a pointer already held', () => {
		const m = createPressMachine({ multiPointer: true });
		m.down({ pointerId: 1, x: 0, y: 0, now: 0 });
		expect(m.down({ pointerId: 1, x: 50, y: 50, now: 5 })).toEqual([]);
		expect(m.openCount).toBe(1);
	});
});

describe('createPressMachine — events for a foreign pointer', () => {
	it('drops move / up / cancel for a pointer it never claimed', () => {
		const m = createPressMachine();
		m.down({ pointerId: 1, now: 0 });
		expect(m.move({ pointerId: 99, x: 500, y: 500, now: 5 })).toEqual([]);
		expect(m.up({ pointerId: 99, now: 6 })).toEqual([]);
		expect(m.cancel({ pointerId: 99, now: 7 })).toEqual([]);
		expect(m.isActive(1)).toBe(true);
	});
});
