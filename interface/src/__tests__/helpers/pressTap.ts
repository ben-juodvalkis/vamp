import { fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

/**
 * A finger tap as `use:press` hears it: pointerdown then pointerup on the
 * node. A device view's buttons answer this, not a `click` (ADR-522).
 */
export async function pressTap(node: Element, pointerId = 1): Promise<void> {
	await fireEvent.pointerDown(node, { pointerId, pointerType: 'touch' });
	await fireEvent.pointerUp(node, { pointerId, pointerType: 'touch' });
	await tick();
}

/**
 * Pick one option of a `ScrubTabs`. The tabs' frame owns the finger
 * through `use:drag`, which reads the finger's position against the
 * frame's layout, and jsdom has no layout; Enter on the option is the
 * same pick by the keyboard path.
 */
export async function scrubPick(option: Element): Promise<void> {
	if (!option.closest('.scrub-tabs')) throw new Error('scrubPick: not a ScrubTabs option');
	await fireEvent.keyDown(option, { key: 'Enter' });
	await tick();
}
