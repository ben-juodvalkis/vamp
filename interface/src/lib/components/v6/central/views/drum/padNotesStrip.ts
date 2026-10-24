/**
 * The scoped pad's notes strip (`PadNotesStrip.svelte`): one row of the
 * clip, the pad's — where its steps and its notes fall across the clip's
 * window, and what a drag does to a note's velocity or position. Pure, so
 * it is tested without a browser.
 */

import type { TimeRange } from '$lib/utils/waveformPaint';
import { dragSnapStart } from '$lib/utils/clip/clipGesture';

export const STRIP_VELOCITY_MAX = 127;
/** A note painted on an empty step starts here. */
export const PAINT_VELOCITY = 100;
/** Vertical travel a painting finger may drift before it moves the velocity. */
export const PAINT_DEADBAND_PX = 12;

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
 * The block a touch at `fraction` of the width lands on, else none. Exact,
 * not "the nearest": an empty step beside a note is a target of its own
 * (a tap there adds a note), and a step is wide enough under a finger.
 * Where blocks overlap, the one starting latest wins, as it is drawn on top.
 */
export function stripBlockAt(blocks: readonly StripBlock[], fraction: number): number | null {
	let best: number | null = null;
	for (let i = 0; i < blocks.length; i++) {
		const b = blocks[i];
		if (fraction >= b.left && fraction <= b.left + b.width && (best === null || b.left >= blocks[best].left)) best = i;
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

/** The step a touch at `fraction` of the width is on, 0..count-1. */
export function stripStepAt(fraction: number, win: TimeRange): number {
	const span = win.end - win.start;
	if (span <= 0) return 0;
	const step = stripStepBeats(span);
	const count = Math.max(1, Math.round(span / step));
	return Math.min(count - 1, Math.max(0, Math.floor((fraction * span) / step)));
}

/** True when one of the pad's notes starts within step `index`. */
export function stepTaken(notes: readonly { startBeats: number }[], index: number, win: TimeRange): boolean {
	const step = stripStepBeats(win.end - win.start);
	const from = win.start + index * step - 1e-6;
	const to = win.start + (index + 1) * step - 1e-6;
	return notes.some((n) => n.startBeats >= from && n.startBeats < to);
}

/**
 * The steps a paint stroke has laid down, after the finger moves from
 * step `from` to step `to`: every step between them joins (a fast swipe
 * skips none), in the order crossed, except a step already in the stroke
 * or already holding one of the pad's notes.
 */
export function paintSteps(
	stroke: readonly number[],
	from: number,
	to: number,
	taken: (index: number) => boolean
): number[] {
	const out = [...stroke];
	const dir = to >= from ? 1 : -1;
	for (let i = from; dir > 0 ? i <= to : i >= to; i += dir) {
		if (!out.includes(i) && !taken(i)) out.push(i);
	}
	return out;
}

/**
 * The velocity of a painted stroke after `dyPx` of vertical travel (up
 * positive): PAINT_VELOCITY until the finger has drifted past the
 * deadband, then the strip's relative drag from there.
 */
export function paintVelocity(dyPx: number, heightPx: number): number {
	const past = Math.abs(dyPx) - PAINT_DEADBAND_PX;
	if (past <= 0) return PAINT_VELOCITY;
	return dragVelocity(PAINT_VELOCITY, Math.sign(dyPx) * past, heightPx);
}

// ---- One bar at a time (2026-10-24, the user's call: a 2-bar loop at
// 16ths left a step ~24pt wide on the iPad; one bar keeps it ~48pt).

/** Travel, in px, that slides the bar button one bar. */
export const BAR_SLIDE_PX = 32;

/** A bar's length in beats (Live's beats are quarter notes): 4 in 4/4, 3 in 3/4 and in 6/8. */
export function barBeats(numerator: number, denominator: number): number {
	const n = numerator > 0 ? numerator : 4;
	const d = denominator > 0 ? denominator : 4;
	return (n * 4) / d;
}

/** The bars a window touches, as bar indices counted from the clip's start (bar 1 is index 0). */
export function windowBars(win: TimeRange, bar: number): { first: number; last: number } {
	if (bar <= 0 || win.end <= win.start) return { first: 0, last: 0 };
	const first = Math.floor(win.start / bar + 1e-6);
	const last = Math.max(first, Math.ceil(win.end / bar - 1e-6) - 1);
	return { first, last };
}

/** Bar `index`'s stretch of the window: the bar, cut to the window at either end. */
export function barWindow(win: TimeRange, bar: number, index: number): TimeRange {
	return { start: Math.max(win.start, index * bar), end: Math.min(win.end, (index + 1) * bar) };
}

/** The bar a slide of `dyPx` (up positive, up is later) from bar `from` reaches, kept within first..last. */
export function slideBar(from: number, dyPx: number, first: number, last: number): number {
	return Math.min(last, Math.max(first, from + Math.round(dyPx / BAR_SLIDE_PX)));
}
