/**
 * Tests for useStripGestures — the ADR-384 gesture machine, extracted from
 * TrackStrip so the session-mode slot zone can run a second instance.
 *
 * There are no component tests in this repo, so these drive the machine
 * headlessly: a stubbed element plus synthetic pointer events dispatched
 * on `window`, which is where the machine actually binds its listeners.
 *
 * The safety-critical contracts, all of which would be felt live:
 *
 *  - a row scroll never dispatches a tap (scrolling must not select a
 *    track, toggle mute, or launch a clip)
 *  - `pointercancel` never dispatches a tap (the browser claimed the pan)
 *  - one finger per instance, so a second finger on the same strip can't
 *    hijack an in-flight drag
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
	useStripGestures,
	DRAG_THRESHOLD,
	TOUCH_DRAG_THRESHOLD
} from '$lib/components/v6/tracks/composables/useStripGestures.svelte';

/**
 * jsdom has no usable PointerEvent constructor, and the machine only
 * reads pointerId / clientX / clientY / pointerType / type — so a
 * MouseEvent with those stamped on is a faithful stand-in that still
 * dispatches through the real window listeners.
 */
function pointerEvent(
	type: string,
	opts: {
		pointerId?: number;
		clientX?: number;
		clientY?: number;
		pointerType?: string;
	} = {}
): PointerEvent {
	const ev = new MouseEvent(type, {
		clientX: opts.clientX ?? 0,
		clientY: opts.clientY ?? 0,
		bubbles: true,
		cancelable: true
	});
	Object.defineProperty(ev, 'pointerId', { value: opts.pointerId ?? 1 });
	Object.defineProperty(ev, 'pointerType', { value: opts.pointerType ?? 'touch' });
	return ev as unknown as PointerEvent;
}

/** A div whose measured height is fixed, so drag math is predictable. */
function stubElement(height = 200): HTMLElement {
	const el = document.createElement('div');
	el.getBoundingClientRect = () =>
		({ height, width: 100, top: 0, left: 0, right: 100, bottom: height, x: 0, y: 0 }) as DOMRect;
	document.body.appendChild(el);
	return el;
}

interface Recorder {
	down: number;
	dragStart: number;
	dragEnd: number;
	moves: Array<{ dy: number; dx: number; elementHeight: number }>;
	taps: Array<{ x: number; y: number }>;
}

function makeHarness(overrides: Record<string, unknown> = {}) {
	const el = stubElement();
	const rec: Recorder = { down: 0, dragStart: 0, dragEnd: 0, moves: [], taps: [] };
	const gestures = useStripGestures({
		getElement: () => el,
		onDown: () => rec.down++,
		onDragStart: () => rec.dragStart++,
		onDragMove: ({ dy, dx, elementHeight }) => rec.moves.push({ dy, dx, elementHeight }),
		onDragEnd: () => rec.dragEnd++,
		onTap: ({ x, y }) => rec.taps.push({ x, y }),
		...overrides
	});
	return { el, rec, gestures };
}

/** Press → optional moves → release, all on one pointer id. */
function press(gestures: ReturnType<typeof useStripGestures>, x: number, y: number, id = 1) {
	gestures.handlePointerDown(pointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: id }));
}
function move(x: number, y: number, id = 1, pointerType = 'touch') {
	window.dispatchEvent(
		pointerEvent('pointermove', { clientX: x, clientY: y, pointerId: id, pointerType })
	);
}
function release(x: number, y: number, id = 1, type: 'pointerup' | 'pointercancel' = 'pointerup') {
	window.dispatchEvent(pointerEvent(type, { clientX: x, clientY: y, pointerId: id }));
}

let harnesses: Array<ReturnType<typeof makeHarness>> = [];
function harness(overrides: Record<string, unknown> = {}) {
	const h = makeHarness(overrides);
	harnesses.push(h);
	return h;
}

beforeEach(() => {
	harnesses = [];
});

afterEach(() => {
	// Leaked window listeners would cross-talk between tests.
	for (const h of harnesses) h.gestures.destroy();
	document.body.innerHTML = '';
});

