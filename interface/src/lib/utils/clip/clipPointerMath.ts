/**
 * clipPointerMath — pure pointer→content-local coordinate helpers for the
 * central clip editor.
 *
 * The editor repeatedly maps a raw client (clientX, clientY) into the
 * content area's local space by subtracting the container rect origin plus
 * the two axis gutters (the piano-key column on the left, the bar/beat
 * ruler on top). Carved out of ClipEditorView.svelte so the offset math is
 * defined once and unit-testable. No DOM access — the caller reads the rect.
 */

/** Minimal rect shape (a DOMRect satisfies this). */
export interface RectOrigin {
	left: number;
	top: number;
}

/**
 * Map a client point into content-local coordinates: subtract the rect
 * origin and the left/top axis gutters. The result is relative to the
 * top-left of the scrollable note/waveform content area.
 */
export function contentLocal(
	clientX: number,
	clientY: number,
	rect: RectOrigin,
	pitchAxisWidthPx: number,
	timeAxisHeightPx: number
): { x: number; y: number } {
	return {
		x: clientX - rect.left - pitchAxisWidthPx,
		y: clientY - rect.top - timeAxisHeightPx
	};
}

/**
 * Map a client Y into a velocity value for the bottom velocity lane.
 * The lane occupies the bottom `laneHeightPx` of the container: its top
 * edge = max velocity, its bottom edge = 0. Clamped to `[0, velMax]` and
 * rounded.
 */
export function velocityFromY(
	clientY: number,
	rectTop: number,
	containerHeightPx: number,
	laneHeightPx: number,
	velMax: number
): number {
	const laneTop = rectTop + containerHeightPx - laneHeightPx;
	const frac = 1 - (clientY - laneTop) / laneHeightPx;
	return Math.round(Math.max(0, Math.min(1, frac)) * velMax);
}
