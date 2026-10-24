<script lang="ts">
	/**
	 * The Chorus tile's view (2026-10-23, the user's call). On a track that
	 * is not a drum track the Chorus XY stands in the FX grid's Drum cell
	 * (`drumCellHoldsChorus`), and this view holds the rest of the Chorus
	 * family, out of the Auto Pan view: Blur's dry/wet, Comb and Phaser.
	 *
	 * On a drum track there is no Chorus tile and the family stays in the
	 * Auto Pan view (`autopan/ChorusGroup`), so a touch on its Chorus XY,
	 * which opens this view, draws that one.
	 *
	 * Columns on one ruler, a slider one share and a pad two (the Drum Rack
	 * view's rule): Blur | Comb | Phaser, each its own device, seamed.
	 * Every control is a virtual device with its own ghost: no device gate.
	 */

	import AutoPanCentralView from './AutoPanCentralView.svelte';
	import SmudgeControl from '$lib/components/v6/device-panel/SmudgeControl.svelte';
	import CombControl from '$lib/components/v6/device-panel/CombControl.svelte';
	import PhaserPad from './chorus/PhaserPad.svelte';
	import SectionDivider from '../SectionDivider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { drumCellHoldsChorus } from '$lib/components/v6/device-panel/drumCell.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';

	const ownView = $derived(drumCellHoldsChorus());

	const smudge = useFxGridSlot('smudge');
	const comb = useFxGridSlot('comb');
	const phaser = useFxGridSlot('phaser');

	let combInk = $derived(trackInk(comb.color.primary, paintModeReactive()));
	let phaserInk = $derived(trackInk(phaser.color.primary, paintModeReactive()));
</script>

{#if ownView}
	<div class="chorus-layout" data-view="chorus">
		<div class="cell" class:slot-ghost={smudge.isGhost}>
			<SmudgeControl device={smudge.device} icon="blur" orientation="vertical" />
		</div>

		<SectionDivider orientation="vertical" ink={combInk} />

		<div class="cell" class:slot-ghost={comb.isGhost}>
			<CombControl device={comb.device} icon="comb" />
		</div>

		<SectionDivider orientation="vertical" ink={phaserInk} />

		<div class="cell" class:slot-ghost={phaser.isGhost}>
			<PhaserPad />
		</div>
	</div>
{:else}
	<AutoPanCentralView />
{/if}

<style>
	.chorus-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 2fr) auto minmax(0, 2fr);
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
