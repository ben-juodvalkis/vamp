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

/** Whether the FX grid's track is an audio track (Bass over Gtr in column 1). Reactive. */
export function gridTrackIsAudio(): boolean {
	const track = gridTrack();
	return !!track && !track.isFoldable && !track.hasMidiInput && track.hasAudioInput;
}

/**
 * Whether the FX grid draws the Gtr slider: on every track but master
 * (2026-10-23, the user's call; audio-only before). Where it does, the Gtr
 * tile's view is the Guitar view (Pedal, Wah, the Guitar rack) and the
 * Saturator's holds the rest (ADR-466). Reactive.
 */
export function gridHasGuitar(): boolean {
	const held = trackHoldScope.heldTracks()[0];
	return (held ?? selectedTrackStore.selectedTrackPath) !== 'master';
}
