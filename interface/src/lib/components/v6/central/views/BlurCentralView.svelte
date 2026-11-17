<script lang="ts">
	/**
	 * Blur's view (`Vamp Devices/Blur/Blur.amxd`, the `smudge` slot): its
	 * dry/wet, full size. It was a column of the Chorus view (and of the Auto
	 * Pan view on a drum track) until the FX chain overview gave every device
	 * a view of its own (2026-10-26).
	 *
	 * Blur has one parameter, so the view is one box, the whole band a
	 * fader. It wears the device's picture (ADR-544 rollout, 2026-11-17: it
	 * was an empty pad with a name at its left edge): the face its chain
	 * cell and browser tile draw, smeared further the wetter it is, so the
	 * box reads at rest and at zero. The title band names the device; where
	 * a picture draws, the control carries no second name.
	 *
	 * NO {#if device} gate - the control handles its own ghost state.
	 */

	import SmudgeControl from '$lib/components/v6/device-panel/SmudgeControl.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { setContext } from 'svelte';
	import { PICTURE_CONTEXT } from '$lib/components/v6/browser/devicePictures';

	// The control draws its device's picture, as in the chain and the browser.
	setContext(PICTURE_CONTEXT, true);

	const fx = useFxGridSlot('smudge');
</script>

<div class="device-layout" data-view="smudge">
	<div class="cell" class:slot-ghost={fx.isGhost}>
		<SmudgeControl device={fx.device} orientation="vertical" />
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

	/* The picture as the view's one reading: at full strength, the band's
	   height and a heavier line. A tile draws it faint and small, a mark
	   behind a name; here there is nothing else to read. */
	.cell :global(.slider-picture:not(.slider-picture--inverse)) {
		opacity: 1;
	}
	.cell :global(.device-picture) {
		inset: 3%;
		width: 94%;
		height: 94%;
		opacity: 1;
	}
	.cell :global(.device-picture path) {
		stroke-width: 2.5px;
	}
</style>
