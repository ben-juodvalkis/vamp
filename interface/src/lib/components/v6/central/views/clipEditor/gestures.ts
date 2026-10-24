/**
 * Document-level drag gestures for the clip editor's pieces.
 *
 * Every drag (note, brace, velocity, draw, warp grip, note name) attaches
 * document pointermove/up/cancel listeners. They normally tear down in
 * the gesture's own end handler, but a component unmounted mid-drag
 * (editor toggled away during a drag) would leak them and close over
 * stale state. Each component makes one set at init; the set drains on
 * destroy without running any `onEnd`, so a half-finished drag emits no
 * write.
 */

import { onDestroy } from 'svelte';

export type BeginGesture = (
	onMove: (e: PointerEvent) => void,
	onEnd: (e: PointerEvent) => void | false
) => () => void;

/**
 * Call during component init. Returns `begin(onMove, onEnd)`: `onMove`
 * runs on pointermove, `onEnd` once on pointerup/cancel — unless it
 * returns `false` (another finger lifted), which keeps the gesture
 * listening. The returned teardown drops the gesture early without
 * running `onEnd` (a pinch taking over).
 */
export function createGestures(): BeginGesture {
	const live = new Set<() => void>();
	onDestroy(() => {
		for (const teardown of [...live]) teardown();
	});
	return (onMove, onEnd) => {
		const move = (e: PointerEvent) => onMove(e);
		let done = false;
		const teardown = () => {
			if (done) return;
			done = true;
			document.removeEventListener('pointermove', move);
			document.removeEventListener('pointerup', end);
			document.removeEventListener('pointercancel', end);
			live.delete(teardown);
		};
		const end = (e: PointerEvent) => {
			if (onEnd(e) === false) return;
			teardown();
		};
		document.addEventListener('pointermove', move);
		document.addEventListener('pointerup', end);
		document.addEventListener('pointercancel', end);
		live.add(teardown);
		return teardown;
	};
}
