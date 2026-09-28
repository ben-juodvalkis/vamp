<script lang="ts">
	/**
	 * VariationCentralView
	 *
	 * Five columns, left to right:
	 *   Interval    (param 2)  — radio strip, musical divisions
	 *   Grid        (param 4)  — radio strip + the Random amount slider
	 *                            (param 6) riding its spare row
	 *   Length      (param 8)  — radio strip, musical divisions
	 *   ── seam: the three division pickers | what the repeats sound like
	 *   Pitch Decay (param 10) — float slider, full height
	 *   Mode                   — the routing switch (param 12) over the
	 *                            triplets toggle (param 5)
	 *
	 * The radio strips expose only the musically useful values of each
	 * int param; the underlying device parameters still accept their
	 * full ranges. Triplets is a Grid parameter but stays in Mode, on the
	 * far side of the seam: moving it would break the Grid column's
	 * four-row rhythm (2026-09-13).
	 */

	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import SectionDivider from '$lib/components/v6/central/SectionDivider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';

	const fx = useFxGridSlot('variation');

	// GRATICULE §5.5: calibrate the device ink at injection (hue preserved).
	let fxInk = $derived({
		primary: trackInk(fx.color.primary, paintModeReactive()),
		secondary: fx.color.secondary,
		accent: trackInk(fx.color.accent, paintModeReactive())
	});

	const INTERVAL_INDEX = 2;    // int 0-7
	const GRID_INDEX = 4;        // int 0-15
	const TRIPLETS_INDEX = 5;    // bool 0/1
	const AMOUNT_INDEX = 6;      // int 0-10
	const GATE_INDEX = 8;        // int 0-18
	const PITCH_DECAY_INDEX = 10; // float 0-1
	const ROUTING_INDEX = 12;    // bool 0/1 — 0 = Mix, 1 = Insert

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

	let interval = $derived(fx.paramValue(INTERVAL_INDEX) ?? 0);
	let grid = $derived(fx.paramValue(GRID_INDEX) ?? 0);
	let triplets = $derived(Math.round(fx.paramValue(TRIPLETS_INDEX) ?? 0) === 0);
	let amount = $derived(fx.paramValue(AMOUNT_INDEX) ?? 0);
	let gate = $derived(fx.paramValue(GATE_INDEX) ?? 0);
	let pitchDecay = $derived(fx.paramValue(PITCH_DECAY_INDEX) ?? 0);
	// The switch NAMES its state rather than labelling a control that is
	// on or off: 0 is Mix, 1 is Insert, and there is no third reading, so
	// the caption is the value. Defaults to Insert (1) — that is how the
	// Variation preset ships, and a cold slot should read as the routing
	// you are about to get rather than one nothing ever wrote.
	let insertMode = $derived(Math.round(fx.paramValue(ROUTING_INDEX) ?? 1) === 1);
</script>

