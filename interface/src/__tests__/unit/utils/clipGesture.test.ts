import { describe, it, expect } from 'vitest';
import {
	hitTestRange,
	snapToGrid,
	loopBraceGridBeats,
	recordingBars,
	recordingBeat,
	clamp,
	applyLoopDrag,
	pxDeltaToBeats
} from '$lib/utils/clip/clipGesture';

describe('clipGesture — hitTestRange', () => {
	it('detects the start edge within the edge zone', () => {
		expect(hitTestRange(102, 100, 300, 12)).toBe('start');
		expect(hitTestRange(88, 100, 300, 12)).toBe('start');
	});

	it('detects the end edge within the edge zone', () => {
		expect(hitTestRange(295, 100, 300, 12)).toBe('end');
		expect(hitTestRange(311, 100, 300, 12)).toBe('end');
	});

	it('returns move inside the body', () => {
		expect(hitTestRange(200, 100, 300, 12)).toBe('move');
	});

	it('returns null outside the range', () => {
		expect(hitTestRange(50, 100, 300, 12)).toBe(null);
		expect(hitTestRange(350, 100, 300, 12)).toBe(null);
	});

	it('prefers an edge over the body in a thin range', () => {
		// 10px-wide range, 12px edge zone → middle still reads as an edge.
		expect(hitTestRange(105, 100, 110, 12)).toBe('start');
	});

	it('handles an inverted range defensively', () => {
		expect(hitTestRange(102, 300, 100, 12)).toBe('start');
	});
});

describe('clipGesture — snapToGrid', () => {
	it('snaps to the nearest grid multiple', () => {
		expect(snapToGrid(2.3, 1)).toBe(2);
		expect(snapToGrid(2.6, 1)).toBe(3);
		expect(snapToGrid(5, 4)).toBe(4);
		expect(snapToGrid(7, 4)).toBe(8);
	});

	it('is a no-op for a non-positive grid', () => {
		expect(snapToGrid(2.3, 0)).toBe(2.3);
		expect(snapToGrid(2.3, -1)).toBe(2.3);
	});

	it('snaps to fractional grids', () => {
		expect(snapToGrid(0.6, 0.5)).toBe(0.5);
		expect(snapToGrid(0.8, 0.5)).toBe(1);
	});
});

describe('clipGesture — loopBraceGridBeats', () => {
	it('keeps whole bars on a clip over 4 bars', () => {
		expect(loopBraceGridBeats(32, 4)).toBe(4); // 8 bars
		expect(loopBraceGridBeats(17, 4)).toBe(4); // 4¼ bars
	});

	it('snaps to half bars on a clip of 4 bars or less', () => {
		expect(loopBraceGridBeats(16, 4)).toBe(2); // exactly 4 bars
		expect(loopBraceGridBeats(12, 4)).toBe(2);
		expect(loopBraceGridBeats(9, 4)).toBe(2); // 2¼ bars
	});

	it('snaps to quarter bars on a clip of 2 bars or less', () => {
		expect(loopBraceGridBeats(8, 4)).toBe(1); // exactly 2 bars
		expect(loopBraceGridBeats(4, 4)).toBe(1);
		expect(loopBraceGridBeats(2, 4)).toBe(1);
	});

	it('reads a boundary off by float noise as the boundary', () => {
		expect(loopBraceGridBeats(16.0000001, 4)).toBe(2);
		expect(loopBraceGridBeats(8.0000001, 4)).toBe(1);
	});

	it('snaps to the beat where a half or quarter bar falls between beats (3/4)', () => {
		expect(loopBraceGridBeats(12, 3)).toBe(1); // 4 bars: a half bar is 1.5
		expect(loopBraceGridBeats(6, 3)).toBe(1); // 2 bars: a quarter bar is 0.75
		expect(loopBraceGridBeats(24, 3)).toBe(3); // 8 bars: whole bars
	});

	it('keeps a grid that splits the beat evenly (2/4)', () => {
		expect(loopBraceGridBeats(4, 2)).toBe(0.5); // 2 bars: eighths
		expect(loopBraceGridBeats(8, 2)).toBe(1); // 4 bars: half bars
	});

	it('lands a drag on the grid its clip chooses', () => {
		// The brace's own composition: 5.4 beats into a 2-bar 4/4 clip is
		// a quarter bar grid, so 1¼ bars — where whole bars made it 1.
		expect(snapToGrid(5.4, loopBraceGridBeats(8, 4))).toBe(5);
		expect(snapToGrid(5.4, loopBraceGridBeats(32, 4))).toBe(4);
	});

	it('makes no grid for a meter it cannot read', () => {
		expect(loopBraceGridBeats(8, 0)).toBe(0);
		expect(snapToGrid(5.4, loopBraceGridBeats(8, 0))).toBe(5.4);
	});
});

