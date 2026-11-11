/**
 * Move a node into another element while keeping it owned by the component
 * that renders it: its bindings, state and handlers stay where they are.
 * With no target the node stays in place; a target that goes away puts it
 * back where it was. The clip view's full screen uses it to seat the note
 * editor's toolbar in its top strip (ADR-527).
 */
export function portal(node: HTMLElement, target: HTMLElement | null | undefined) {
	const home = node.parentNode;
	const anchor = node.nextSibling;

	function seat(to: HTMLElement | null | undefined) {
		if (to) {
			if (node.parentNode !== to) to.appendChild(node);
		} else if (home && node.parentNode !== home) {
			home.insertBefore(node, anchor && anchor.parentNode === home ? anchor : null);
		}
	}

	seat(target);
	return {
		update(next: HTMLElement | null | undefined) {
			seat(next);
		},
		destroy() {
			node.remove();
		}
	};
}
