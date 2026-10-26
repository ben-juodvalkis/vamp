<script lang="ts">
	/**
	 * The Phaser-Flanger's view (the `phaser` slot): its pad (X LFO speed,
	 * Y feedback), full size. It was a column of the Chorus view (and of the
	 * Auto Pan view on a drum track) until the FX chain overview gave every
	 * device a view of its own (2026-10-26).
	 *
	 * NO {#if device} gate - the control handles its own ghost state.
	 */

	import PhaserPad from './chorus/PhaserPad.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

	const fx = useFxGridSlot('phaser');
</script>

<div class="device-layout" data-view="phaser">
	<div class="cell" class:slot-ghost={fx.isGhost}>
		<PhaserPad />
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
