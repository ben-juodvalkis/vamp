<script lang="ts">
	/**
	 * Comb's view (`Vamp Devices/Comb/Comb.amxd`, the `comb` slot). It was a
	 * column of the Chorus view (and of the Auto Pan view on a drum track)
	 * until the FX chain overview gave every device a view of its own
	 * (2026-10-26). The device gained an LFO on Tune (2026-10-27; user: "add
	 * the LFO controls to the central view"):
	 *
	 *   [Comb pad] | [LFO pad: rate across, amount up] [Shape, 7; Sync]
	 *
	 * The pad's rate is Live's synced step while Sync is on, the free Rate
	 * otherwise. Parameters are `COMB` in `deviceControls`, by name with the
	 * measured index as the fallback. A Comb saved before the LFO has none of
	 * its parameters: the LFO side dims and sends nothing.
	 *
	 * NO {#if device} gate - every control handles its own ghost state.
	 */

	import CombControl from '$lib/components/v6/device-panel/CombControl.svelte';
	import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
	import SectionDivider from '$lib/components/v6/central/SectionDivider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { COMB, COMB_LFO, resolveParam, type ParamRef } from '$lib/components/v6/device-panel/deviceControls';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';

	const fx = useFxGridSlot('comb');

	let ink = $derived({
		primary: trackInk(fx.color.primary, paintModeReactive()),
		secondary: fx.color.secondary,
		accent: trackInk(fx.color.accent, paintModeReactive())
	});

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

<div class="comb-layout" data-view="comb" style="--btn-tint: {ink.primary};">
	<div class="col" class:slot-ghost={fx.isGhost}>
		<CombControl device={fx.device} icon="comb" />
	</div>

	<SectionDivider orientation="vertical" />

	<div class="col" class:slot-ghost={fx.isGhost} class:no-lfo={!hasLfo}>
		<DeviceXY
			xValue={synced ? value(COMB.lfoSyncRate) / COMB_LFO.syncRateMax : (value(COMB.lfoRate) - COMB_LFO.rateMin) / rateSpan}
			yValue={value(COMB.lfoAmount) / COMB_LFO.amountMax}
			title="LFO"
			rateLabel={display(synced ? COMB.lfoSyncRate : COMB.lfoRate)}
			isGhost={fx.isGhost}
			showCurve={false}
			color={ink}
			onTap={() => fx.loadIfGhost()}
			onInteraction={(x, y) => {
				if (synced) send(COMB.lfoSyncRate, Math.round(x * COMB_LFO.syncRateMax));
				else send(COMB.lfoRate, COMB_LFO.rateMin + x * rateSpan);
				send(COMB.lfoAmount, y * COMB_LFO.amountMax);
			}}
		/>
	</div>

	<div class="col" class:slot-ghost={fx.isGhost} class:no-lfo={!hasLfo}>
		<!-- The LFO shapes, one column of seven, a tab that scrubs. -->
		<ScrubTabs
			options={SHAPES}
			selected={fx.isGhost ? -1 : shape}
			onSelect={(i) => send(COMB.lfoShape, i)}
			cols={1}
			tint={ink.primary}
			inked
			label={(l) => `LFO shape ${l}`}
			name="comb-lfo-shape"
			style="flex: 7 1 0; --scrub-padding: 6px;"
		>
			{#snippet item(_, i)}
				<svg class="shape-glyph" viewBox="0 0 24 12" aria-hidden="true" focusable="false">
					<path d={SHAPE_GLYPHS[i]} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
				</svg>
			{/snippet}
		</ScrubTabs>
		<button class="physical-button switch" class:active={synced} aria-pressed={synced} onclick={() => send(COMB.lfoSync, synced ? 0 : 1)}>Sync</button>
	</div>
</div>

<style>
	/* The comb pad and the LFO pad the widest; a seam between the comb and its LFO. */
	.comb-layout {
		display: grid;
		grid-template-columns: minmax(0, 2fr) auto minmax(0, 2fr) minmax(0, 0.75fr);
		height: 100%;
		width: 100%;
		padding: var(--central-inset);
		gap: var(--central-gap);
	}

	.col {
		display: flex;
		flex-direction: column;
		gap: var(--central-gap);
		min-width: 0;
		min-height: 0;
	}
	.col > :global(*) {
		min-height: 0;
	}
	.col > :global(.device-control),
	.col > :global(.xy-pad) {
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
	.switch {
		flex: 1 1 0;
		min-height: var(--height-touch);
		font-size: 1rem;
		font-weight: 600;
	}

	:global([data-grammar="flat"]) .switch {
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .switch.active {
		background: var(--btn-tint);
		border-color: var(--btn-tint);
		color: var(--flat-on-fg);
	}
</style>
