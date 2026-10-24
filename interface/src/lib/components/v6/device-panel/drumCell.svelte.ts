import { trackHoldScope } from '$lib/stores/v6/trackHoldScope.svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { v3Store } from '$lib/stores/v3/normalized.svelte';
import { isDrumTrack } from '$lib/services/trackCategory';

/**
 * Whether the FX grid's Drum cell holds the Chorus (2026-10-23, the user's
 * call): on every audio track, whatever category its clips came from (a drum
 * loop included), and on every other track that is not a drum track
 * (`isDrumTrack`), master included. The track is the held strip's while one is held, else the
 * selected one. The Chorus family's controls follow it: in this mode Blur,
 * Comb and Phaser are the Chorus view's, otherwise the Auto Pan view's.
 * Reactive: read it inside a `$derived` or markup.
 */
export function drumCellHoldsChorus(): boolean {
	return gridTrackIsAudio() || !isDrumTrack(gridTrack());
}

/** The track the FX grid shows: the held strip's while one is held, else the selected one. */
function gridTrack() {
	const held = trackHoldScope.heldTracks()[0];
	return v3Store.tracks.get(held ?? selectedTrackStore.selectedTrackPath);
}

/**
 * Whether the FX grid treats its track as audio (Bass over Gtr in column 1):
 * an audio track, or Main (2026-10-24, the user's call). Reactive.
 */
export function gridTrackIsAudio(): boolean {
	const held = trackHoldScope.heldTracks()[0];
	if ((held ?? selectedTrackStore.selectedTrackPath) === 'master') return true;
	const track = gridTrack();
	return !!track && !track.isFoldable && !track.hasMidiInput && track.hasAudioInput;
}
