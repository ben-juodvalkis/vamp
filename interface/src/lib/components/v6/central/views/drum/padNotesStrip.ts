/**
 * The scoped pad's notes strip (`PadNotesStrip.svelte`): where its steps
 * and its notes fall across the clip's loop, and what a drag does to a
 * velocity. Pure, so it is tested without a browser.
 */

import type { TimeRange } from '$lib/utils/waveformPaint';

export const STRIP_VELOCITY_MAX = 127;

/** A step's length for a window: 16ths up to 2 bars, 8ths up to 4, beats past that. */
export function stripStepBeats(spanBeats: number): number {
	if (spanBeats <= 8) return 0.25;
	if (spanBeats <= 16) return 0.5;
	return 1;
}

export interface StripNote {
	noteId: number;
	startBeats: number;
	velocity: number;
}

export interface StripBar {
	noteId: number;
	/** Left edge as a fraction of the strip's width, 0..1. */
	left: number;
	/** Width as a fraction of the strip's width: one step. */
	width: number;
	velocity: number;
}

/**
 * One bar per note that starts inside the window, a step wide, at the
 * note's own start (an off-step note is drawn where it is, not on a step).
 */
export function stripBars(notes: readonly StripNote[], win: TimeRange): StripBar[] {
	const span = win.end - win.start;
	if (span <= 0) return [];
	const step = stripStepBeats(span);
	const out: StripBar[] = [];
	for (const n of notes) {
		if (n.startBeats < win.start || n.startBeats >= win.end) continue;
		out.push({
			noteId: n.noteId,
			left: (n.startBeats - win.start) / span,
			width: Math.min(step, win.end - n.startBeats) / span,
			velocity: n.velocity
		});
	}
	return out;
}

/** The step boundaries inside the window, as fractions, each flagged when it falls on a beat. */
export function stripSteps(win: TimeRange): { at: number; beat: boolean }[] {
	const span = win.end - win.start;
	if (span <= 0) return [];
	const step = stripStepBeats(span);
	const out: { at: number; beat: boolean }[] = [];
	const count = Math.round(span / step);
	for (let i = 1; i < count; i++) {
		const beats = win.start + i * step;
		out.push({ at: (i * step) / span, beat: Math.abs(beats - Math.round(beats)) < 1e-6 });
	}
	return out;
}

/** The bar a touch at `fraction` of the width takes: the nearest within half a step, else none. */
export function stripBarAt(bars: readonly StripBar[], fraction: number): number | null {
	let best: number | null = null;
	let bestDist = Infinity;
	for (let i = 0; i < bars.length; i++) {
		const b = bars[i];
		const centre = b.left + b.width / 2;
		const dist = Math.abs(fraction - centre);
		if (dist <= b.width && dist < bestDist) {
			best = i;
			bestDist = dist;
		}
	}
	return best;
}

/**
 * A velocity dragged from `start` by `dyPx` (up positive) on a strip
 * `heightPx` tall: the strip's height is the whole range, so a drag is
 * relative and a touch never jumps the note. Never below 1 — a velocity
 * of 0 is not a note Live keeps.
 */
export function dragVelocity(start: number, dyPx: number, heightPx: number): number {
	if (heightPx <= 0) return start;
	const v = Math.round(start + (dyPx / heightPx) * STRIP_VELOCITY_MAX);
	return Math.min(STRIP_VELOCITY_MAX, Math.max(1, v));
}
