/**
 * useClipSwap — the swap pill on the clip view (ADR-440): the focused audio
 * clip's file between ‹ and ›, a half stepping to the neighboring file in
 * Live's ranking of it (`services/clipSimilarSwap.svelte.ts`). A MIDI clip,
 * no focused clip, or another view draws no pill.
 *
 * What the pill says is pure (`describeClipSwap`), so the wording is tested
 * without a component, as `describeSimilar` and `describePreset` are.
 */

import { untrack } from 'svelte';
import { browserModeStore } from '$lib/stores/v6/browserModeStore.svelte';
import { session } from '$lib/stores/session.svelte';
import { v3Store } from '$lib/stores/v3/normalized.svelte';
import { invalidateSample, requestSample } from '$lib/services/clipSampleService';
import { clipSimilarSwap, slotOfClip, type ClipSwapState } from '$lib/services/clipSimilarSwap.svelte';
import type { SwapDirection } from '$lib/services/similarSwap.svelte';
import type { SwapViewModel } from './useInstrumentSwap.svelte';

export type ClipSwapViewModel = Omit<SwapViewModel, 'kind'> & { kind: 'clip' };

/** What the pill says in place of the name for a clip Live cannot rank. */
const UNAVAILABLE_LABEL: Record<string, string> = {
	'not-indexed': 'Not in Live’s index',
	'no-vector': 'Not analyzed by Live',
	'no-similar': 'No similar sounds',
	'no-file': 'No file yet'
};

/** A file's name without its extension. */
function soundName(pathOrName: string): string {
	const name = pathOrName.slice(pathOrName.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(0, dot) : name;
}

/** The code of a `code: detail` error — the part that fits on the pill. */
function errorCode(error: string): string {
	const colon = error.indexOf(': ');
	return colon > 0 ? error.slice(0, colon) : error;
}

export function describeClipSwap(input: { state: ClipSwapState | undefined; filePath: string }): ClipSwapViewModel {
	const { state } = input;
	const base = { kind: 'clip' as const, scopeLabel: 'Clip', working: false, error: null };
	if (!state || state.status === 'loading') {
		return { ...base, label: soundName(input.filePath) || 'Clip', detail: 'Finding similar sounds…', disabled: true };
	}
	if (state.status === 'unavailable') {
		const code = state.reason?.code ?? 'unavailable';
		const detail = state.reason?.detail ? `${code}: ${state.reason.detail}` : code;
		const label = UNAVAILABLE_LABEL[code];
		// A file Live cannot rank is a fact about the file; a server that could not answer is a fault.
		return { ...base, label: label ?? code, detail, disabled: true, error: label ? null : detail };
	}
	if (state.error) {
		return { ...base, label: errorCode(state.error), detail: state.error, disabled: false, error: state.error };
	}
	const sound = state.sounds[state.index];
	return {
		...base,
		label: soundName(sound?.name ?? input.filePath),
		detail: '',
		working: state.working,
		disabled: false
	};
}

/** Call during component init. `active` says whether the clip view is the one on screen. */
export function useClipSwap(active: () => boolean) {
	const clipPath = $derived(session.focusedClipPath);
	const clip = $derived.by(() => {
		const slot = clipPath ? slotOfClip(clipPath) : null;
		return slot ? v3Store.tracks.get(slot.trackPath)?.slots.get(slot.slotPath)?.clip : undefined;
	});
	let sample = $state<{ clipPath: string; isAudioClip: boolean; filePath: string } | null>(null);
	let lastIdentity: string | null = null;

	// Which file the clip holds — asked again when a different clip lands in
	// the same slot (SlotCell's rule) — handed to the swap store, which starts
	// a new list only for a file its own step did not load.
	$effect(() => {
		if (!active() || !clipPath || !clip) return;
		const path = clipPath;
		const identity = `${path}::${clip.name}::${clip.length}`;
		if (lastIdentity?.startsWith(`${path}::`) && lastIdentity !== identity) invalidateSample(path);
		lastIdentity = identity;

		let canceled = false;
		requestSample(path)
			.then((answer) => {
				if (canceled) return;
				sample = { clipPath: path, ...answer };
				if (answer.isAudioClip) untrack(() => void clipSimilarSwap.sync(path, answer.filePath));
			})
			.catch(() => {
				if (!canceled) sample = null;
			});
		return () => {
			canceled = true;
		};
	});

	const model = $derived.by((): ClipSwapViewModel | null => {
		if (!active()) return null;
		// A step deletes the focused clip, which empties Live's clip view until
		// the step refocuses it; the pill stays on the clip meanwhile.
		const path = clipPath ?? clipSimilarSwap.inFlight;
		if (!path) return null;
		const state = clipSimilarSwap.state(path);
		if (state?.working) return describeClipSwap({ state, filePath: '' });
		if (!sample || sample.clipPath !== path || !sample.isAudioClip) return null;
		return describeClipSwap({ state, filePath: sample.filePath });
	});

	function act(direction: SwapDirection): void {
		if (clipPath) void clipSimilarSwap.step(clipPath, direction === 'next' ? 1 : -1);
	}

	/** Which slot the focused clip sits in, or null — the audio browser's pin. */
	const slot = $derived(clipPath ? slotOfClip(clipPath) : null);

	/**
	 * A tap on the pill's name (ADR-442), the audio half: open the
	 * browser pinned to this SLOT, so a picked sample replaces the clip in place
	 * (clip-into-slot) rather than making a track — the gesture the clip rail
	 * carried as its own button. `openAudioBrowserForReplace` forces the audio
	 * source for the same reason `openForReplace` forces instruments.
	 */
	function open(): void {
		const target = slot;
		if (!target) return;
		browserModeStore.openAudioBrowserForReplace(Number(target.trackPath.slice('tracks/'.length)), target.scene);
	}

	return {
		get model() {
			return model;
		},
		/** Whether there is a slot to open the browser onto. */
		get canOpen() {
			return !!slot;
		},
		act,
		open
	};
}
