/**
 * How a spectrum moves and looks (ADR-542): pure, so the tests can drive it.
 *
 * Live's readings arrive about 22 times a second as steps. `easeBands` turns
 * them into a meter's motion, drawn every frame: a band rises almost at once
 * (`ATTACK_S`, 81% of a rise in one 60 Hz frame) and falls back gently
 * (`RELEASE_S`), as a meter's ballistics do. `smoothPath` draws one rounded outline through the bands (a
 * Catmull-Rom spline as cubic Béziers, clamped to the box) instead of a
 * skyline of straight segments.
 */

/** Time constants, in seconds: how long a band takes to cover 63% of a change. */
export const ATTACK_S = 0.01;
export const RELEASE_S = 0.18;

/**
 * Move `shown` toward `target` by `dt` seconds of motion, in place: faster
 * when rising than falling. Returns whether anything is still moving (by more
 * than 0.05 dB), so the drawing can stop when it settles.
 */
export function easeBands(shown: number[], target: readonly number[], dt: number, attackS = ATTACK_S, releaseS = RELEASE_S): boolean {
	let moving = false;
	const up = 1 - Math.exp(-Math.max(0, dt) / attackS);
	const down = 1 - Math.exp(-Math.max(0, dt) / releaseS);
	for (let i = 0; i < target.length; i++) {
		const from = shown[i] ?? target[i];
		const to = target[i];
		const next = from + (to - from) * (to > from ? up : down);
		shown[i] = next;
		if (Math.abs(to - next) > 0.05) moving = true;
	}
	shown.length = target.length;
	return moving;
}

/** One point of the outline, in the drawing's 0..100 box. */
export interface Point {
	x: number;
	y: number;
}

const clampY = (y: number) => Math.min(100, Math.max(0, y));
const f = (v: number) => v.toFixed(2);

/**
 * A rounded outline through `points` (left to right), as SVG path commands
 * after a first `M`: Catmull-Rom tangents (tension `smooth`, 0 straight, 1
 * full) turned into cubic Béziers whose handles are clamped to the box, so a
 * peak never overshoots the top or a dip the floor.
 */
export function smoothPath(points: readonly Point[], smooth = 0.5): string {
	if (points.length === 0) return '';
	let d = `M${f(points[0].x)},${f(points[0].y)}`;
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[Math.max(0, i - 1)];
		const p1 = points[i];
		const p2 = points[i + 1];
		const p3 = points[Math.min(points.length - 1, i + 2)];
		const k = smooth / 6;
		const c1 = { x: p1.x + (p2.x - p0.x) * k, y: clampY(p1.y + (p2.y - p0.y) * k) };
		const c2 = { x: p2.x - (p3.x - p1.x) * k, y: clampY(p2.y - (p3.y - p1.y) * k) };
		d += `C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(p2.x)},${f(p2.y)}`;
	}
	return d;
}
