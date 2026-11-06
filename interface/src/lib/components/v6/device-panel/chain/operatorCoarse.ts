/**
 * Operator's Coarse on its chain cell's pads. Each pad's X spans two
 * octaves either side of an anchor: the ratio the oscillator held when
 * the track was arrived at or its preset loaded (a preset at 24 spans
 * 6..96, Live stopping at 48). The dot sits where the ratio falls in that
 * window and a drag lands on Live's whole ratios. Coarse is a 0..48
 * parameter whose step 0 is ratio 0.5 and every other step its own number
 * (measured, docs/reference/instruments/Operator.md).
 */
export const OP_COARSE_MAX = 48;
export const OP_OCTAVES_EACH_WAY = 2;

/** Coarse step → ratio. */
export const coarseRatio = (step: number): number => (Math.round(step) <= 0 ? 0.5 : Math.min(OP_COARSE_MAX, Math.round(step)));

/** Ratio → the nearest Coarse step. */
export const coarseStep = (ratio: number): number => (ratio < 0.75 ? 0 : Math.min(OP_COARSE_MAX, Math.round(ratio)));

/** A Coarse step → the pad's X, 0..1, in the window around `anchor` (a ratio). */
export const coarseX = (anchor: number, step: number): number =>
	Math.min(1, Math.max(0, (Math.log2(coarseRatio(step) / anchor) + OP_OCTAVES_EACH_WAY) / (2 * OP_OCTAVES_EACH_WAY)));

/** The pad's X, 0..1 → the nearest Coarse step, in the window around `anchor`. */
export const coarseStepAtX = (anchor: number, x: number): number =>
	coarseStep(anchor * 2 ** ((Math.min(1, Math.max(0, x)) * 2 - 1) * OP_OCTAVES_EACH_WAY));