<div class="h-full w-full flex p-(--central-inset) relative" style="gap: var(--central-gap);" class:slot-ghost={fx.isGhost}>
	<!-- Interval (param 2) -->
	<div
		class="flex-1 flex flex-col min-h-0"
		style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}
	>
		<div class="var-head text-xs font-bold text-center opacity-70 pb-1">Interval</div>
		<div class="flex-1 flex flex-col gap-1 min-h-0">
			{#each INTERVAL_OPTIONS as option}
				<button
					class="physical-button var-btn flex-1 px-2 text-3xl font-bold flex items-center justify-center"
					class:active={Math.round(interval) === option.value}
					style="--btn-tint: {fxInk.primary};"
					onclick={() => fx.sendParam(INTERVAL_INDEX, option.value)}
				>
					{option.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Grid (param 4) -->
	<div
		class="flex-1 flex flex-col min-h-0"
		style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}
	>
		<div class="var-head text-xs font-bold text-center opacity-70 pb-1">Grid</div>
		<div class="flex-1 flex flex-col gap-1 min-h-0">
			{#each GRID_OPTIONS as option}
				<button
					class="physical-button var-btn flex-1 px-2 text-3xl font-bold flex items-center justify-center"
					class:active={Math.round(grid) === option.value}
					style="--btn-tint: {fxInk.primary};"
					onclick={() => fx.sendParam(GRID_INDEX, option.value)}
				>
					{option.label}
				</button>
			{/each}
			<!-- Random rides the Grid column's spare row: horizontal slider,
			     same width as the grid buttons. -->
			<div class="flex-1 min-h-0">
				<DeviceSlider
					value={amount / AMOUNT_MAX}
					title="Random"
					orientation="horizontal"
					labelOrientation="horizontal"
					isGhost={fx.isGhost}
					color={fxInk}
					onInteraction={(value) => fx.sendParam(AMOUNT_INDEX, Math.round(value * AMOUNT_MAX))}
				/>
			</div>
		</div>
	</div>

	<!-- Gate (param 8) -->
	<div
		class="flex-1 flex flex-col min-h-0"
		style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}
	>
		<div class="var-head text-xs font-bold text-center opacity-70 pb-1">Length</div>
		<div class="flex-1 flex flex-col gap-1 min-h-0">
			{#each GATE_OPTIONS as option}
				<button
					class="physical-button var-btn flex-1 px-2 text-3xl font-bold flex items-center justify-center"
					class:active={Math.round(gate) === option.value}
					style="--btn-tint: {fxInk.primary};"
					onclick={() => fx.sendParam(GATE_INDEX, option.value)}
				>
					{option.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- The three columns left of here pick musical divisions; the two right
	     of it say what the repeats sound like and where they go (2026-09-13). -->
	<SectionDivider orientation="vertical" />

	<!-- Pitch Decay (float 0-1) + triplets toggle -->
	<div
		class="flex-1 flex flex-col min-h-0"
		style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}
	>
		<div class="var-head text-xs font-bold text-center opacity-70 pb-1">Pitch Decay</div>
		<div class="flex-1 min-h-0">
			<DeviceSlider
				value={pitchDecay}
				orientation="vertical"
				labelOrientation="horizontal"
				isGhost={fx.isGhost}
				color={fxInk}
				onInteraction={(value) => fx.sendParam(PITCH_DECAY_INDEX, value)}
			/>
		</div>
	</div>

	<!-- Mode: routing switch (param 12) + triplets (param 5). The two split
	     the column evenly instead of riding the radio strips' 4-row rhythm —
	     a pair of switches on rows 1 and 2 with two empty rows under them
	     reads as a column that failed to fill, and these are the two biggest
	     finger targets in the view. -->
	<div
		class="flex-1 flex flex-col min-h-0"
		style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}
	>
		<div class="var-head text-xs font-bold text-center opacity-70 pb-1">Mode</div>
		<div class="flex-1 flex flex-col gap-1 min-h-0">
			<button
				class="physical-button var-btn flex-1 px-2 text-base font-bold flex items-center justify-center"
				class:active={insertMode}
				aria-pressed={insertMode}
				style="--btn-tint: {fxInk.primary};"
				onclick={() => fx.sendParam(ROUTING_INDEX, insertMode ? 0 : 1)}
			>
				{insertMode ? 'Insert' : 'Mix'}
			</button>
			<button
				class="physical-button var-btn flex-1 px-2 text-base font-bold flex items-center justify-center"
				class:active={triplets}
				style="--btn-tint: {fxInk.primary};"
				onclick={() => fx.sendParam(TRIPLETS_INDEX, triplets ? 1 : 0)}
			>
				Triplets
			</button>
		</div>
	</div>
</div>

<style>
	/* GRATICULE: column headers and button labels are authored mixed-case
	   ("Interval", "1 Bar", "Triplets") and up-cased here for the HUD voice. */
	.var-head,
	.var-btn {
		text-transform: uppercase;
	}

	/* ---- Live skin (flat grammar) ------------------------------------
	   The radio strips are shared .physical-button toggles (already flat
	   in app.css: OFF field / ON ChosenDefault). What this view adds on
	   top is Tailwind `font-bold` on every button and column header —
	   Live sets device text regular-to-medium, so under the flat grammar
	   the weight comes down, the headers become plain secondary text
	   (colour, not an opacity dim) and the labels keep their authored
	   mixed case. Nothing below applies outside [data-grammar="flat"]. */
	:global([data-grammar="flat"]) .var-head,
	:global([data-grammar="flat"]) .var-btn {
		text-transform: none;
	}
	:global([data-grammar="flat"]) .var-head {
		font-weight: var(--font-weight-medium);
		opacity: 1;
		color: var(--muted-foreground);
	}
	:global([data-grammar="flat"]) .physical-button {
		font-weight: var(--font-weight-medium);
	}
</style>