describe('tap', () => {
	it('dispatches a tap when the finger never passes the threshold', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		move(51, 102);
		release(51, 102);
		expect(rec.taps).toEqual([{ x: 50, y: 100 }]);
	});

	it('reports the PRESS point, not the release point', () => {
		// The section hit-test runs against where the finger landed; using
		// the release point would dispatch the wrong section on a small
		// drift across a section boundary.
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		move(52, 104);
		release(52, 104);
		expect(rec.taps[0]).toEqual({ x: 50, y: 100 });
	});

	it('taps with no intervening move at all', () => {
		const { rec, gestures } = harness();
		press(gestures, 10, 20);
		release(10, 20);
		expect(rec.taps).toHaveLength(1);
	});

	it('fires onDown at finger-down, before any axis is decided', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		expect(rec.down).toBe(1);
		expect(rec.dragStart).toBe(0);
		release(50, 100);
	});
});

describe('vertical drag', () => {
	it('commits to a drag once travel passes the threshold', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		move(50, 100 - TOUCH_DRAG_THRESHOLD);
		expect(rec.dragStart).toBe(1);
		expect(rec.moves).toHaveLength(1);
		release(50, 100 - TOUCH_DRAG_THRESHOLD);
		expect(rec.dragEnd).toBe(1);
	});

	it('does not commit below the threshold', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		move(50, 100 - (TOUCH_DRAG_THRESHOLD - 1));
		expect(rec.dragStart).toBe(0);
		expect(rec.moves).toHaveLength(0);
	});

	it('reports dy positive when dragging UP', () => {
		// Volume increases upward; a sign flip here would invert every
		// fader on the surface.
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		move(50, 80);
		expect(rec.moves[0].dy).toBe(20);
	});

	it('reports dy negative when dragging DOWN', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		move(50, 120);
		expect(rec.moves[0].dy).toBe(-20);
	});

	it('reports the element height measured at press time', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		move(50, 80);
		expect(rec.moves[0].elementHeight).toBe(200);
	});

	it('never dispatches a tap after a committed drag', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		move(50, 50);
		release(50, 50);
		expect(rec.taps).toHaveLength(0);
	});

	it('tracks isDragging across the drag lifetime', () => {
		const { gestures } = harness();
		expect(gestures.isDragging).toBe(false);
		press(gestures, 50, 100);
		expect(gestures.isDragging).toBe(false);
		move(50, 50);
		expect(gestures.isDragging).toBe(true);
		release(50, 50);
		expect(gestures.isDragging).toBe(false);
	});

	it('keeps streaming moves after the commit', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		move(50, 85);
		move(50, 75);
		move(50, 65);
		expect(rec.moves.map((m) => m.dy)).toEqual([15, 25, 35]);
	});

	it('holds a touch below the touch slop that a mouse would commit on', () => {
		// The thresholds are per pointer type on purpose: 6px is ~1.1mm
		// on the iPad, well inside the roll of an ordinary finger tap,
		// and a tap that committed to an axis was never dispatched as a
		// tap at all — the strip did nothing.
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		move(50, 100 - DRAG_THRESHOLD);
		expect(rec.dragStart).toBe(0);
		release(50, 100 - DRAG_THRESHOLD);
		expect(rec.taps).toHaveLength(1);
	});

	it('commits a MOUSE drag at the tight threshold', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		move(50, 100 - DRAG_THRESHOLD, 1, 'mouse');
		expect(rec.dragStart).toBe(1);
		release(50, 100 - DRAG_THRESHOLD);
	});

	it('wins a tie on the diagonal — vertical is the fader axis', () => {
		// dy >= dx goes vertical; the fader is the primary strip gesture,
		// so an exact diagonal should not scroll the row.
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		move(50 + TOUCH_DRAG_THRESHOLD, 100 - TOUCH_DRAG_THRESHOLD);
		expect(rec.dragStart).toBe(1);
	});
});

