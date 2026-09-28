/**
 * usePadChainRows — the two property rows a pad-scoped surface needs open
 * (issue #491), owned once.
 *
 * The FX grid and the Drum Rack view each subscribe the rack's `vm.padFx`
 * presence row (so a tile flips ghost/active the instant a finger lands)
 * and the scoped pad's `vm.padChain.<note>` row (so the surface sends the
 * pad's records and keeps its values live for as long as it is held or
 * latched). The two components carried the same pair of `$effect`s with
 * the same comments, and the rule that makes them cheap — key the chain
 * row on the two PRIMITIVES, never on the scope object, which is rebuilt
 * on every census change and would cost the surface a bundle per rebuild —
 * lived in both (code review, 2026-09-12). The property manager refcounts,
 * so both components holding the same row is one subscribe on the wire.
 *
 * `$effect`s are created here, so call it during component init.
 */

import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { VM_PAD_FX, vmPadChainProperty } from '$lib/services/drumVirtualMacros';

export function usePadChainRows(
	getRackPath: () => string | null | undefined,
	getScopedNote: () => number | null | undefined
): void {
	const rackPath = $derived(getRackPath() ?? null);
	const scopedNote = $derived(getScopedNote() ?? null);

	// Effect presence per pad, for as long as a Drum Rack is in view.
	$effect(() => {
		if (rackPath === null) return;
		return selectedTrackStore.subscribeProperty(rackPath, VM_PAD_FX);
	});

	// The scoped pad's own records, for exactly as long as it is scoped.
	$effect(() => {
		if (rackPath === null || scopedNote === null) return;
		return selectedTrackStore.subscribeProperty(rackPath, vmPadChainProperty(scopedNote));
	});
}
