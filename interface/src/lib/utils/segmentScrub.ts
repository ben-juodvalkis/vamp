/**
 * Which segment of a strip — or cell of a grid — a pointer is over.
 *
 * Geometry, not hit-testing, and for the same reason the session grid
 * resolves a slot with `slotIndexAt` rather than `elementFromPoint`: the
 * gaps between segments belong to a segment instead of being dead bands
 * that swallow a gesture. It is also what lets a segmented control SCRUB
 * — the container owns one pointer for the whole gesture and asks where
 * it is, so the value follows the finger across the strip instead of
 * needing a separate tap per step.
 *
 * Pure, so the arithmetic is a table test rather than something you have
 * to drag a real finger across to check.
 */

export interface ScrubBox {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * The step `pos` falls in, along an axis starting at `start` and running
 * `extent` long, divided into `count` equal steps. Clamped at both ends,
 * so a finger that slides off the control keeps the end step rather than
 * jumping or going out of range.
 */
export function segmentIndex(pos: number, start: number, extent: number, count: number): number {
	if (count <= 0 || !Number.isFinite(extent) || extent <= 0) return 0;
	const step = Math.floor(((pos - start) / extent) * count);
	return Math.max(0, Math.min(count - 1, step));
}

/**
 * The cell of a `cols` x `rows` grid under (`x`, `y`), in DOM order —
 * row-major, the order `{#each}` fills a CSS grid.
 */
export function gridCellIndex(
	x: number,
	y: number,
	box: ScrubBox,
	cols: number,
	rows: number
): number {
	const col = segmentIndex(x, box.left, box.width, cols);
	const row = segmentIndex(y, box.top, box.height, rows);
	return row * cols + col;
}

/** A DOMRect as a ScrubBox — measured once at press time, never mid-gesture. */
export function scrubBoxOf(el: Element | null | undefined): ScrubBox | null {
	if (!el) return null;
	const r = el.getBoundingClientRect();
	return r.width > 0 && r.height > 0
		? { left: r.left, top: r.top, width: r.width, height: r.height }
		: null;
}