describe('horizontal drag (row scroll)', () => {
	it('never dispatches a tap', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		move(50 + TOUCH_DRAG_THRESHOLD + 4, 100);
		release(50 + TOUCH_DRAG_THRESHOLD + 4, 100);
		expect(rec.taps).toHaveLength(0);
	});

	it('does not fire the vertical drag callbacks', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		move(90, 100);
		release(90, 100);
		expect(rec.dragStart).toBe(0);
		expect(rec.moves).toHaveLength(0);
		expect(rec.dragEnd).toBe(0);
	});

	it('drives an ancestor scroller on mouse drags', () => {
		const { el, gestures } = harness();
		const scroller = document.createElement('div');
		scroller.style.overflowX = 'auto';
		Object.defineProperty(scroller, 'scrollWidth', { value: 1000 });
		Object.defineProperty(scroller, 'clientWidth', { value: 300 });
		scroller.scrollLeft = 100;
		document.body.appendChild(scroller);
		scroller.appendChild(el);

		press(gestures, 50, 100);
		// The committing move only anchors lastX — the threshold travel is
		// deliberately not applied as scroll delta, so the row doesn't jump
		// 6px the instant the gesture resolves. Scrolling starts on the
		// next move.
		move(30, 100, 1, 'mouse');
		expect(scroller.scrollLeft).toBe(100);
		move(10, 100, 1, 'mouse');
		// Dragging the content left scrolls the row right.
		expect(scroller.scrollLeft).toBe(120);
	});

	it('leaves scrolling to the browser on touch (native pan-x)', () => {
		const { el, gestures } = harness();
		const scroller = document.createElement('div');
		scroller.style.overflowX = 'auto';
		Object.defineProperty(scroller, 'scrollWidth', { value: 1000 });
		Object.defineProperty(scroller, 'clientWidth', { value: 300 });
		scroller.scrollLeft = 100;
		document.body.appendChild(scroller);
		scroller.appendChild(el);

		press(gestures, 50, 100);
		move(30, 100, 1, 'touch');
		move(10, 100, 1, 'touch');
		// Untouched: the browser owns the pan, we only suppress the tap.
		expect(scroller.scrollLeft).toBe(100);
	});

	it('still consumes the gesture when horizontalScroll is off', () => {
		const { rec, gestures } = harness({ horizontalScroll: false });
		press(gestures, 50, 100);
		move(90, 100, 1, 'mouse');
		release(90, 100);
		expect(rec.taps).toHaveLength(0);
		expect(rec.dragStart).toBe(0);
	});
});

describe('crossAxisLive — no row to scroll', () => {
	// TrackStrip passes `() => rowScrolls`. With the strips fitting the
	// panel a sideways start used to be a "row scroll" of nothing: the
	// fader drag was thrown away whole.

	it('a drag that sets off sideways still reaches the fader', () => {
		const { rec, gestures } = harness({ crossAxisLive: () => false });
		press(gestures, 50, 100);
		move(50 + TOUCH_DRAG_THRESHOLD + 1, 98);
		expect(rec.dragStart).toBe(0);
		move(50 + TOUCH_DRAG_THRESHOLD + 2, 60);
		expect(rec.dragStart).toBe(1);
		expect(rec.moves.map((m) => m.dy)).toEqual([40]);
		release(50 + TOUCH_DRAG_THRESHOLD + 2, 60);
		expect(rec.dragEnd).toBe(1);
		expect(rec.taps).toHaveLength(0);
	});

	it('sideways travel alone is still never a tap', () => {
		const { rec, gestures } = harness({ crossAxisLive: () => false });
		press(gestures, 50, 100);
		move(90, 101);
		release(90, 101);
		expect(rec.taps).toHaveLength(0);
		expect(rec.dragStart).toBe(0);
	});

	it('scrolls nothing, even with a scroller and a mouse', () => {
		const { el, gestures } = harness({ crossAxisLive: () => false });
		const scroller = document.createElement('div');
		scroller.style.overflowX = 'auto';
		Object.defineProperty(scroller, 'scrollWidth', { value: 1000 });
		Object.defineProperty(scroller, 'clientWidth', { value: 300 });
		scroller.scrollLeft = 100;
		document.body.appendChild(scroller);
		scroller.appendChild(el);

		press(gestures, 50, 100);
		move(30, 100, 1, 'mouse');
		move(10, 100, 1, 'mouse');
		expect(scroller.scrollLeft).toBe(100);
	});

	it('is read at every press, so the lock returns when the row can scroll', () => {
		let live = false;
		const { rec, gestures } = harness({ crossAxisLive: () => live });

		press(gestures, 50, 100, 1);
		move(50 + TOUCH_DRAG_THRESHOLD + 1, 98, 1);
		move(50 + TOUCH_DRAG_THRESHOLD + 1, 60, 1);
		release(50 + TOUCH_DRAG_THRESHOLD + 1, 60, 1);
		expect(rec.dragStart).toBe(1);

		live = true;
		press(gestures, 50, 100, 2);
		move(50 + TOUCH_DRAG_THRESHOLD + 1, 98, 2);
		move(50 + TOUCH_DRAG_THRESHOLD + 1, 60, 2);
		release(50 + TOUCH_DRAG_THRESHOLD + 1, 60, 2);
		expect(rec.dragStart).toBe(1);
	});
});

