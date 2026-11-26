/**
 * The value math and tap rule shared by the device panel's continuous
 * controls: `DeviceSlider`, `DeviceXY`, `OrbControl` and `ToneCurvePad`'s
 * shelves. Each runs on `use:drag` (`commit: 'immediate'`), which owns
 * the pointer (one finger per control; a second finger neither drives
 * nor ends the gesture) and its teardown; what a drag MEANS lives here,
 * pure, so it is tested without a DOM.
 *
 * `dx` / `dy` are the action's: pixels right / UP from the press point.
 */

/** A press shorter than this, that moved less than {@link TAP_SLOP_PX}, is a tap. */
export const TAP_MS = 200;
/**
 * Travel (px, on either axis) a press stays inside to remain a tap, and
 * that an XY, orb or shelf drag must pass before it writes anything, so
 * finger wobble on a tap never moves a value.
 */
export const TAP_SLOP_PX = 5;

/** Whether a released press was a tap: quick, and it barely moved. */
export function isTap(dx: number, dy: number, elapsedMs: number): boolean {
	return elapsedMs < TAP_MS && Math.abs(dx) < TAP_SLOP_PX && Math.abs(dy) < TAP_SLOP_PX;
}

/** Whether a press has travelled past the tap slop on either axis. */
export function pastSlop(dx: number, dy: number): boolean {
	return Math.abs(dx) >= TAP_SLOP_PX || Math.abs(dy) >= TAP_SLOP_PX;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * A relative drag on one axis: the value at press time, moved by the
 * finger's travel as a share of `size` px (one `size` sweeps the whole
 * range, times `sensitivity`), clamped to `[min, max]`. `delta` is in the
 * "more" direction: `dy` for a vertical control, `dx` for a horizontal one.
 */
export function relativeDragValue(opts: {
	startValue: number;
	delta: number;
	size: number;
	min: number;
	max: number;
	sensitivity?: number;
}): number {
	const { startValue, delta, size, min, max, sensitivity = 1 } = opts;
	if (max <= min || !(size > 0)) return startValue;
	const normalized = (startValue - min) / (max - min);
	const next = clamp01(normalized + (delta / size) * sensitivity);
	return min + next * (max - min);
}

/**
 * The finger travel (px) that sweeps a slider's full range: the box's own
 * length, or a value box's travel when that is longer (ADR-477).
 */
export function dragSpan(length: number, travel?: number): number {
	return travel ? Math.max(length, travel) : length;
}

/** An XY pad's relative drag: each axis from its press-time value, clamped to 0..1. */
export function relativeXY(opts: {
	startX: number;
	startY: number;
	dx: number;
	dy: number;
	width: number;
	height: number;
	sensitivity?: readonly [number, number];
	yTop?: number;
}): { x: number; y: number } {
	const { startX, startY, dx, dy, width, height, sensitivity = [1, 1], yTop = 1 } = opts;
	return {
		x: clamp01(startX + (dx / width) * sensitivity[0]),
		y: clamp01(startY + (dy / (height * yTop)) * sensitivity[1])
	};
}

/**
 * The orb's relative drag (2026-11-20): the dot moves from where it was,
 * one to one with the drawn disc, clamped to the rim. `unitPx` is pixels
 * per unit of radius. At the centre the angle is undefined: `lastAngle`
 * (the dot's angle so far this drag, else the start) is kept.
 */
export function relativeOrb(opts: {
	startAngle: number;
	startRadius: number;
	dx: number;
	dy: number;
	unitPx: number;
	lastAngle?: number;
}): { angle: number; radius: number } {
	const { startAngle, startRadius, dx, dy, unitPx, lastAngle = startAngle } = opts;
	const a = startAngle * 2 * Math.PI;
	// Unit disc, +x right, +y down.
	let nx = startRadius * Math.sin(a) + dx / unitPx;
	let ny = -startRadius * Math.cos(a) - dy / unitPx;
	const r = Math.hypot(nx, ny);
	if (r > 1) {
		nx /= r;
		ny /= r;
	}
	const angle = r > 1e-4 ? (Math.atan2(nx, -ny) / (2 * Math.PI) + 1) % 1 : lastAngle;
	return { angle, radius: Math.min(1, r) };
}
