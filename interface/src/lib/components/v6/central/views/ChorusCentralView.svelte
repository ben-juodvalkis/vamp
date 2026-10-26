<script lang="ts">
	/**
	 * The Chorus's view (Live's Chorus-Ensemble, the `chorus` slot): its XY,
	 * full size. One device per view since the FX chain overview took over
	 * from the grid (2026-10-26). Until then this file drew the rest of the
	 * Chorus family (Blur, Comb, Phaser), and on a drum track the Auto Pan
	 * view carried all four; each has its own view now (`BlurCentralView`,
	 * `CombCentralView`, `PhaserCentralView`).
	 *
	 * NO {#if device} gate - ChorusControl handles its own ghost state.
	 */

	import ChorusControl from '$lib/components/v6/device-panel/ChorusControl.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { getSlotByDeviceType } from '$lib/config/fxGridLayout';

	const chorus = useFxGridSlot('chorus');

	// The Chorus keeps its layout entry (hidden from the grid) so its slot
	// still resolves by position.
	const chorusPosition = getSlotByDeviceType('chorus')!.position;
</script>

<div class="device-layout" data-view="chorus">
	<div class="cell" class:slot-ghost={chorus.isGhost}>
		<ChorusControl device={chorus.device} position={chorusPosition} />
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
