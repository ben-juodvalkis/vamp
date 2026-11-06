<script lang="ts">
	/**
	 * VelocityCentralView — the Velocity MIDI effect's own view: the Random
	 * amount (Rand Vel) and the Out Low / Out Hi range brace. Until the chain
	 * overview (ADR-478) opened every device by its own type, both sat in the
	 * Arpeggiator view past a seam.
	 *
	 * On the face grid (ADR-510), sections [1, 1]: Random, then Out.
	 *
	 * Self-contained: queries its own slot and renders through
	 * ghost/loading/active without a `{#if device}` gate.
	 */

	import ControlTile from '../../device-panel/ControlTile.svelte';
	import VelocityRangeBrace from '../../controls/VelocityRangeBrace.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import FaceGrid from '../FaceGrid.svelte';
	import FaceSection from '../FaceSection.svelte';
	import FaceSeam from '../FaceSeam.svelte';
	import PanelEyebrow from './panel/PanelEyebrow.svelte';

	const velocity = useFxGridSlot('velocity');
	let ink = $derived(trackInk(velocity.color.primary, paintModeReactive()));

</script>

<!-- NO {#if device} gate - always render, each control handles its own state -->
<div class="h-full w-full">
	<FaceGrid sections={[1, 1]}>
		<!-- Rand Vel, the `velocity` control (deviceControls, ADR-479): Live's
		     Random is 0..64 (measured 2026-10-26); this slider scaled it to 127,
		     so its top half clamped. -->
		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Random" color={ink} />{/snippet}
			<div class="flex min-h-0 min-w-0">
				<ControlTile type="velocity" device={velocity.device} icon="randvel" disableCentralViewOnTap />
			</div>
		</FaceSection>
		<FaceSeam ink={ink} />

		<!-- Velocity Range Brace (Out Low / Out Hi) -->
		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Out" color={ink} />{/snippet}
			<div class="flex min-h-0 min-w-0">
				<VelocityRangeBrace
					device={velocity.device}
					isGhost={velocity.isGhost}
					color={velocity.color}
					onInteraction={() => velocity.loadIfGhost()}
				/>
			</div>
		</FaceSection>
	</FaceGrid>
</div>
