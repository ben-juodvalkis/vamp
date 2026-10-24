<script lang="ts">
	/**
	 * The Gtr tile's view (2026-10-23, the user's call). On an audio track
	 * the FX grid's first column is Bass over Gtr, and a tap on either opens
	 * this view: the Pedal, then the Guitar rack (Spring/Room and Tremolo
	 * pads) with the Wah. They left the Saturator tile's view there, which
	 * keeps the Shifter, Output, Mix and Redux.
	 *
	 * On a MIDI track there is no Gtr tile: the Guitar is the Pedal view's,
	 * and this view draws that whole view, so a touch inside it never swaps
	 * the view out from under the finger.
	 */

	import PedalCentralView from './PedalCentralView.svelte';
	import { gridTrackIsAudio } from '$lib/components/v6/device-panel/drumCell.svelte';

	const part = $derived(gridTrackIsAudio() ? 'guitar' : 'all');
</script>

<PedalCentralView {part} />
