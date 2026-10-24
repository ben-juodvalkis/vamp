<script lang="ts">
	/**
	 * The Gtr tile's view (2026-10-23, the user's call). The FX grid's first
	 * column ends in Gtr on every track but master (under the Bass on audio,
	 * under Rand Oct on MIDI), and a tap on it (or the Bass) opens this view: the Pedal, then the Guitar rack (Spring/Room and Tremolo
	 * pads) with the Wah. They left the Saturator tile's view there, which
	 * keeps the Shifter, Output, Mix and Redux.
	 *
	 * On master there is no Gtr tile: the Guitar is the Pedal view's, and
	 * this view draws that whole view, so a touch inside it never swaps the
	 * view out from under the finger.
	 */

	import PedalCentralView from './PedalCentralView.svelte';
	import { gridHasGuitar } from '$lib/components/v6/device-panel/drumCell.svelte';

	const part = $derived(gridHasGuitar() ? 'guitar' : 'all');
</script>

<PedalCentralView {part} />
