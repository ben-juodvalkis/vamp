/**
 * clipGesture — clip-view-mirror M2.
 *
 * Pure helpers for the editor's drag gestures: edge-handle hit-testing,
 * grid snapping, and clamped value math. The actual pointer-event
 * lifecycle (capture / move / release) stays in the component; these
 * functions are the testable arithmetic underneath, and the same muscle
 * M4 reuses for note drag/resize. The right sidebar's loop brace
 * (`VerticalLoopControl`) snaps through `snapToGrid` + `loopBraceGridBeats`.
 */

/** Which part of a draggable range a pointer grabbed. */
export type DragHandle = 'start' | 'end' | 'move' | null;

/**
 * Hit-test a pointer x (px, content-local) against a range's edges.
 * Returns 'start'/'end' when within `edgePx` of a handle, 'move' when
 * inside the body, or null when outside. `startPx`/`endPx` are the
 * range's pixel bounds (start ≤ end assumed; swapped defensively).
 */
export function hitTestRange(
	x: number,
	startPx: number,
	endPx: number,
	edgePx = 12
): DragHandle {
	let lo = startPx;
	let hi = endPx;
	if (hi < lo) [lo, hi] = [hi, lo];
	// Edges win over body so a thin loop still lets you grab a handle.
	if (Math.abs(x - lo) <= edgePx) return 'start';
	if (Math.abs(x - hi) <= edgePx) return 'end';
	if (x > lo && x < hi) return 'move';
	return null;
}

/** Snap a beat value to the nearest multiple of `gridBeats`. */
export function snapToGrid(beats: number, gridBeats: number): number {
	if (gridBeats <= 0) return beats;
	return Math.round(beats / gridBeats) * gridBeats;
}

/**
 * The right sidebar loop brace's snap grid, in beats, from the length of
 * the clip it spans (the brace's whole height, 0 → end marker): a bar on
 * a clip over 4 bars, half a bar up to 4, a quarter of a bar up to 2.
 *
 * The CLIP decides, not the loop, because the brace draws the whole clip
 * at one scale. A grid keyed on the loop would go finer as the loop shrank
 * inside a long clip, down to steps a finger cannot hit; keyed on the
 * clip, the finest step is an eighth of the brace (2 bars in quarters, 4
 * in halves), the same step an 8-bar clip always had in whole bars.
 *
 * Where a half or quarter bar falls between beats — 3/4, whose quarter bar
 * is ¾ of a beat and whose half bar is the "and" of 2 — the grid is the
 * beat instead. A split of the beat (2/4's quarter bar, an eighth) stands.
 */
export function loopBraceGridBeats(clipBeats: number, beatsPerBar: number): number {
	if (!(beatsPerBar > 0)) return 0;
	const bars = clipBeats / beatsPerBar;
	// Tolerance so a 4-bar clip read back as 16.0000001 beats is still 4 bars.
	const perBar = bars <= 2 + 1e-6 ? 4 : bars <= 4 + 1e-6 ? 2 : 1;
	const grid = beatsPerBar / perBar;
	return Number.isInteger(grid) || Number.isInteger(1 / grid) ? grid : 1;
}

/** Clamp `v` to `[lo, hi]` (returns `lo` if the range is inverted). */
export function clamp(v: number, lo: number, hi: number): number {
	if (hi < lo) return lo;
	if (v < lo) return lo;
	if (v > hi) return hi;
	return v;
}

export interface LoopRange {
	start: number;
	end: number;
}

/**
 * Apply a beat delta to a loop range given the grabbed handle, keeping
 * the range valid: start ≥ `min`, end ≤ `max`, and start/end never cross
 * (a `minGap` enforces a minimum loop length). 'move' shifts both edges
 * together, clamped so neither escapes `[min, max]`.
 *
 * Snapping (when `gridBeats > 0`) is applied to the *moved edge(s)*, not
 * the delta, so a drag lands on grid lines regardless of where it began.
 */
export function applyLoopDrag(args: {
	range: LoopRange;
	handle: Exclude<DragHandle, null>;
	deltaBeats: number;
	min: number;
	max: number;
	minGap: number;
	gridBeats?: number;
}): LoopRange {
	const { range, handle, deltaBeats, min, max, minGap } = args;
	const grid = args.gridBeats ?? 0;
	const snap = (v: number) => (grid > 0 ? snapToGrid(v, grid) : v);

	if (handle === 'start') {
		let next = snap(range.start + deltaBeats);
		next = clamp(next, min, range.end - minGap);
		return { start: next, end: range.end };
	}
	if (handle === 'end') {
		let next = snap(range.end + deltaBeats);
		next = clamp(next, range.start + minGap, max);
		return { start: range.start, end: next };
	}
	// move: shift both, clamped so the whole window stays in [min, max].
	const len = range.end - range.start;
	let newStart = snap(range.start + deltaBeats);
	newStart = clamp(newStart, min, max - len);
	return { start: newStart, end: newStart + len };
}

/**
 * Map a pixel delta to a beat delta given the current beat-window span
 * and the content width in px. The inverse of beats→px scaling.
 */
export function pxDeltaToBeats(deltaPx: number, windowSpanBeats: number, widthPx: number): number {
	if (widthPx <= 0) return 0;
	return (deltaPx / widthPx) * windowSpanBeats;
}
