/**
 * useInstrumentSwap — what the swap pill steps on the selected track's
 * instrument, and where its two halves go (ADR-439).
 *
 * Every instrument steps through its catalog folder from the preset the
 * surface recorded on the track (`TrackRecord.preset`) — a Drum Rack kit
 * included (2026-09-27). The one exception is a held or latched Drum Sampler
 * pad, which steps Live's own similar samples for that pad, driven by the
 * bridge through the AX helper — a pad held on the Move included, since it
 * lands on `drumPadScope` like a finger (ADR-432). See `drumSwapKind`.
 *
 * What the pill says is pure (`describeSimilar`, `describePreset`), so the
 * wording is tested without a component; the hook binds it to the stores.
 */

import { untrack } from 'svelte';
import { browserModeStore } from '$lib/stores/v6/browserModeStore.svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { currentInstrumentStore } from '$lib/stores/v6/currentInstrumentStore.svelte';
import { drumPadScope } from '$lib/stores/v6/drumPadScope.svelte';
import { v3Store } from '$lib/stores/v3/normalized.svelte';
import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
import { selectedDrumRack } from '$lib/services/deviceViewRouter.svelte';
import { parseVmMembers, VM } from '$lib/services/drumVirtualMacros';
import { similarSwap, swapScope, type SimilarSwapState, type SwapDirection } from '$lib/services/similarSwap.svelte';
import { presetSwap, type PresetSwapState } from '$lib/services/presetSwap.svelte';

export interface SwapViewModel {
	kind: 'similar' | 'preset';
	scopeLabel: string;
	/** What the pill shows: the loaded name, or why it cannot step. */
	label: string;
	/** The whole reason behind a short label (a named error's detail), or ''. */
	detail: string;
	working: boolean;
	disabled: boolean;
	error: string | null;
}

const HELPER_REASON: Record<string, string> = {
	'ax-helper-down': 'the Looping AX Helper is not running',
	'ax-untrusted': 'the Looping AX Helper has no Accessibility grant'
};

/**
 * What the pill says instead of a name when a swap was refused: a phrase for
 * the codes a performer can actually meet, the raw code for the rest (it is
 * still better than silence, and the whole reason rides `detail`). Shown for
 * `SWAP_ERROR_TTL_MS`, then the name comes back — see `swapErrors`.
 */
const REFUSALS: Record<string, string> = {
	// Live greys its own swap buttons out when its index has no embedding for
	// the samples on those pads — a folder added to Places that is still
	// being indexed, or was never added (measured 2026-09-15).
	'swap-not-rankable': 'No similar samples yet',
	// A freshly loaded kit sits ON its reference sample, so Live disables
	// Previous and leaves Next alone (measured 2026-09-15).
	'swap-at-the-end': 'Nothing further that way',
	'ax-control-disabled': 'No similar samples yet',
	'ax-helper-down': 'AX helper is down',
	'ax-untrusted': 'AX helper is not trusted',
	'ax-live-not-running': 'Live is not running',
	'ax-no-main-window': "Live's window is not reachable",
	'swap-not-a-drum-sampler': 'That pad is not a Drum Sampler',
	'swap-sampler-not-in-view': "Live is not showing that pad's sampler",
	'swap-no-such-pad': 'That pad has no sample'
};

/** The code of a `code: detail` error — the part that fits on the pill. */
function errorCode(error: string): string {
	const colon = error.indexOf(': ');
	const code = colon > 0 ? error.slice(0, colon) : error;
	return REFUSALS[code] ?? code;
}

/** Live's class for a Drum Sampler pad — the one pad the bridge's similar swap steps. */
const DRUM_SAMPLER_PAD_CLASS = 'DrumCell';

/**
 * How a Drum Rack's pill steps, given the class of the pad scoped on it
 * (`null` with nothing scoped).
 *
 * A KIT steps its catalog folder, as every other instrument does (user,
 * 2026-09-27: "we should instead do it like we do for regular patches and
 * just choose the next and previous in the folder"). It used to press Live's
 * kit-wide similar-sound buttons through the AX helper, and, from 2026-09-16,
 * the folder only on a kit of Samplers, whose multisample pads Live's swap
 * cannot step.
 *
 * A held or latched Drum Sampler (`DrumCell`) pad keeps Live's similar-sample
 * swap for that one pad — the user's "keep it doing the similar sample thing
 * for individual drumcell samples". A pad of any other class steps the kit:
 * the bridge refuses a single-pad swap on anything but a Drum Sampler
 * (`swap-not-a-drum-sampler`), so there is nothing else a press could do.
 */
export function drumSwapKind(scopedPadClass: string | null): 'similar' | 'preset' {
	return scopedPadClass === DRUM_SAMPLER_PAD_CLASS ? 'similar' : 'preset';
}

