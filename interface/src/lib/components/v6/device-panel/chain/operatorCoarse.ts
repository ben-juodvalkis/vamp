/**
 * Operator's Coarse on its chain cell's pads: relative, an octave either
 * side of the ratio held at touch-down, landing on Live's whole ratios.
 * Coarse is a 0..48 parameter whose step 0 is ratio 0.5 and every other
 * step its own number (measured, docs/reference/instruments/Operator.md).
 */
export const OP_COARSE_MAX = 48;
export const OP_OCTAVES_EACH_WAY = 1;

/** Coarse step → ratio. */
export const coarseRatio = (step: number): number => (Math.round(step) <= 0 ? 0.5 : Math.min(OP_COARSE_MAX, Math.round(step)));

/** Ratio → the nearest Coarse step. */
export const coarseStep = (ratio: number): number => (ratio < 0.75 ? 0 : Math.min(OP_COARSE_MAX, Math.round(ratio)));

/** The Coarse step a pad's X (0..1, 0.5 at rest) reaches from `anchor`, a ratio. */
export const coarseStepAt = (anchor: number, x: number): number =>
	coarseStep(anchor * 2 ** ((x - 0.5) * 2 * OP_OCTAVES_EACH_WAY));