describe('clipGesture — clamp', () => {
	it('clamps to bounds', () => {
		expect(clamp(5, 0, 10)).toBe(5);
		expect(clamp(-1, 0, 10)).toBe(0);
		expect(clamp(11, 0, 10)).toBe(10);
	});
	it('returns lo for an inverted range', () => {
		expect(clamp(5, 10, 0)).toBe(10);
	});
});

describe('clipGesture — pxDeltaToBeats', () => {
	it('scales a pixel delta by the window span', () => {
		expect(pxDeltaToBeats(400, 8, 800)).toBe(4);
		expect(pxDeltaToBeats(-200, 8, 800)).toBe(-2);
	});
	it('returns 0 on degenerate width', () => {
		expect(pxDeltaToBeats(100, 8, 0)).toBe(0);
	});
});

describe('clipGesture — applyLoopDrag', () => {
	const base = { range: { start: 2, end: 6 }, min: 0, max: 16, minGap: 0.25 };

	it('drags the start edge and clamps to min', () => {
		expect(applyLoopDrag({ ...base, handle: 'start', deltaBeats: -1 }).start).toBe(1);
		expect(applyLoopDrag({ ...base, handle: 'start', deltaBeats: -100 }).start).toBe(0);
	});

	it('start cannot cross end (minGap)', () => {
		const r = applyLoopDrag({ ...base, handle: 'start', deltaBeats: +100 });
		expect(r.start).toBeCloseTo(6 - 0.25, 6);
		expect(r.end).toBe(6);
	});

	it('drags the end edge and clamps to max', () => {
		expect(applyLoopDrag({ ...base, handle: 'end', deltaBeats: +2 }).end).toBe(8);
		expect(applyLoopDrag({ ...base, handle: 'end', deltaBeats: +100 }).end).toBe(16);
	});

	it('end cannot cross start (minGap)', () => {
		const r = applyLoopDrag({ ...base, handle: 'end', deltaBeats: -100 });
		expect(r.end).toBeCloseTo(2 + 0.25, 6);
		expect(r.start).toBe(2);
	});

	it('move shifts both edges, preserving length', () => {
		const r = applyLoopDrag({ ...base, handle: 'move', deltaBeats: +3 });
		expect(r).toEqual({ start: 5, end: 9 });
	});

	it('move clamps the whole window inside [min, max]', () => {
		// length 4, max 16 → start can't exceed 12.
		const r = applyLoopDrag({ ...base, handle: 'move', deltaBeats: +100 });
		expect(r).toEqual({ start: 12, end: 16 });
		const l = applyLoopDrag({ ...base, handle: 'move', deltaBeats: -100 });
		expect(l).toEqual({ start: 0, end: 4 });
	});

	it('snaps the moved edge to the grid', () => {
		// start 2.0 + 0.3 = 2.3, snapped to grid 1 → 2.
		const r = applyLoopDrag({ ...base, handle: 'start', deltaBeats: 0.3, gridBeats: 1 });
		expect(r.start).toBe(2);
		// end 6.0 + 0.6 = 6.6, snapped to grid 1 → 7.
		const e = applyLoopDrag({ ...base, handle: 'end', deltaBeats: 0.6, gridBeats: 1 });
		expect(e.end).toBe(7);
	});
});

describe('clipGesture — recordingBars', () => {
	it('reads the bar the playhead is in', () => {
		expect(recordingBars(0, 4)).toBe(1);
		expect(recordingBars(0.5, 4)).toBe(1);
		expect(recordingBars(4, 4)).toBe(1); // on the bar line, still one bar
		expect(recordingBars(4.0000001, 4)).toBe(1);
		expect(recordingBars(4.25, 4)).toBe(2);
		expect(recordingBars(15.9, 4)).toBe(4);
	});
	it('counts bars of the meter', () => {
		expect(recordingBars(3.5, 3)).toBe(2);
	});
	it('falls back to one bar on bad input', () => {
		expect(recordingBars(-2, 4)).toBe(1);
		expect(recordingBars(NaN, 4)).toBe(1);
		expect(recordingBars(8, 0)).toBe(1);
	});
});

describe('clipGesture — recordingBeat', () => {
	it('reads the beat of its bar the playhead is in', () => {
		expect(recordingBeat(0, 4)).toBe(1);
		expect(recordingBeat(0.5, 4)).toBe(1);
		expect(recordingBeat(1, 4)).toBe(1); // on the beat line, still beat 1
		expect(recordingBeat(1.25, 4)).toBe(2);
		expect(recordingBeat(4, 4)).toBe(4); // agrees with recordingBars' bar 1
		expect(recordingBeat(4.25, 4)).toBe(1);
		expect(recordingBeat(15.9, 4)).toBe(4);
	});
	it('counts beats of the meter', () => {
		expect(recordingBeat(3.5, 3)).toBe(1);
		expect(recordingBeat(5.5, 3)).toBe(3);
	});
	it('falls back to beat 1 on bad input', () => {
		expect(recordingBeat(-2, 4)).toBe(1);
		expect(recordingBeat(NaN, 4)).toBe(1);
		expect(recordingBeat(8, 0)).toBe(1);
	});
});
