<script lang="ts">
  import { press } from '$lib/actions/press';
	/**
	 * Comb's view (`Vamp Devices/Comb/Comb.amxd`, the `comb` slot). It was a
	 * column of the Chorus view (and of the Auto Pan view on a drum track)
	 * until the FX chain overview gave every device a view of its own
	 * (2026-10-26). The device gained an LFO on Tune (2026-10-27; user: "add
	 * the LFO controls to the central view"):
	 *
	 *   [Sync over Shape, 2 x 4] [LFO pad: rate across, amount up]
	 *
	 * on one face grid (ADR-510), one section of five columns, the pad
	 * four. Tune and Feedback / Mix are the chain cell's pad (the `comb`
	 * control, deviceControls, ADR-479), drawn above this view, so the
	 * view no longer draws that pad too (user, 2026-11-06).
	 *
	 * Re-laid for Ink (ADR-544, 2026-11-17) in the order every LFO in these
	 * views reads: shape, then the LFO itself. The seven shapes are two
	 * columns of four, a touch row each (one column of 32px rows before),
	 * under Sync on the face's switch row. The pad wears the LFO it moves:
	 * its wave drawn behind the dot (ADR-514), as many cycles as its rate
	 * and as tall as its amount, in place of the word "LFO" at the pad's
	 * middle, which the section's name already says. The rate's reading
	 * shows only while a finger is on the pad.
	 *
	 * The pad's rate is Live's synced step while Sync is on, the free Rate
	 * otherwise. Parameters are `COMB` in `deviceControls`, by name with the
	 * measured index as the fallback. A Comb saved before the LFO has none of
	 * its parameters: the LFO side dims and sends nothing.
	 *
	 * NO {#if device} gate - every control handles its own ghost state.
	 */

	import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
	import FaceGrid from '$lib/components/v6/central/FaceGrid.svelte';
	import FaceSection from '$lib/components/v6/central/FaceSection.svelte';
	import PanelEyebrow from './panel/PanelEyebrow.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { COMB, COMB_LFO, resolveParam, type ParamRef } from '$lib/components/v6/device-panel/deviceControls';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import LfoGraph from '../LfoGraph.svelte';
	import { pictureParams } from './panel/usePanelParams.svelte';
	import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';

	const fx = useFxGridSlot('comb');

	// The selected track's ink as the slot hands it over (ADR-544); it was
	// put through the name-block envelope here, too pale for a line on paper.
	let ink = $derived(fx.color);

	let names = $derived(fx.device ? selectedTrackStore.paramNamesForDevice(fx.device) : []);
	/** A loaded Comb saved before the LFO has no Amount. */
	let hasLfo = $derived(!fx.device || names.includes(COMB.lfoAmount.name));
	const index = (ref: ParamRef) => resolveParam(ref, names);

	/** The device's saved defaults (device_dump), what a ghost shows. */
	const REST = new Map<ParamRef, number>([
		[COMB.lfoAmount, 0],
		[COMB.lfoRate, 1.587],
		[COMB.lfoSyncRate, 7],
		[COMB.lfoShape, 0],
		[COMB.lfoSync, 0]
	]);
	const value = (ref: ParamRef) => fx.paramValue(index(ref)) ?? REST.get(ref) ?? 0;
	const display = (ref: ParamRef) => fx.paramDisplay(index(ref));
	function send(ref: ParamRef, v: number) {
		if (hasLfo) fx.sendParam(index(ref), v);
	}

	const synced = $derived(value(COMB.lfoSync) >= 0.5);
	const shape = $derived(Math.round(value(COMB.lfoShape)));
	const rateSpan = COMB_LFO.rateMax - COMB_LFO.rateMin;
	/** The pad's two axes, 0..1: the rate Sync has on, and the amount. */
	const padX = $derived(synced ? value(COMB.lfoSyncRate) / COMB_LFO.syncRateMax : (value(COMB.lfoRate) - COMB_LFO.rateMin) / rateSpan);
	const padY = $derived(value(COMB.lfoAmount) / COMB_LFO.amountMax);
	/** The LFO as a picture behind the pad's dot (ADR-514): its rate in cycles, its amount as its height. */
	const picture = pictureParams(() => ({ Rate: padX, Amount: padY }));

	/** Live's names for Shape's steps (device_dump), one cycle each in a 24 × 12 box. */
	const SHAPES = ['Sine', 'Triangle', 'Saw Up', 'Saw Down', 'Square', 'S&H', 'Smooth Rnd'];
	const SHAPE_GLYPHS = [
		'M0 6 Q6 -1 12 6 T24 6',
		'M0 6 L6 2 L18 10 L24 6',
		'M0 10 L20 2 L20 10',
		'M4 10 L4 2 L24 10',
		'M0 10 L0 2 L12 2 L12 10 L24 10',
		'M0 7 L5 7 L5 3 L10 3 L10 9 L15 9 L15 5 L20 5 L20 8 L24 8',
		'M0 7 C3 2 6 3 8 6 S13 11 16 8 S21 3 24 5'
	];
