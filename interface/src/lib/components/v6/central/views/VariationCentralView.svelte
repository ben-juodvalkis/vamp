<script lang="ts">
  import { press } from '$lib/actions/press';
	/**
	 * VariationCentralView — the Stutter slider's view: the Variation (Beat
	 * Repeat) on its own. Stutter, the grid tile's slider (Chance, param 1),
	 * under the routing switch (12); then its controls as pick-one tabs:
	 * Interval (2), Grid (4) under Triplets (5) with the Random amount (6)
	 * on a knob beside it, Length (8). Pitch Decay (10) is not drawn (the
	 * user's call, 2026-10-15).
	 *
	 * On the face grid (ADR-510), sections 1 · 1 · 2 · 1, each named on
	 * the header line (the "Variation" title over all five and the column
	 * heads under it were two header lines). Columns about 185px.
	 *
	 * Re-laid for Ink (ADR-544, 2026-11-17). The two switches had a column
	 * of their own, "Mode", half the band each: lit, as both are on a fresh
	 * device, they were the view's two largest blocks. Each is one touch
	 * row over what it governs now: the routing over Stutter, Trip over the
	 * Grid it turns to triplets. That gives Grid's three options the row
	 * pitch of the tabs beside them, and Rnd a column of its own where it
	 * is a large knob (it sat under Grid's tab, medium, its name beside
	 * it). The options' names wore the Stutter slider's ink (user,
	 * 2026-10-15) and are labels now, the lit one on's block.
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
	import FaceGrid from '../FaceGrid.svelte';
	import FaceSection from '../FaceSection.svelte';
	import FaceSeam from '../FaceSeam.svelte';
	import PanelEyebrow from './panel/PanelEyebrow.svelte';

	const variation = useFxGridSlot('variation');

	// The selected track's ink as the slot hands it over (ADR-544). It was
	// put through the name-block envelope here, too pale for a line on paper.
	let varInk = $derived(variation.color);

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
<div class="variation-layout relative">
	<FaceGrid sections={[1, 1, 2, 1]}>
		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Stutter" color={varInk.primary} />{/snippet}
			<!-- The routing, a switch that names its state, over Stutter: the
			     grid tile's slider, Chance. The first drag loads the device. -->
			<div class="var-stack" class:slot-ghost={variation.isGhost}>
				<button
					class="physical-button btn-toggle var-switch"
					class:active={insertMode}
					aria-pressed={insertMode}
					use:press={{ onPress: () => variation.sendParam(ROUTING_INDEX, insertMode ? 0 : 1) }}
				>{insertMode ? 'Insert' : 'Mix'}</button>
				<div class="device-wrapper">
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
			</div>
		</FaceSection>
		<FaceSeam />

		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Interval" color={varInk.primary} />{/snippet}
			<div class="var-tab device-segmented seg-grid" class:slot-ghost={variation.isGhost}>
				{#each INTERVAL_OPTIONS as option}
					<button
						class="device-segment var-btn"
						class:active={Math.round(interval) === option.value}
						use:press={{ onPress: () => variation.sendParam(INTERVAL_INDEX, option.value) }}
					>{option.label}</button>
				{/each}
			</div>
		</FaceSection>
		<FaceSeam />

		<FaceSection span={2}>
			{#snippet head()}<PanelEyebrow title="Grid" color={varInk.primary} />{/snippet}
			<!-- Trip over the grids it turns to triplets; the grids are one tab. -->
			<div class="var-stack" class:slot-ghost={variation.isGhost}>
				<button
					class="physical-button btn-toggle var-switch"
					class:active={triplets}
					use:press={{ onPress: () => variation.sendParam(TRIPLETS_INDEX, triplets ? 1 : 0) }}
				>Trip</button>
				<div class="var-tab device-segmented seg-grid">
					{#each GRID_OPTIONS as option}
						<button
							class="device-segment var-btn"
							class:active={Math.round(grid) === option.value}
							use:press={{ onPress: () => variation.sendParam(GRID_INDEX, option.value) }}
						>{option.label}</button>
					{/each}
				</div>
			</div>
			<!-- Rnd, how far the grid strays: a knob, set and left, large, on
			     the line of the controls under the switch row (ADR-509). -->
			<div class="var-stack" class:slot-ghost={variation.isGhost}>
				<div class="var-switch-row" aria-hidden="true"></div>
				<div class="device-wrapper">
					<DeviceSlider
						value={amount / AMOUNT_MAX}
						title="Rnd"
						face="knob"
						knobSize="l"
						knobFit
						knobCaptionBelow
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
		<FaceSeam />

		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Length" color={varInk.primary} />{/snippet}
			<div class="var-tab device-segmented seg-grid" class:slot-ghost={variation.isGhost}>
				{#each GATE_OPTIONS as option}
					<button
						class="device-segment var-btn"
						class:active={Math.round(gate) === option.value}
						use:press={{ onPress: () => variation.sendParam(GATE_INDEX, option.value) }}
					>{option.label}</button>
				{/each}
			</div>
		</FaceSection>
	</FaceGrid>
</div>

<style>
	/* The face is the FaceGrid (ADR-510): five equal columns, Grid two. */
	.variation-layout {
		height: 100%;
		width: 100%;
	}

	/* A column: its switch row, then its control. */
	.var-stack {
		min-height: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--face-gutter);
	}
	.device-wrapper {
		flex: 1 1 0;
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
	}
	.device-wrapper > :global(*) {
		flex: 1 1 0;
		min-height: 0;
	}

	/* The switch row: one touch row at a column's head, empty over Rnd. */
	.var-switch,
	.var-switch-row {
		flex: 0 0 var(--height-touch);
		min-height: 0;
	}
	.var-switch {
		width: 100%;
		font-size: 0.875rem;
		font-weight: 600;
	}

	/* Interval, Grid and Length are pick-one tabs (2026-10-24): hairlines
	   between their options. */
	.var-tab {
		flex: 1 1 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-height: 0;
		min-width: 0;
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

	/* ---- Flat grammar: control text is medium and keeps its authored
	   case. An option's name is a label and the lit one on's block
	   (ADR-544; app.css's law), so the view sets no colour of its own. */
	:global([data-grammar="flat"]) .var-btn {
		text-transform: none;
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .var-switch {
		font-weight: var(--font-weight-medium);
	}
</style>
