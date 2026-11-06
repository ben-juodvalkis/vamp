/**
 * Operator's Coarse on its chain cell's pads. Each pad's X spans two Coarse
 * steps either side of an anchor: the step the oscillator held when the
 * track was arrived at or its preset loaded (a preset at 8 spans 6..10).
 * Ben hears each step as an octave, so this is his "two octaves either
 * way" (2026-11-05). The dot sits where the step falls in that window.
 * Coarse is a 0..48 parameter labelled 0.5, 1, 2 … 48 (read off the
 * running Live 2026-11-05); nothing lies below 0.5.
 */
export const OP_COARSE_MAX = 48;
export const OP_STEPS_EACH_WAY = 2;

/** Coarse step → the ratio Live labels it with (step 0 is 0.5). */
export const coarseRatio = (step: number): number => (Math.round(step) <= 0 ? 0.5 : Math.min(OP_COARSE_MAX, Math.round(step)));

const clampStep = (step: number) => Math.min(OP_COARSE_MAX, Math.max(0, Math.round(step)));

/** A Coarse step → the pad's X, 0..1, in the window around `anchor` (a step). */
export const coarseX = (anchor: number, step: number): number =>
	Math.min(1, Math.max(0, (Math.round(step) - Math.round(anchor) + OP_STEPS_EACH_WAY) / (2 * OP_STEPS_EACH_WAY)));

/** The pad's X, 0..1 → the Coarse step, in the window around `anchor`. */
export const coarseStepAtX = (anchor: number, x: number): number =>
	clampStep(Math.round(anchor) + (Math.min(1, Math.max(0, x)) * 2 - 1) * OP_STEPS_EACH_WAY);