</script>

<!-- One face grid (ADR-510), five columns of ~200px at 1366 x 1024:
     Sync over the shapes one, the LFO's pad four. -->
<div class="comb-layout" data-view="comb">
<FaceGrid sections={[5]}>
	<FaceSection span={5}>
	{#snippet head()}<PanelEyebrow title="LFO" color={ink.primary} />{/snippet}
	<div class="col" class:slot-ghost={fx.isGhost} class:no-lfo={!hasLfo}>
		<button class="physical-button btn-toggle switch" class:active={synced} aria-pressed={synced} use:press={{ onPress: () => send(COMB.lfoSync, synced ? 0 : 1) }}>Sync</button>
		<!-- The LFO shapes, two columns of four, a tab that scrubs. -->
		<ScrubTabs
			options={SHAPES}
			selected={fx.isGhost ? -1 : shape}
			onSelect={(i) => send(COMB.lfoShape, i)}
			cols={2}
			rows={4}
			label={(l) => `LFO shape ${l}`}
			name="comb-lfo-shape"
			style="flex: 1 1 0; --scrub-padding: 6px;"
		>
			{#snippet item(_, i)}
				<svg class="shape-glyph" viewBox="0 0 24 12" aria-hidden="true" focusable="false">
					<path d={SHAPE_GLYPHS[i]} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
				</svg>
			{/snippet}
		</ScrubTabs>
	</div>

	<div class="col face-span-4" class:slot-ghost={fx.isGhost} class:no-lfo={!hasLfo}>
		<DeviceXY
			xValue={padX}
			yValue={padY}
			title="LFO"
			titleClass="pad-title"
			rateLabel={display(synced ? COMB.lfoSyncRate : COMB.lfoRate)}
			rateWhileDragging
			isGhost={fx.isGhost}
			showCurve={false}
			color={ink}
			onTap={() => fx.loadIfGhost()}
			onInteraction={(x, y) => {
				if (synced) send(COMB.lfoSyncRate, Math.round(x * COMB_LFO.syncRateMax));
				else send(COMB.lfoRate, COMB_LFO.rateMin + x * rateSpan);
				send(COMB.lfoAmount, y * COMB_LFO.amountMax);
			}}
		>
			{#snippet background()}
				<div class="pad-picture">
					<LfoGraph params={picture} shape={SHAPES[shape]} rate="Rate" amount="Amount" ink={ink.primary} interactive={false} maxAspect={4} />
				</div>
			{/snippet}
		</DeviceXY>
	</div>
	</FaceSection>
</FaceGrid>
</div>

<style>
	/* The face is the FaceGrid (ADR-510): the shapes one column, the LFO's
	   pad four. */
	.comb-layout {
		height: 100%;
		width: 100%;
		min-height: 0;
	}

	.col {
		display: flex;
		flex-direction: column;
		gap: var(--face-gutter);
		min-width: 0;
		min-height: 0;
	}
	.col > :global(*) {
		min-height: 0;
	}
	.col > :global(.device-control),
	.col > :global(.xy-pad),
	.col > :global(.device-xy) {
		flex: 1 1 0;
	}
	.no-lfo {
		opacity: 0.35;
		pointer-events: none;
	}

	.shape-glyph {
		width: 100%;
		height: 100%;
		max-height: 22px;
	}
	/* Sync: one touch row over the shapes (ADR-509). */
	.switch {
		flex: 0 0 var(--height-touch);
		min-height: var(--height-touch);
		font-size: 0.875rem;
		font-weight: var(--font-weight-medium);
	}

	/* The LFO's wave behind the pad's dot: the picture's own frame laid
	   over the pad's, and never taking a touch. */
	.pad-picture {
		position: absolute;
		inset: -1px;
		pointer-events: none;
	}
	/* The pad's name stays its accessible name; the picture and the
	   section's name say it on the glass. */
	:global([data-grammar="flat"]) .comb-layout :global(.pad-title) {
		display: none;
	}
</style>
