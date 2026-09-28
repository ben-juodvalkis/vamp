/**
 * Shared clip-context resolver used by clipOperations and clipTranspose.
 *
 * Centralizes the read-from-stores pattern so both modules work off the
 * same snapshot shape. Pure: returns a fresh object each call.
 *
 * PR-5e1: sourced from `session.focusedClipIndices` (Python-surface
 * authored) rather than legacy M4L `detailClipIndices`. Field names
 * kept as `hasDetailClip`/`detailClipIndices` so all downstream
 * transpose / duplicate-loop / sample-to-simpler handlers keep
 * compiling — they're still conceptually "the clip detail view is
 * targeting," just via a different source.
 */

import { session } from '$lib/stores/session.svelte';
import { currentInstrumentStore } from '$lib/stores/v6/currentInstrumentStore.svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import type { InstrumentType } from './instrumentService';

export interface ClipContext {
	trackType: 'midi' | 'audio' | null;
	trackIndex: number;
	instrumentType: InstrumentType | null;
	deviceIndex: number | null;
	hasDetailClip: boolean;
	detailClipIndices: { track: number; scene: number } | null;
}

export function getClipContext(): ClipContext {
	const focused = session.focusedClipIndices;
	return {
		trackType: selectedTrackStore.trackType,
		trackIndex: session.selectedTrackIndex,
		instrumentType: currentInstrumentStore.type,
		deviceIndex: currentInstrumentStore.deviceIndex,
		hasDetailClip: focused !== null,
		detailClipIndices: focused
	};
}
