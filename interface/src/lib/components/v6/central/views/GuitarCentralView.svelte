<script lang="ts">
	/**
	 * The Gtr tile's view (2026-10-23, the user's call). The FX grid's first
	 * column ends in Gtr on every track (under the Bass on audio and Main,
	 * under Rand Oct on MIDI), and a tap on it (or the Bass) opens this view: the Pedal, then the Guitar rack (Spring/Room and Tremolo
	 * pads) with the Wah. They left the Saturator tile's view there, which
	 * keeps the Shifter, Output, Mix and Redux.
	 */

	import PedalCentralView from './PedalCentralView.svelte';
</script>

<PedalCentralView part="guitar" />