describe('pointercancel', () => {
	it('never dispatches a tap', () => {
		// The browser claiming a native pan must not launch a clip.
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		release(50, 100, 1, 'pointercancel');
		expect(rec.taps).toHaveLength(0);
	});

	it('never taps even when the finger never moved', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		move(50, 101);
		release(50, 101, 1, 'pointercancel');
		expect(rec.taps).toHaveLength(0);
	});

	it('still ends a committed drag so the caller can flush', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		move(50, 50);
		release(50, 50, 1, 'pointercancel');
		expect(rec.dragEnd).toBe(1);
		expect(gestures.isDragging).toBe(false);
	});
});

describe('pointer identity', () => {
	it('ignores a second finger on the same instance', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100, 1);
		press(gestures, 10, 10, 2);
		// The second press must not re-anchor the gesture.
		release(50, 100, 1);
		expect(rec.taps).toEqual([{ x: 50, y: 100 }]);
		expect(rec.down).toBe(1);
	});

	it('ignores moves from an unrelated pointer', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100, 1);
		move(50, 20, 99);
		expect(rec.dragStart).toBe(0);
		release(50, 100, 1);
		expect(rec.taps).toHaveLength(1);
	});

	it('ignores a release from an unrelated pointer', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100, 1);
		release(50, 100, 99);
		expect(rec.taps).toHaveLength(0);
		release(50, 100, 1);
		expect(rec.taps).toHaveLength(1);
	});

	it('accepts a new gesture after the previous one released', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100, 1);
		release(50, 100, 1);
		press(gestures, 60, 110, 2);
		release(60, 110, 2);
		expect(rec.taps).toEqual([
			{ x: 50, y: 100 },
			{ x: 60, y: 110 }
		]);
	});
});

describe('lifecycle', () => {
	it('does nothing when the element is not bound yet', () => {
		const rec = { down: 0 };
		const gestures = useStripGestures({
			getElement: () => null,
			onDown: () => rec.down++
		});
		gestures.handlePointerDown(pointerEvent('pointerdown', { clientX: 1, clientY: 1 }));
		expect(rec.down).toBe(0);
		gestures.destroy();
	});

	it('drops in-flight listeners on destroy', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		gestures.destroy();
		// A release arriving after teardown must not resurrect the tap.
		release(50, 100);
		expect(rec.taps).toHaveLength(0);
	});

	it('honours a custom threshold', () => {
		const { rec, gestures } = harness({ threshold: 20 });
		press(gestures, 50, 100);
		move(50, 90);
		expect(rec.dragStart).toBe(0);
		move(50, 78);
		expect(rec.dragStart).toBe(1);
	});
});

