<script lang="ts">
	/**
	 * Comb's view (`Vamp Devices/Comb/Comb.amxd`, the `comb` slot): its
	 * pad, full size. It was a column of the Chorus view (and of the Auto Pan
	 * view on a drum track) until the FX chain overview gave every device a
	 * view of its own (2026-10-26).
	 *
	 * NO {#if device} gate - the control handles its own ghost state.
	 */

	import CombControl from '$lib/components/v6/device-panel/CombControl.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

	const fx = useFxGridSlot('comb');
</script>

<div class="device-layout" data-view="comb">
	<div class="cell" class:slot-ghost={fx.isGhost}>
		<CombControl device={fx.device} icon="comb" />
	</div>
</div>

<style>
	.device-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--central-gap);
		height: 100%;
		width: 100%;
		padding: var(--central-inset);
	}

	.cell {
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
	}
</style>
