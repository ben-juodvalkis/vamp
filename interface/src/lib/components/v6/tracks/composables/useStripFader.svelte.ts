/**
 * useStripFader — the volume half of a strip's fader: the value the handle
 * draws, and the throttled write behind it.
 *
 * The gesture that drives it is the caller's (TrackStrip runs the ADR-384
 * machine, `useStripGestures`; the master runs `use:drag`). This owns only
 * what a drag does to the level:
 *
 *  - **A local value the handle draws.** It moves with the finger at once;
 *    the store's echo is copied into it only while no drag is open, so an
 *    echo of an older write cannot snap the handle back mid-drag.
 *  - **Relative travel.** `grab()` at finger-down records the level, and
 *    every move sets `start + (dy / height) × gain`, clamped to 0..1, so
 *    touch-down never jumps the value. With gain 1 a drag the full height
 *    of the fader moves the handle end to end: it stays under the finger.
 *  - **One write per frame.** `createSliderThrottle`, started only once
 *    the drag commits (a pure tap never opens a frame loop), flushed on
 *    release so the resting value always ships.
 *
 * Teardown is the caller's, because the order matters: `cancel()` the fader
 * before closing the gesture, so a drag closed by an unmount sends nothing.
 */

import { createSliderThrottle } from '$lib/utils/sliderThrottle';

export interface StripFaderConfig {
	/** The stored level (0..1), echo-confirmed. */
	read: () => number;
	/** Write a level. Throttled to one per frame. */
	send: (value: number) => void;
	/** Level change per fader height dragged. Default 1. */
	gain?: number;
}

export function useStripFader(config: StripFaderConfig) {
	const gain = config.gain ?? 1;
	let value = $state(config.read());
	let dragging = $state(false);
	let startValue = 0;

	const throttle = createSliderThrottle(config.send);

	$effect(() => {
		if (!dragging) value = config.read();
	});

	return {
		/** The level the handle draws. */
		get value(): number {
			return value;
		},
		/** True from the drag's commit to its release. */
		get dragging(): boolean {
			return dragging;
		},
		/** Finger down: the drag will be relative to the level now. */
		grab(): void {
			startValue = value;
		},
		/** The press committed to a drag. */
		start(): void {
			dragging = true;
			throttle.start();
		},
		/** `dy` is pixels travelled up from the press; `height` the fader's. */
		move(dy: number, height: number): void {
			if (height <= 0) return;
			value = Math.max(0, Math.min(1, startValue + (dy / height) * gain));
			throttle.push(value);
		},
		/** The drag released: send the resting value. */
		release(): void {
			throttle.flush();
			dragging = false;
		},
		/** Drop the drag without sending what is pending (unmount). */
		cancel(): void {
			throttle.cancel();
			dragging = false;
		}
	};
}
