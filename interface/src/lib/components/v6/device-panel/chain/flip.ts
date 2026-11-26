/**
 * FLIP for the chain's cells: measure each child where it is drawn, let
 * the order change, then slide each from where it was to where it is.
 * Keyed by `data-cell-key` on the container's direct children. Measured
 * only when the caller says the order changed, never per redraw (which is
 * why the chain does not use `animate:flip`).
 */

const CHILDREN = ':scope > [data-cell-key]';
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

/** Each child's box, by its key; `skip` (the dragged cell) left out. */
export function measureChildren(container: HTMLElement, skip?: HTMLElement | null): Map<string, DOMRect> {
	const boxes = new Map<string, DOMRect>();
	for (const el of container.querySelectorAll<HTMLElement>(CHILDREN)) {
		if (el !== skip) boxes.set(el.dataset.cellKey!, el.getBoundingClientRect());
	}
	return boxes;
}

/** The children's keys, in order. */
export function childKeys(container: HTMLElement): string[] {
	return [...container.querySelectorAll<HTMLElement>(CHILDREN)].map((el) => el.dataset.cellKey!);
}

/** Slide `el` from the box `from` to where it is drawn now. */
export function slideFrom(el: HTMLElement, from: DOMRect, duration = 180): void {
	for (const a of el.getAnimations()) a.cancel();
	const to = el.getBoundingClientRect();
	const dx = from.left - to.left;
	const dy = from.top - to.top;
	if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
	el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration, easing: EASE });
}

/** Fly `el` from the box `from` (position and size) to where it is drawn now. */
export function flyFrom(el: HTMLElement, from: DOMRect, duration = 220): void {
	for (const a of el.getAnimations()) a.cancel();
	const to = el.getBoundingClientRect();
	const sx = to.width ? from.width / to.width : 1;
	const sy = to.height ? from.height / to.height : 1;
	el.animate(
		[
			{ transformOrigin: '0 0', transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})` },
			{ transformOrigin: '0 0', transform: 'none' }
		],
		{ duration, easing: EASE }
	);
}

/**
 * Slide every child that was measured in `before` to its new place, and
 * hand each child that was not (a new cell) to `onNew`.
 */
export function flipChildren(
	container: HTMLElement,
	before: ReadonlyMap<string, DOMRect>,
	onNew?: (el: HTMLElement, key: string) => void
): void {
	for (const el of container.querySelectorAll<HTMLElement>(CHILDREN)) {
		const key = el.dataset.cellKey!;
		const from = before.get(key);
		if (from) slideFrom(el, from);
		else onNew?.(el, key);
	}
}
