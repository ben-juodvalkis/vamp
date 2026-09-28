/**
 * usePadSequencers — which pads on the grid carry a Permute of their own,
 * and what those sequencers are doing (ADR-435, 2026-09-14).
 *
 * Presence (`vm.padFx`, already open while a Drum Rack is in view) says
 * which pad chains hold a Permute. For those pads — and only those — the
 * pad's chain row (`vm.padChain.<note>`) is held for as long as the pad
 * is on the grid, so its records and values stay live without a finger
 * on it, and the tile can draw the pad's step strip: the two patterns
 * from the records, the running step from the telemetry wire (keyed by
 * the pad-shaped device path). A few pads at most, 38 parameters each —
 * cheap, and the property manager refcounts with the scope's own hold.
 *
 * `$effect`s are created here, so call it during component init.
 */

import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import {
	VM_PAD_FX,
	padChainEffects,
	parseVmPadFx,
	vmPadChainProperty
} from '$lib/services/drumVirtualMacros';
import { findPermute } from '$lib/config/permuteLayout';
import { padPathOf } from '$lib/utils/padPaths';
import {
	tinySequencerState,
	type TinySequencerState
} from '$lib/components/v6/tracks/composables/useTinySequencer.svelte';

export interface PadSequencersHandle {
	/** note → the pad's own Permute state, for the pads on the grid that have one. */
	readonly map: ReadonlyMap<number, TinySequencerState>;
}

export function usePadSequencers(
	getRackPath: () => string | undefined,
	getNotes: () => readonly number[]
): PadSequencersHandle {
	const rackPath = $derived(getRackPath());
	const padFx = $derived(
		rackPath ? parseVmPadFx(selectedTrackStore.propertyValue(rackPath, VM_PAD_FX)) : null
	);
	// The grid's pads whose chains carry a Permute, by presence.
	const permuteNotes = $derived.by<number[]>(() => {
		if (!rackPath || !padFx) return [];
		return getNotes().filter((note) => findPermute(padChainEffects(padFx, note)) !== undefined);
	});

	// Hold those pads' chain rows. Keyed on the joined notes so a census
	// re-emit with the same pads does not churn the subscriptions.
	const key = $derived(permuteNotes.join(','));
	$effect(() => {
		if (!rackPath || !key) return;
		const path = rackPath;
		const release = key
			.split(',')
			.map(Number)
			.map((note) => selectedTrackStore.subscribeProperty(path, vmPadChainProperty(note)));
		return () => release.forEach((fn) => fn());
	});

	const map = $derived.by<ReadonlyMap<number, TinySequencerState>>(() => {
		const out = new Map<number, TinySequencerState>();
		if (!rackPath) return out;
		for (const note of permuteNotes) {
			const permute = findPermute(selectedTrackStore.padDevices(padPathOf(rackPath, note)));
			if (permute) out.set(note, tinySequencerState(permute));
		}
		return out;
	});

	return {
		get map() {
			return map;
		}
	};
}
