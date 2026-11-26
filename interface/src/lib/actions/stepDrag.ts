/**
 * createStepDrag — a drag digit: drag up or down to step a whole-number
 * value (tempo, the time signature's numerator, its denominator).
 *
 * Three views carry these digits — the session header, the System view and
 * the master strip's time signature — and each used to hand-write the same
 * `use:drag` options: read the value at press, add `dy × sensitivity`, round,
 * clamp, and send only when the rounded value changes. This is that once.
 *
 * Each view keeps its own feel through `perPx`: the System view's digits are
 * much larger than the header's, so a pixel there is worth less.
 *
 * The value moves from what it was at the press, so touch-down never jumps
 * it, and it is sent only when it differs from the last value this drag
 * sent (or the press-time value, before the first send): a drag that never
 * crosses a step writes nothing. The readout is echo-confirmed — it moves
 * when Live answers, not here.
 *
 * Returns options for `use:drag` with `commit: 'immediate'` and
 * `touch-action: none`: a drag digit is the value from touch-down, and there
 * is nothing else it could be.
 */

import type { DragInfo, DragOptions } from './drag';

interface StepDragBase {
	/** The value now. Read once, at the press. */
	read: () => number;
	/**
	 * How far one pixel of travel moves: in value units for a `min`/`max`
	 * range, in list positions for `steps`.
	 */
	perPx: number;
	/** Write a new value. Called only when the rounded value changes. */
	send: (value: number) => void;
	/** True at the press, false when the drag ends. Drives an active look. */
	onActiveChange?: (active: boolean) => void;
}

export interface StepDragRange extends StepDragBase {
	min: number;
	max: number;
	steps?: never;
}

export interface StepDragList extends StepDragBase {
	/** The allowed values in order (a denominator's 1, 2, 4, 8, 16). */
	steps: readonly number[];
	min?: never;
	max?: never;
}

export type StepDragConfig = StepDragRange | StepDragList;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The value a drag of `dy` pixels (up positive) lands on, from `start`.
 * Pure, exported for the tests.
 */
export function stepDragValue(config: StepDragConfig, start: number, dy: number): number {
	if (config.steps) {
		const steps = config.steps;
		const index = clamp(
			Math.round(steps.indexOf(start) + dy * config.perPx),
			0,
			steps.length - 1
		);
		return steps[index];
	}
	return clamp(Math.round(start + dy * config.perPx), config.min, config.max);
}

export function createStepDrag(config: StepDragConfig): DragOptions {
	let start = 0;
	let last = 0;
	return {
		commit: 'immediate',
		touchAction: 'none',
		onStart: () => {
			start = config.read();
			last = start;
			config.onActiveChange?.(true);
		},
		onMove: ({ dy }: DragInfo) => {
			const next = stepDragValue(config, start, dy);
			if (next === last) return;
			last = next;
			config.send(next);
		},
		onEnd: () => {
			config.onActiveChange?.(false);
		}
	};
}
