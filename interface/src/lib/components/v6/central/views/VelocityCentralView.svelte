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

	import ControlTile from '../../device-panel/ControlTile.svelte';
	import VelocityRangeBrace from '../../controls/VelocityRangeBrace.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

	const velocity = useFxGridSlot('velocity');

</script>

<!-- NO {#if device} gate - always render, each control handles its own state -->
<div class="h-full w-full flex p-(--central-inset) gap-(--central-gap)">
	<!-- Rand Vel, the `velocity` control (deviceControls, ADR-479): Live's
	     Random is 0..64 (measured 2026-10-26); this slider scaled it to 127,
	     so its top half clamped. -->
	<div class="flex-1">
		<ControlTile type="velocity" device={velocity.device} icon="randvel" disableCentralViewOnTap />
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