export function describeSimilar(input: {
	scopeNote: number | null;
	rackName: string;
	padName: string | null;
	helper: { state: string; detail: string };
	swap: SimilarSwapState;
}): SwapViewModel {
	const { scopeNote, swap, helper } = input;
	const base = {
		kind: 'similar' as const,
		scopeLabel: scopeNote === null ? 'Kit' : 'Pad',
		working: swap.working
	};
	if (helper.state === 'unknown') {
		return { ...base, label: 'Waiting for the AX helper', detail: '', disabled: true, error: null };
	}
	if (helper.state !== 'ready') {
		const reason = helper.detail || HELPER_REASON[helper.state] || '';
		return {
			...base,
			label: helper.state,
			detail: reason ? `${helper.state}: ${reason}` : '',
			disabled: true,
			error: helper.state
		};
	}
	if (swap.error) {
		return { ...base, label: errorCode(swap.error), detail: swap.error, disabled: false, error: swap.error };
	}
	const name = scopeNote === null ? input.rackName : input.padName || `Pad ${scopeNote}`;
	return { ...base, label: name, detail: '', disabled: false, error: null };
}

export function describePreset(input: { instrumentName: string; state: PresetSwapState | undefined }): SwapViewModel {
	const { state } = input;
	const base = { kind: 'preset' as const, scopeLabel: 'Preset', working: false, error: null };
	if (!state || state.status === 'no-preset') {
		return {
			...base,
			label: 'No preset recorded',
			detail: 'No preset on record for this instrument — load one from the browser to swap',
			disabled: true
		};
	}
	if (state.status === 'loading') {
		return { ...base, label: input.instrumentName, detail: 'Finding its catalog folder…', disabled: true };
	}
	if (state.status === 'not-in-catalog') {
		return { ...base, label: 'Not in the catalog', detail: 'Its preset is not in the catalog', disabled: true };
	}
	if (state.error) {
		return { ...base, label: errorCode(state.error), detail: state.error, disabled: false, error: state.error };
	}
	const name = state.presets[state.index]?.name ?? input.instrumentName;
	return { ...base, label: name, detail: '', working: state.working, disabled: false };
}

/** Call during component init. `active` says whether the instrument view is the one on screen. */
export function useInstrumentSwap(active: () => boolean) {
	const trackPath = $derived(selectedTrackStore.selectedTrackPath);
	const instrument = $derived(currentInstrumentStore.current);
	const rack = $derived(selectedDrumRack());
	const preset = $derived(trackPath ? (v3Store.tracks.get(trackPath)?.preset ?? '') : '');
	const members = $derived(rack ? parseVmMembers(selectedTrackStore.propertyValue(rack.rackPath, VM.members)) : null);
	const scopeNote = $derived(rack ? drumPadScope.scopeNote(rack.rackPath) : null);
	const scopedPad = $derived(scopeNote === null ? null : (members?.pads.find((p) => p.note === scopeNote) ?? null));
	/**
	 * A held Drum Sampler pad steps Live's similar samples; everything else, a
	 * kit included, its folder. The similar samples are pressed through the AX
	 * helper, the owner's (`features.axHelper`): off, a held pad steps the kit
	 * like any other pad.
	 */
	const similar = $derived(
		!!rack && bridgeStatus.isFeatureOn('axHelper') && drumSwapKind(scopedPad?.className ?? null) === 'similar'
	);

	// Synced on a Drum Rack even while a pad steps similar samples: the kit's
	// folder is what the pill steps the moment the pad is let go.
	$effect(() => {
		if (!active() || !instrument || !trackPath) return;
		const path = trackPath;
		const recorded = preset;
		// The store's own map is not this effect's dependency: only the track
		// and its recorded preset re-run the lookup.
		untrack(() => void presetSwap.sync(path, recorded));
	});

	const model = $derived.by((): SwapViewModel | null => {
		if (!active() || !instrument || !trackPath) return null;
		if (rack && similar) {
			return describeSimilar({
				scopeNote,
				rackName: rack.instrument.name,
				padName: scopedPad?.name ?? null,
				helper: bridgeStatus.axHelper,
				swap: similarSwap.state(rack.rackPath, swapScope(scopeNote))
			});
		}
		return describePreset({ instrumentName: instrument.name, state: presetSwap.state(trackPath) });
	});

	function act(direction: SwapDirection): void {
		if (!trackPath) return;
		if (rack && similar) {
			void similarSwap.run(rack.rackPath, swapScope(scopeNote), direction);
			return;
		}
		void presetSwap.step(trackPath, direction === 'next' ? 1 : -1);
	}

	/**
	 * A tap on the pill's name (ADR-442): open the browser pinned to
	 * this track, so a pick replaces the instrument in place rather than
	 * spawning a track — the gesture the clip rail carried as an 800ms hold.
	 * The track's recorded patch rides along, which is what lands the browser on
	 * its catalog folder (ADR-441); `''` simply means no landing.
	 *
	 * Offered on every instrument, a Drum Rack included. The pill steps a held
	 * Drum Sampler pad through that pad's similar samples, but the browser
	 * replaces the INSTRUMENT either way — the pin is a track path, and a pad
	 * scope cannot narrow it.
	 */
	function open(): void {
		if (!trackPath) return;
		browserModeStore.openForReplace(trackPath, preset || null);
	}

	return {
		get model() {
			return model;
		},
		/** Whether there is a track to open the browser onto. */
		get canOpen() {
			return !!trackPath;
		},
		act,
		open
	};
}
