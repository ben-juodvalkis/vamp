<script lang="ts">
	/**
	 * VelocityCentralView — the Velocity MIDI effect's own view: the Random
	 * amount (Rand Vel) and the Out Low / Out Hi range brace. Until the chain
	 * overview (ADR-478) opened every device by its own type, both sat in the
	 * Arpeggiator view past a seam.
	 *
	 * Self-contained: queries its own slot and renders through
	 * ghost/loading/active without a `{#if device}` gate.
	 */

	import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
	import VelocityRangeBrace from '../../controls/VelocityRangeBrace.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

	const velocity = useFxGridSlot('velocity');

	const VELOCITY_PARAMS = {
		RANDOM: 3,
		OUT_HI: 6,
		OUT_LOW: 7
	} as const;

	let velocityRandom = $derived(velocity.paramValue(VELOCITY_PARAMS.RANDOM) ?? 0);
</script>

<!-- NO {#if device} gate - always render, each control handles its own state -->
<div class="h-full w-full flex p-(--central-inset) gap-(--central-gap)">
	<!-- Velocity Random slider -->
	<div class="flex-1" class:slot-ghost={velocity.isGhost}>
		<DeviceSlider
			value={velocityRandom / 127}
			title="Rand Vel"
			icon="randvel"
			orientation="vertical"
			labelOrientation="horizontal"
			labelSize="small"
			isGhost={velocity.isGhost}
			color={velocity.color}
			readout={velocity.paramDisplay(VELOCITY_PARAMS.RANDOM)}
			onInteraction={(value) => {
				const intValue = Math.round(value * 127);
				velocity.sendParam(VELOCITY_PARAMS.RANDOM, intValue);
			}}
		/>
	</div>

	<!-- Velocity Range Brace (Out Low / Out Hi) -->
	<div class="flex-1">
		<VelocityRangeBrace
			device={velocity.device}
			isGhost={velocity.isGhost}
			color={velocity.color}
			onInteraction={() => velocity.loadIfGhost()}
		/>
	</div>
</div>