describe('long press', () => {
	// The session grid's "show me this clip without playing it". The
	// contract that matters live is that the two never both fire: a hold
	// that also launched would play the clip it just opened.
	const HOLD = 500;

	function longPressHarness(overrides: Record<string, unknown> = {}) {
		const longPresses: Array<{ x: number; y: number }> = [];
		const h = harness({
			onLongPress: ({ x, y }: { x: number; y: number }) => longPresses.push({ x, y }),
			longPressMs: HOLD,
			...overrides
		});
		return { ...h, longPresses };
	}

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('fires while the finger is still down, not on release', () => {
		const { gestures, longPresses } = longPressHarness();
		press(gestures, 50, 100);
		vi.advanceTimersByTime(HOLD);
		expect(longPresses).toEqual([{ x: 50, y: 100 }]);
	});

	it('consumes the press — the release does NOT also tap', () => {
		const { rec, gestures, longPresses } = longPressHarness();
		press(gestures, 50, 100);
		vi.advanceTimersByTime(HOLD);
		release(50, 100);
		expect(longPresses).toHaveLength(1);
		expect(rec.taps).toHaveLength(0);
	});

	it('a quick tap stays a tap', () => {
		const { rec, gestures, longPresses } = longPressHarness();
		press(gestures, 50, 100);
		vi.advanceTimersByTime(HOLD - 50);
		release(50, 100);
		vi.advanceTimersByTime(HOLD);
		expect(longPresses).toHaveLength(0);
		expect(rec.taps).toEqual([{ x: 50, y: 100 }]);
	});

	it('jitter under the threshold still counts as holding still', () => {
		const { gestures, longPresses } = longPressHarness();
		press(gestures, 50, 100);
		move(50 + TOUCH_DRAG_THRESHOLD - 1, 100);
		vi.advanceTimersByTime(HOLD);
		expect(longPresses).toHaveLength(1);
	});

	it('a vertical drag cancels it — a scene scroll is not a hold', () => {
		const { rec, gestures, longPresses } = longPressHarness();
		press(gestures, 50, 100);
		move(50, 100 - TOUCH_DRAG_THRESHOLD - 1);
		vi.advanceTimersByTime(HOLD);
		release(50, 40);
		expect(longPresses).toHaveLength(0);
		expect(rec.dragStart).toBe(1);
	});

	it('a row scroll cancels it', () => {
		const { rec, gestures, longPresses } = longPressHarness();
		press(gestures, 50, 100);
		move(50 + TOUCH_DRAG_THRESHOLD + 1, 100);
		vi.advanceTimersByTime(HOLD);
		release(80, 100);
		expect(longPresses).toHaveLength(0);
		expect(rec.taps).toHaveLength(0);
	});

	it('does not leak across presses — the next tap is a tap', () => {
		const { rec, gestures, longPresses } = longPressHarness();
		press(gestures, 50, 100);
		vi.advanceTimersByTime(HOLD);
		release(50, 100);
		press(gestures, 50, 100);
		release(50, 100);
		expect(longPresses).toHaveLength(1);
		expect(rec.taps).toHaveLength(1);
	});

	it('destroy() cancels a pending hold', () => {
		// Unmounting mid-press is reachable (a track removed, the mode
		// toggled) — a timer surviving it would focus a clip in a grid
		// that is gone.
		const { gestures, longPresses } = longPressHarness();
		press(gestures, 50, 100);
		gestures.destroy();
		vi.advanceTimersByTime(HOLD);
		expect(longPresses).toHaveLength(0);
	});

	it('pointercancel cancels it', () => {
		const { gestures, longPresses } = longPressHarness();
		press(gestures, 50, 100);
		release(50, 100, 1, 'pointercancel');
		vi.advanceTimersByTime(HOLD);
		expect(longPresses).toHaveLength(0);
	});

	it('no onLongPress configured → taps behave exactly as before', () => {
		const { rec, gestures } = harness();
		press(gestures, 50, 100);
		vi.advanceTimersByTime(2000);
		release(50, 100);
		expect(rec.taps).toEqual([{ x: 50, y: 100 }]);
	});
});

describe('independence across instances', () => {
	it('lets two instances own their own finger simultaneously', () => {
		// Multitouch across strips: volume on one, launch on another.
		const a = harness();
		const b = harness();
		press(a.gestures, 50, 100, 1);
		press(b.gestures, 200, 100, 2);
		move(50, 40, 1);
		release(50, 40, 1);
		release(200, 100, 2);
		expect(a.rec.dragStart).toBe(1);
		expect(a.rec.taps).toHaveLength(0);
		expect(b.rec.taps).toEqual([{ x: 200, y: 100 }]);
	});
});

