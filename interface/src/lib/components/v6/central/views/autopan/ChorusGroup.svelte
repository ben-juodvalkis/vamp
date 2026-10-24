<script lang="ts">
	/**
	 * ChorusGroup — the Chorus family inside the Auto Pan view (2026-10-15,
	 * the user's call): the Chorus XY that was the grid tile, then Blur's
	 * dry/wet, Comb and Phaser, which were the Chorus view.
	 *
	 * Two columns, Chorus over Blur and Comb over Phaser, stacked so no
	 * control is narrow. Its root is `display: contents`, so the columns
	 * and seams are grid items of AutoPanCentralView, which owns the tracks.
	 *
	 * Contains virtual devices (smudge, comb, phaser) which have their own
	 * ghost states. NO {#if device} gate - always renders, handles its own
	 * state.
	 */

	import ChorusControl from '$lib/components/v6/device-panel/ChorusControl.svelte';
	import SmudgeControl from '$lib/components/v6/device-panel/SmudgeControl.svelte';
	import CombControl from '$lib/components/v6/device-panel/CombControl.svelte';
	import PhaserPad from '../chorus/PhaserPad.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { getSlotByDeviceType } from '$lib/config/fxGridLayout';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import SectionDivider from '../../SectionDivider.svelte';

	const chorus = useFxGridSlot('chorus');
	const comb = useFxGridSlot('comb');
	const smudge = useFxGridSlot('smudge');
	const phaser = useFxGridSlot('phaser');

	// The Chorus keeps its layout entry (hidden from the grid) so its slot
	// still resolves by position.
	const chorusPosition = getSlotByDeviceType('chorus')!.position;

	// GRATICULE (§5.5): calibrate the slot palette through trackInk at injection.
	let chorusInk = $derived(trackInk(chorus.color.primary, paintModeReactive()));
	let smudgeInk = $derived(trackInk(smudge.color.primary, paintModeReactive()));
	let combInk = $derived(trackInk(comb.color.primary, paintModeReactive()));
	let phaserInk = $derived(trackInk(phaser.color.primary, paintModeReactive()));

</script>

<div class="chorus-group">
	<SectionDivider orientation="vertical" ink={chorusInk} />

	<!-- Chorus over Blur. Seams fall on the DEVICE boundaries, across a
	     column where devices stack. -->
	<div class="stack">
		<!-- The Chorus XY, the grid tile until 2026-10-15. -->
		<div class="cell pad" class:slot-ghost={chorus.isGhost}>
			<ChorusControl device={chorus.device} position={chorusPosition} />
		</div>

		<SectionDivider orientation="horizontal" ink={smudgeInk} />

		<!-- Blur's dry/wet (the `smudge` slot; virtual device - handles its own slot state) -->
		<div class="cell fader" class:slot-ghost={smudge.isGhost}>
			<SmudgeControl device={smudge.device} icon="blur" orientation="horizontal" />
		</div>
	</div>

	<SectionDivider orientation="vertical" ink={combInk} />

	<!-- Comb over Phaser. The pads are the same size and two wear the same
	     ink, so without the seam the Phaser reads as a second Comb
	     (2026-09-13, ADR-433). -->
	<div class="stack">
		<!-- Comb (virtual device - handles its own slot state). The Max
		     device has no LFO. -->
		<div class="cell pad" class:slot-ghost={comb.isGhost}>
			<CombControl device={comb.device} icon="comb" />
		</div>

		<SectionDivider orientation="horizontal" ink={phaserInk} />

		<!-- Phaser (virtual device) — X: LFO speed, Y: feedback. -->
		<div class="cell pad" class:slot-ghost={phaser.isGhost}>
			<PhaserPad />
		</div>
	</div>
</div>

<style>
	.chorus-group {
		display: contents;
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--central-gap);
		min-height: 0;
		min-width: 0;
	}

	.cell {
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
	}

	/* A pad takes two shares of the column, a flat fader one. */
	.pad {
		flex: 2 1 0;
	}
	.fader {
		flex: 1 1 0;
	}
</style>
