/**
 * The scoped pad's notes strip (`PadNotesStrip.svelte`): one row of the
 * clip, the pad's — where its steps and its notes fall across the clip's
 * window, and what a drag does to a note's velocity or position. Pure, so
 * it is tested without a browser.
 */

import type { TimeRange } from '$lib/utils/waveformPaint';
import { dragSnapStart } from '$lib/utils/clip/clipGesture';

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
	durationBeats: number;
	velocity: number;
}

export interface StripBlock {
	noteId: number;
	/** Left edge as a fraction of the strip's width, 0..1. */
	left: number;
	/** Width as a fraction of the strip's width: the note's length. */
	width: number;
	velocity: number;
}

/** One full-height block per note that starts inside the window, as long as the note (cut at the window's end). */
export function stripBlocks(notes: readonly StripNote[], win: TimeRange): StripBlock[] {
	const span = win.end - win.start;
	if (span <= 0) return [];
	const out: StripBlock[] = [];
	for (const n of notes) {
		if (n.startBeats < win.start || n.startBeats >= win.end) continue;
		out.push({
			noteId: n.noteId,
			left: (n.startBeats - win.start) / span,
			width: Math.min(n.durationBeats, win.end - n.startBeats) / span,
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

/**
 * The block a touch at `fraction` of the width takes: one it lands on, or
 * the nearest within a step of it (a 16th is a thin target under a
 * finger); else none.
 */
export function stripBlockAt(blocks: readonly StripBlock[], fraction: number, win: TimeRange): number | null {
	const span = win.end - win.start;
	if (span <= 0) return null;
	const reach = stripStepBeats(span) / span;
	let best: number | null = null;
	let bestDist = Infinity;
	for (let i = 0; i < blocks.length; i++) {
		const b = blocks[i];
		const dist = fraction < b.left ? b.left - fraction : fraction > b.left + b.width ? fraction - (b.left + b.width) : 0;
		if (dist <= reach && dist < bestDist) {
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

/**
 * Where a note dragged `dxPx` sideways on a strip `widthPx` wide lands:
 * on the strip's steps, as the clip editor's drag does (`dragSnapStart`:
 * an off-step note goes to the step it is pulled toward first), and never
 * out of the window.
 */
export function dragStart(startBeats: number, dxPx: number, widthPx: number, win: TimeRange): number {
	const span = win.end - win.start;
	if (widthPx <= 0 || span <= 0) return startBeats;
	const step = stripStepBeats(span);
	const moved = dragSnapStart(startBeats - win.start, (dxPx / widthPx) * span, step) + win.start;
	return Math.min(win.end - step, Math.max(win.start, moved));
}
