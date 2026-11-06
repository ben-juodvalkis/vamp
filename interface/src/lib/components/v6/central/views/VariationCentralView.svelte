<script lang="ts">
	/**
	 * VariationCentralView — the Stutter slider's view: the Variation (Beat
	 * Repeat) on its own. Stutter, the grid tile's slider (Chance, param 1),
	 * then its controls as pick-one tabs: Interval (2), Grid (4) with the
	 * Random amount (6) on a slider under it, Length (8); and Mode, two
	 * switches, the routing (12) over Triplets (5). Pitch Decay (10) is not
	 * drawn (the user's call, 2026-10-15).
	 *
	 * On the face grid (ADR-510), five one-column sections, each named on
	 * the header line (the "Variation" title over all five and the column
	 * heads under it were two header lines). Columns about 167px: Rnd's
	 * large knob with its caption beside needs 192, so it is medium.
	 *
	 * Its own file since 2026-10-24 (the user's call). From 2026-10-15 it was
	 * a `part` of GlitchCentralView, with which it shares no device and no
	 * control.
	 *
	 * Self-contained: queries its own slot and renders through
	 * ghost/loading/active without a `{#if device}` gate.
	 */

	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import FaceGrid from '../FaceGrid.svelte';
	import FaceSection from '../FaceSection.svelte';
	import FaceSeam from '../FaceSeam.svelte';
	import PanelEyebrow from './panel/PanelEyebrow.svelte';

	const variation = useFxGridSlot('variation');

	// GRATICULE §5.5: calibrate the device's ink at injection (hue preserved).
	let varInk = $derived({
		primary: trackInk(variation.color.primary, paintModeReactive()),
		secondary: variation.color.secondary,
		accent: trackInk(variation.color.accent, paintModeReactive())
	});

	const CHANCE_INDEX = 1;       // float 0-1, the grid tile's slider
	const INTERVAL_INDEX = 2;     // int 0-7
	const GRID_INDEX = 4;         // int 0-15
	const TRIPLETS_INDEX = 5;     // bool 0/1
	const AMOUNT_INDEX = 6;       // int 0-10
	const GATE_INDEX = 8;         // int 0-18
	const ROUTING_INDEX = 12;     // bool 0/1 — 0 = Mix, 1 = Insert

	const AMOUNT_MAX = 10;

	const INTERVAL_OPTIONS = [
		{ value: 5, label: '1 Bar' },
		{ value: 4, label: '1/2' },
		{ value: 3, label: '1/4' },
		{ value: 2, label: '1/8' }
	];

	const GRID_OPTIONS = [
		{ value: 11, label: '1/4' },
		{ value: 9, label: '1/8' },
		{ value: 7, label: '1/16' }
	];

	const GATE_OPTIONS = [
		{ value: 15, label: '1 Bar' },
		{ value: 7, label: '1/2' },
		{ value: 3, label: '1/4' },
		{ value: 1, label: '1/8' }
	];

	let chance = $derived(variation.paramValue(CHANCE_INDEX) ?? 0);
	let interval = $derived(variation.paramValue(INTERVAL_INDEX) ?? 0);
	let grid = $derived(variation.paramValue(GRID_INDEX) ?? 0);
	let triplets = $derived(Math.round(variation.paramValue(TRIPLETS_INDEX) ?? 0) === 0);
	let amount = $derived(variation.paramValue(AMOUNT_INDEX) ?? 0);
	let gate = $derived(variation.paramValue(GATE_INDEX) ?? 0);
	// The switch NAMES its state: 0 is Mix, 1 is Insert. Reads Insert (1)
	// until the device's own value arrives.
	let insertMode = $derived(Math.round(variation.paramValue(ROUTING_INDEX) ?? 1) === 1);
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="variation-layout relative" style="--btn-tint: {varInk.primary};">
	<FaceGrid sections={[1, 1, 1, 1, 1]}>
		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Stutter" color={varInk.primary} />{/snippet}
			<!-- Stutter: the grid tile's slider, Chance. The first drag loads the device. -->
			<div class="device-wrapper" class:slot-ghost={variation.isGhost}>
				<DeviceSlider
					value={chance}
					title="Stutter"
					orientation="vertical"
					labelOrientation="horizontal"
					isGhost={variation.isGhost}
					color={varInk}
					min={0}
					max={1}
					readout={variation.paramDisplay(CHANCE_INDEX)}
					onTap={() => variation.loadIfGhost()}
					onInteraction={(value) => variation.sendParam(CHANCE_INDEX, value)}
				/>
			</div>
		</FaceSection>
		<FaceSeam ink={varInk.primary} />

		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Interval" color={varInk.primary} />{/snippet}
			<div class="var-stack device-segmented seg-grid" class:slot-ghost={variation.isGhost}>
				{#each INTERVAL_OPTIONS as option}
					<button
						class="device-segment var-btn"
						class:active={Math.round(interval) === option.value}
						onclick={() => variation.sendParam(INTERVAL_INDEX, option.value)}
					>{option.label}</button>
				{/each}
			</div>
		</FaceSection>
		<FaceSeam ink={varInk.primary} />

		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Grid" color={varInk.primary} />{/snippet}
			<div class="var-stack" class:slot-ghost={variation.isGhost}>
				<!-- The grids are one tab; the Rnd knob under it is not one of
				     them. Medium with its caption beside, 88px tall (ADR-509). -->
				<div class="var-tab device-segmented seg-grid" style="flex: {GRID_OPTIONS.length} 1 0;">
					{#each GRID_OPTIONS as option}
						<button
							class="device-segment var-btn"
							class:active={Math.round(grid) === option.value}
							onclick={() => variation.sendParam(GRID_INDEX, option.value)}
						>{option.label}</button>
					{/each}
				</div>
				<div class="flex-none h-[5.5rem] min-h-0">
					<DeviceSlider
						value={amount / AMOUNT_MAX}
						title="Rnd"
						face="knob"
						knobSize="m"
						orientation="horizontal"
						labelOrientation="horizontal"
						labelSize="small"
						isGhost={variation.isGhost}
						color={varInk}
						readout={variation.paramDisplay(AMOUNT_INDEX)}
						onInteraction={(value) => variation.sendParam(AMOUNT_INDEX, Math.round(value * AMOUNT_MAX))}
					/>
				</div>
			</div>
		</FaceSection>
		<FaceSeam ink={varInk.primary} />

		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Length" color={varInk.primary} />{/snippet}
			<div class="var-stack device-segmented seg-grid" class:slot-ghost={variation.isGhost}>
				{#each GATE_OPTIONS as option}
					<button
						class="device-segment var-btn"
						class:active={Math.round(gate) === option.value}
						onclick={() => variation.sendParam(GATE_INDEX, option.value)}
					>{option.label}</button>
				{/each}
			</div>
		</FaceSection>
		<FaceSeam ink={varInk.primary} />

		<!-- Two switches, each on or off on its own: separate buttons. -->
		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Mode" color={varInk.primary} />{/snippet}
			<div class="var-stack" class:slot-ghost={variation.isGhost}>
				<button
					class="physical-button var-btn"
					class:active={insertMode}
					aria-pressed={insertMode}
					onclick={() => variation.sendParam(ROUTING_INDEX, insertMode ? 0 : 1)}
				>{insertMode ? 'Insert' : 'Mix'}</button>
				<button
					class="physical-button var-btn"
					class:active={triplets}
					onclick={() => variation.sendParam(TRIPLETS_INDEX, triplets ? 1 : 0)}
				>Trip</button>
			</div>
		</FaceSection>
	</FaceGrid>
</div>

<style>
	/* The face is the FaceGrid (ADR-510): five equal columns. */
	.variation-layout {
		height: 100%;
		width: 100%;
	}

	.device-wrapper {
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
	}

	.var-stack {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	/* Interval, Grid and Length are pick-one tabs (2026-10-24): hairlines
	   between their options, not the stack's gap. */
	.var-stack.seg-grid {
		gap: 1px;
	}
	.var-tab {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.var-btn {
		flex: 1;
		min-height: 0;
		padding: 0 0.25rem;
		font-size: 1rem;
		font-weight: 700;
	}

	/* GRATICULE: button labels are authored mixed-case and up-cased here
	   for the HUD voice. */
	.var-btn {
		text-transform: uppercase;
	}

	/* ---- Live skin (flat grammar) ------------------------------------ */
	/* Live sets control text medium, keeps authored case, and does not
	   letterspace its section legends; headers are plain secondary text. */
	:global([data-grammar="flat"]) .var-btn {
		text-transform: none;
	}
	:global([data-grammar="flat"]) .variation-layout .physical-button {
		font-weight: var(--font-weight-medium);
	}
	/* The options wear the Stutter slider's ink (user, 2026-10-15): the name
	   in the device ink, the lit one filled with it. */
	:global([data-skin="hybrid"]) .var-btn {
		color: var(--btn-tint);
	}
	:global(.light[data-skin="hybrid"]) .var-btn {
		color: color-mix(in oklab, var(--btn-tint) 55%, var(--foreground));
	}
	:global([data-grammar="flat"]) .var-btn.active {
		background: var(--btn-tint);
		border-color: var(--btn-tint);
		color: var(--flat-on-fg);
	}
</style>
