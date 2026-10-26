<script lang="ts">
	/**
	 * RandomCentralView — the Random MIDI effect's own view (MidiRandom, the
	 * Rand Oct tile's device): the tile's one control, Chance (param 1, a
	 * 0..1 float, the face `presetFaces.ts` measured on the Blue preset), at
	 * full size. Until the chain overview (ADR-478) the `random` type opened
	 * the Arpeggiator view, which drew nothing that drives this device.
	 *
	 * Random's other parameters (Choices, Scale, Sign, Alternate, Use
	 * Current Scale) have no measured indices yet, so they are not drawn.
	 *
	 * Self-contained: queries its own slot and renders through
	 * ghost/loading/active without a `{#if device}` gate.
	 */

	import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

	const random = useFxGridSlot('random');

	const RANDOM_PARAMS = {
		CHANCE: 1 // float 0-1, the Rand Oct tile's slider
	} as const;

	let chanceValue = $derived(random.paramValue(RANDOM_PARAMS.CHANCE) ?? 0);
	let chanceDisplay = $derived(random.paramDisplay(RANDOM_PARAMS.CHANCE));
	let chanceTitle = $derived(chanceDisplay ? `Rand Oct · ${chanceDisplay}` : 'Rand Oct');
</script>

<!-- NO {#if device} gate - always render, each control handles its own state -->
<div class="h-full w-full flex p-(--central-inset) gap-(--central-gap)">
	<!-- A drag loads the device if the slot is a ghost (sendParam's state
	     machine); a tap loads nothing, as on the tile (ADR-167). -->
	<div class="flex-1" class:slot-ghost={random.isGhost}>
		<DeviceSlider
			value={chanceValue}
			title={chanceTitle}
			orientation="vertical"
			labelOrientation="horizontal"
			labelSize="small"
			isGhost={random.isGhost}
			color={random.color}
			onInteraction={(value) => {
				random.sendParam(RANDOM_PARAMS.CHANCE, value);
			}}
		/>
	</div>
</div>
