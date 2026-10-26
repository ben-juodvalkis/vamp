<script lang="ts">
	/**
	 * RandomCentralView — the Random MIDI effect's own view (MidiRandom, the
	 * Rand Oct tile's device): the tile's one control, Chance, the `random`
	 * control (`deviceControls`, ADR-479), at full size. Until the chain overview (ADR-478) the `random` type opened
	 * the Arpeggiator view, which drew nothing that drives this device.
	 *
	 * Random's other parameters (Choices, Scale, Sign, Alternate, Use
	 * Current Scale) have no measured indices yet, so they are not drawn.
	 *
	 * Self-contained: queries its own slot and renders through
	 * ghost/loading/active without a `{#if device}` gate.
	 */

	import ControlTile from '../../device-panel/ControlTile.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

	const random = useFxGridSlot('random');
</script>

<!-- NO {#if device} gate - always render, each control handles its own state -->
<div class="h-full w-full flex p-(--central-inset) gap-(--central-gap)">
	<!-- The `random` control (deviceControls, ADR-479). A drag loads the
	     device if the slot is a ghost; a tap loads nothing, as on the tile
	     (ADR-167). -->
	<div class="flex-1">
		<ControlTile type="random" device={random.device} disableCentralViewOnTap />
	</div>
</div>
