<script lang="ts">
	/**
	 * GlitchCentralView — the Glitch tile's view (2026-10-15, the user's
	 * design). Two devices, a seam between them:
	 *
	 *   GlitchLoop  Dry/Wet · Feedback · the Up/Spread/Off pitch column,
	 *               which lived in the Chorus view until today. Resolved by
	 *               parameter NAME (`glitchLoopParams.ts`).
	 *   Variation   (Beat Repeat) the Var slider that was its FX-grid tile
	 *               (Chance, param 1), then what was VariationCentralView:
	 *               Interval (param 2), Grid (param 4) with the Random amount
	 *               (param 6) on its spare row, Length (param 8), a seam,
	 *               Pitch Decay (param 10), and Mode — the routing switch
	 *               (param 12) over Triplets (param 5).
	 *
	 * The Variation's radio strips expose only the musically useful values
	 * of each int param; the device still accepts their full ranges.
	 * Triplets is a Grid parameter but stays in Mode, past the seam, so the
	 * Grid column keeps its four-row rhythm (2026-09-13).
	 *
	 * Self-contained: queries its own slots, takes no props, and renders
	 * through ghost/loading/active without a `{#if device}` gate.
	 */

	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import SectionDivider from '$lib/components/v6/central/SectionDivider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import {
		GLITCH_LOOP_PARAMS,
		GLITCH_PITCH_MODES,
		glitchLoopIndex,
		type GlitchLoopParam
	} from '$lib/components/v6/device-panel/glitchLoopParams';

	const glitchLoop = useFxGridSlot('glitchLoop');
	const variation = useFxGridSlot('variation');

	// GRATICULE §5.5: calibrate each device's ink at injection (hue preserved).
	let glitchInk = $derived({
		primary: trackInk(glitchLoop.color.primary, paintModeReactive()),
		secondary: glitchLoop.color.secondary,
		accent: trackInk(glitchLoop.color.accent, paintModeReactive())
	});
	let varInk = $derived({
		primary: trackInk(variation.color.primary, paintModeReactive()),
		secondary: variation.color.secondary,
		accent: trackInk(variation.color.accent, paintModeReactive())
	});

	// ── GlitchLoop ─────────────────────────────────────────────────────────
	let glitchNames = $derived(glitchLoop.device ? selectedTrackStore.paramNamesForDevice(glitchLoop.device) : []);
	const gIndex = (key: GlitchLoopParam) => glitchLoopIndex(glitchNames, key);
	const gValue = (key: GlitchLoopParam) => glitchLoop.paramValue(gIndex(key));

	// An unloaded slot draws 0, the user's call (2026-10-06): an empty slot
	// adds nothing.
	let glitchMix = $derived(gValue('mix') ?? 0);
	let glitchFeedback = $derived(gValue('feedbackLeft') ?? 0);
	let glitchPitchLeft = $derived(Math.round(gValue('pitchLeft') ?? 0));
	let glitchPitchRight = $derived(Math.round(gValue('pitchRight') ?? 0));
	// The lit mode is the one both values match exactly; a pitch set by hand
	// in Live lights none.
	let glitchPitchMode = $derived(
		GLITCH_PITCH_MODES.findIndex((m) => m.left === glitchPitchLeft && m.right === glitchPitchRight)
	);

	function sendGlitchMix(amount: number) {
		glitchLoop.sendParam(gIndex('mix'), Math.max(0, Math.min(GLITCH_LOOP_PARAMS.mix.max, amount)));
	}

	// Both channels, so the slider is the loop's feedback rather than its
	// left side's (the old device's slider wrote Feedback L alone).
	function sendGlitchFeedback(amount: number) {
		const value = Math.max(0, Math.min(GLITCH_LOOP_PARAMS.feedbackLeft.max, amount));
		glitchLoop.sendParam(gIndex('feedbackLeft'), value);
		glitchLoop.sendParam(gIndex('feedbackRight'), value);
	}

	function sendGlitchPitchMode(mode: (typeof GLITCH_PITCH_MODES)[number]) {
		glitchLoop.sendParam(gIndex('pitchLeft'), mode.left);
		glitchLoop.sendParam(gIndex('pitchRight'), mode.right);
	}

	// ── Variation (Beat Repeat) ────────────────────────────────────────────
	const CHANCE_INDEX = 1;       // float 0-1, the grid tile's slider
	const INTERVAL_INDEX = 2;     // int 0-7
	const GRID_INDEX = 4;         // int 0-15
	const TRIPLETS_INDEX = 5;     // bool 0/1
	const AMOUNT_INDEX = 6;       // int 0-10
	const GATE_INDEX = 8;         // int 0-18
	const PITCH_DECAY_INDEX = 10; // float 0-1
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
	let pitchDecay = $derived(variation.paramValue(PITCH_DECAY_INDEX) ?? 0);
	// The switch NAMES its state rather than labelling a control that is on
	// or off: 0 is Mix, 1 is Insert, and there is no third reading, so the
	// caption is the value. Reads Insert (1) until the device's own value
	// arrives.
	let insertMode = $derived(Math.round(variation.paramValue(ROUTING_INDEX) ?? 1) === 1);
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="glitch-central-layout relative">
	<!-- ===== GlitchLoop ===== -->
	<section class="group" style="--panel-ink: {glitchInk.primary};">
		<div class="group-title text-xs font-bold tracking-wider">GlitchLoop</div>
		<div class="glitch-body" class:slot-ghost={glitchLoop.isGhost}>
			<div class="device-wrapper">
				<DeviceSlider
					value={glitchMix}
					title="Mix"
					icon="mix"
					orientation="vertical"
					labelOrientation="horizontal"
					isGhost={glitchLoop.isGhost}
					color={glitchInk}
					min={0}
					max={GLITCH_LOOP_PARAMS.mix.max}
					onTap={() => glitchLoop.loadIfGhost()}
					onInteraction={sendGlitchMix}
				/>
			</div>
			<div class="device-wrapper">
				<DeviceSlider
					value={glitchFeedback}
					title="Feedback"
					icon="feedback"
					orientation="vertical"
					labelOrientation="horizontal"
					isGhost={glitchLoop.isGhost}
					color={glitchInk}
					min={0}
					max={GLITCH_LOOP_PARAMS.feedbackLeft.max}
					onTap={() => glitchLoop.loadIfGhost()}
					onInteraction={sendGlitchFeedback}
				/>
			</div>
			<div
				class="device-segmented glitch-pitch"
				style:grid-template-rows="repeat({GLITCH_PITCH_MODES.length}, 1fr)"
				style="--btn-tint: {glitchInk.primary};"
				role="group"
				aria-label="GlitchLoop pitch"
			>
				{#each GLITCH_PITCH_MODES as mode, i}
					<button
						class="device-segment text-sm font-medium"
						class:active={!glitchLoop.isGhost && glitchPitchMode === i}
						aria-label="GlitchLoop pitch {mode.label}"
						aria-pressed={!glitchLoop.isGhost && glitchPitchMode === i}
						onclick={() => (glitchLoop.isGhost ? glitchLoop.loadIfGhost() : sendGlitchPitchMode(mode))}
					>{mode.label}</button>
				{/each}
			</div>
		</div>
	</section>

	<SectionDivider orientation="vertical" ink={varInk.primary} />

	<!-- ===== Variation (Beat Repeat) ===== -->
	<section class="group" style="--panel-ink: {varInk.primary};">
		<div class="group-title text-xs font-bold tracking-wider">Variation</div>
		<div class="var-body" class:slot-ghost={variation.isGhost}>
			<!-- Var: the grid tile's slider, Chance. The first drag loads the device. -->
			<div class="device-wrapper">
				<DeviceSlider
					value={chance}
					title="Var"
					orientation="vertical"
					labelOrientation="horizontal"
					isGhost={variation.isGhost}
					color={varInk}
					min={0}
					max={1}
					onTap={() => variation.loadIfGhost()}
					onInteraction={(value) => variation.sendParam(CHANCE_INDEX, value)}
				/>
			</div>

			<!-- Interval (param 2) -->
			<div class="var-col">
				<div class="var-head text-xs font-bold text-center opacity-70 pb-1">Interval</div>
				<div class="var-stack">
					{#each INTERVAL_OPTIONS as option}
						<button
							class="physical-button var-btn flex-1 px-2 text-2xl font-bold flex items-center justify-center"
							class:active={Math.round(interval) === option.value}
							style="--btn-tint: {varInk.primary};"
							onclick={() => variation.sendParam(INTERVAL_INDEX, option.value)}
						>{option.label}</button>
					{/each}
				</div>
			</div>

			<!-- Grid (param 4), the Random amount (param 6) on its spare row -->
			<div class="var-col">
				<div class="var-head text-xs font-bold text-center opacity-70 pb-1">Grid</div>
				<div class="var-stack">
					{#each GRID_OPTIONS as option}
						<button
							class="physical-button var-btn flex-1 px-2 text-2xl font-bold flex items-center justify-center"
							class:active={Math.round(grid) === option.value}
							style="--btn-tint: {varInk.primary};"
							onclick={() => variation.sendParam(GRID_INDEX, option.value)}
						>{option.label}</button>
					{/each}
					<div class="flex-1 min-h-0">
						<DeviceSlider
							value={amount / AMOUNT_MAX}
							title="Random"
							orientation="horizontal"
							labelOrientation="horizontal"
							labelSize="small"
							isGhost={variation.isGhost}
							color={varInk}
							onInteraction={(value) => variation.sendParam(AMOUNT_INDEX, Math.round(value * AMOUNT_MAX))}
						/>
					</div>
				</div>
			</div>

			<!-- Length (param 8) -->
			<div class="var-col">
				<div class="var-head text-xs font-bold text-center opacity-70 pb-1">Length</div>
				<div class="var-stack">
					{#each GATE_OPTIONS as option}
						<button
							class="physical-button var-btn flex-1 px-2 text-2xl font-bold flex items-center justify-center"
							class:active={Math.round(gate) === option.value}
							style="--btn-tint: {varInk.primary};"
							onclick={() => variation.sendParam(GATE_INDEX, option.value)}
						>{option.label}</button>
					{/each}
				</div>
			</div>

			<!-- The division pickers left of here; what the repeats sound like
			     and where they go right of it (2026-09-13). -->
			<SectionDivider orientation="vertical" />

			<!-- Pitch Decay (float 0-1) -->
			<div class="var-col">
				<div class="var-head text-xs font-bold text-center opacity-70 pb-1">Pitch Decay</div>
				<div class="flex-1 min-h-0">
					<DeviceSlider
						value={pitchDecay}
						icon="pitchdrop"
						orientation="vertical"
						labelOrientation="horizontal"
						isGhost={variation.isGhost}
						color={varInk}
						onInteraction={(value) => variation.sendParam(PITCH_DECAY_INDEX, value)}
					/>
				</div>
			</div>

			<!-- Mode: routing switch (param 12) over triplets (param 5), the
			     column split evenly between the two. -->
			<div class="var-col">
				<div class="var-head text-xs font-bold text-center opacity-70 pb-1">Mode</div>
				<div class="var-stack">
					<button
						class="physical-button var-btn flex-1 px-2 text-base font-bold flex items-center justify-center"
						class:active={insertMode}
						aria-pressed={insertMode}
						style="--btn-tint: {varInk.primary};"
						onclick={() => variation.sendParam(ROUTING_INDEX, insertMode ? 0 : 1)}
					>{insertMode ? 'Insert' : 'Mix'}</button>
					<button
						class="physical-button var-btn flex-1 px-2 text-base font-bold flex items-center justify-center"
						class:active={triplets}
						style="--btn-tint: {varInk.primary};"
						onclick={() => variation.sendParam(TRIPLETS_INDEX, triplets ? 1 : 0)}
					>Triplets</button>
				</div>
			</div>
		</div>
	</section>
</div>

<style>
	.glitch-central-layout {
		display: grid;
		/* glitchloop (mix · feedback · pitch) | seam | variation (var ·
		   interval · grid · length | seam | pitch decay · mode). One equal
		   track per control, so a slider here is a slider anywhere. */
		grid-template-columns: minmax(0, 3fr) auto minmax(0, 6fr);
		height: 100%;
		width: 100%;
		padding: var(--central-inset);
		gap: var(--central-gap);
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		min-width: 0;
		min-height: 0;
	}

	/* Centred over the group it names, in that device's ink. */
	.group-title {
		flex-shrink: 0;
		text-align: center;
		color: var(--panel-ink);
	}

	.glitch-body,
	.var-body {
		flex: 1;
		min-height: 0;
		min-width: 0;
		display: grid;
		gap: var(--central-gap);
	}

	.glitch-body {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.var-body {
		grid-template-columns: repeat(4, minmax(0, 1fr)) auto repeat(2, minmax(0, 1fr));
	}

	.device-wrapper,
	.var-col {
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

	/* The house segmented control upright, like Octave's pitch column. */
	.glitch-pitch {
		display: grid;
		min-height: 0;
		min-width: 0;
	}

	/* GRATICULE: column headers and button labels are authored mixed-case
	   and up-cased here for the HUD voice. */
	.var-head,
	.var-btn {
		text-transform: uppercase;
	}

	/* ---- Live skin (flat grammar) ------------------------------------ */
	/* One ink per device: a lit mode takes GlitchLoop's own ink rather than
	   the house --phosphor, as Octave's column does. */
	:global([data-grammar="flat"]) .glitch-pitch .device-segment.active {
		background: var(--btn-tint);
		border-color: var(--btn-tint);
		color: var(--flat-on-fg);
	}
	/* Live sets control text medium, keeps authored case, and does not
	   letterspace its section legends; headers are plain secondary text. */
	:global([data-grammar="flat"]) .group-title {
		font-weight: var(--font-weight-medium);
		letter-spacing: 0;
	}
	:global([data-grammar="flat"]) .var-head,
	:global([data-grammar="flat"]) .var-btn {
		text-transform: none;
	}
	:global([data-grammar="flat"]) .var-head {
		font-weight: var(--font-weight-medium);
		opacity: 1;
		color: var(--muted-foreground);
	}
	:global([data-grammar="flat"]) .var-body .physical-button {
		font-weight: var(--font-weight-medium);
	}
</style>