describe('two-finger chord', () => {
	function chordHarness(claim = true) {
		const ends: Array<{ reason: string; elapsedMs: number }> = [];
		let starts = 0;
		const h = harness({
			onChordStart: () => {
				starts++;
				return claim;
			},
			onChordEnd: (info: { reason: string; elapsedMs: number }) => ends.push(info)
		});
		return { ...h, ends, starts: () => starts };
	}

	it('claims a second finger while the first is still a candidate tap', () => {
		const { rec, gestures, ends, starts } = chordHarness();
		press(gestures, 50, 100, 1);
		press(gestures, 60, 100, 2);
		expect(starts()).toBe(1);
		release(50, 100, 1);
		release(60, 100, 2);
		// The first finger's tap is dropped: the chord replaced it.
		expect(rec.taps).toHaveLength(0);
		expect(ends).toHaveLength(1);
		expect(ends[0].reason).toBe('up');
	});

	it('ends only when the LAST finger lifts, and movement is not a fader', () => {
		const { rec, gestures, ends } = chordHarness();
		press(gestures, 50, 100, 1);
		press(gestures, 60, 100, 2);
		release(50, 100, 1);
		expect(ends).toHaveLength(0);
		move(60, 40, 2);
		expect(rec.dragStart).toBe(0);
		expect(rec.moves).toHaveLength(0);
		release(60, 40, 2);
		expect(ends).toHaveLength(1);
	});

	it('reports elapsed time from the chord start', () => {
		const now = vi.spyOn(performance, 'now');
		now.mockReturnValue(1000);
		const { gestures, ends } = chordHarness();
		press(gestures, 50, 100, 1);
		now.mockReturnValue(1040);
		press(gestures, 60, 100, 2);
		now.mockReturnValue(1940);
		release(50, 100, 1);
		release(60, 100, 2);
		expect(ends[0].elapsedMs).toBe(900);
		now.mockRestore();
	});

	it('a cancelled finger makes the whole chord a cancel', () => {
		const { gestures, ends } = chordHarness();
		press(gestures, 50, 100, 1);
		press(gestures, 60, 100, 2);
		release(50, 100, 1, 'pointercancel');
		release(60, 100, 2);
		expect(ends[0].reason).toBe('cancel');
	});

	it('never interrupts a first finger already dragging the fader', () => {
		const { rec, gestures, starts } = chordHarness();
		press(gestures, 50, 100, 1);
		move(50, 100 - TOUCH_DRAG_THRESHOLD - 2, 1);
		expect(rec.dragStart).toBe(1);
		press(gestures, 60, 100, 2);
		expect(starts()).toBe(0);
		release(50, 60, 1);
		expect(rec.dragEnd).toBe(1);
	});

	it('a declined chord leaves the first finger as it was', () => {
		const { rec, gestures, ends } = chordHarness(false);
		press(gestures, 50, 100, 1);
		press(gestures, 60, 100, 2);
		release(60, 100, 2);
		release(50, 100, 1);
		expect(rec.taps).toEqual([{ x: 50, y: 100 }]);
		expect(ends).toHaveLength(0);
	});

	it('a third finger joins the chord', () => {
		const { gestures, ends } = chordHarness();
		press(gestures, 50, 100, 1);
		press(gestures, 60, 100, 2);
		press(gestures, 70, 100, 3);
		release(50, 100, 1);
		release(60, 100, 2);
		expect(ends).toHaveLength(0);
		release(70, 100, 3);
		expect(ends).toHaveLength(1);
	});

	it('unmounting mid-chord ends it as a teardown', () => {
		const { gestures, ends } = chordHarness();
		press(gestures, 50, 100, 1);
		press(gestures, 60, 100, 2);
		gestures.destroy();
		expect(ends[0].reason).toBe('teardown');
	});

	it('a fresh single tap works after a chord', () => {
		const { rec, gestures } = chordHarness();
		press(gestures, 50, 100, 1);
		press(gestures, 60, 100, 2);
		release(50, 100, 1);
		release(60, 100, 2);
		press(gestures, 50, 100, 4);
		release(50, 100, 4);
		expect(rec.taps).toEqual([{ x: 50, y: 100 }]);
	});
});
