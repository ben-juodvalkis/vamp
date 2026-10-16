<script lang="ts">
	/**
	 * GlitchCentralView — the Glitch tile's view (2026-10-15, the user's
	 * design). Two devices, a seam between them:
	 *
	 *   GlitchLoop  its Play page, mirrored: the preset bank, the loop
	 *               macros and Drive × Space on four XY pads, two by two
	 *               (Length × Reach, Tone × Repeats over Drive × Space,
	 *               Drift × Chaos), and Duck and Glue on full-height
	 *               sliders. Clock and Mix are the Glitch
	 *               tile's axes, so the view leaves them out, and there is
	 *               no Freeze or Mod Hold (the user's calls). Pairs
	 *               agreed with the glitchloop side: what one hand moves
	 *               together; Duck and Glue stay apart. A bipolar macro's
	 *               noon is the pad's middle, "as the preset set it".
	 *   Variation   (Beat Repeat) the Var slider (Chance, param 1) and its
	 *               controls: Interval (2), Grid (4) with the Random amount
	 *               (6) on its spare row, Length (8), and
	 *               Mode, the routing switch (12) over Triplets (5). Pitch
	 *               Decay (10) is not drawn (the user's call, 2026-10-15).
	 *
	 * GlitchLoop's parameters resolve by name (`glitchLoopParams.ts`). Its
	 * presets are not parameters (the device keeps them out of Live's undo
	 * and storage), so the bank comes from glitchloop's own generated file
	 * (`GET /api/glitchloop/presets`) and a press writes the preset's
	 * values by name in one undo step (`sendParamsByName`). The lit preset
	 * is the one the device's values match.
	 *
	 * Self-contained: queries its own slots, takes no props, and renders
	 * through ghost/loading/active without a `{#if device}` gate.
	 */

	import { onMount } from 'svelte';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
	import SectionDivider from '$lib/components/v6/central/SectionDivider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { sendParamsByName } from '$lib/services/deviceParams';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import { logger } from '$lib/utils/logger';
	import {
		glitchLoopIndex,
		toUnit,
		fromUnit,
		matchingPreset,
		type GlitchLoopParam,
		type GlitchLoopPresets
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
	let names = $derived(glitchLoop.device ? selectedTrackStore.paramNamesForDevice(glitchLoop.device) : []);
	const gIndex = (key: GlitchLoopParam) => glitchLoopIndex(names, key);
	// An unloaded slot draws a macro at noon and an amount at 0: what a
	// fresh device holds.
	const unit = (key: GlitchLoopParam, fallback: number) => {
		const v = glitchLoop.paramValue(gIndex(key));
		return v === undefined ? fallback : toUnit(key, v);
	};
	const send = (key: GlitchLoopParam, t: number) => glitchLoop.sendParam(gIndex(key), fromUnit(key, t));

	// Two by two: the loop on top, Drive × Space and Drift × Chaos under it.
	const PADS = [
		{ title: 'Length Reach', x: 'length', y: 'reach', col: 2, row: 1 },
		{ title: 'Tone Repeats', x: 'tone', y: 'repeats', col: 4, row: 1 },
		{ title: 'Drive Space', x: 'drive', y: 'space', col: 2, row: 2 },
		{ title: 'Drift Chaos', x: 'drift', y: 'chaos', col: 4, row: 2 }
	] as const satisfies readonly { title: string; x: GlitchLoopParam; y: GlitchLoopParam; col: number; row: number }[];

	const NOON = 0.5;
	const fallbackOf = (key: GlitchLoopParam) => (key === 'chaos' || key === 'space' ? 0 : NOON);


	// ── Presets ────────────────────────────────────────────────────────────
	let presets = $state<GlitchLoopPresets | null>(null);

	onMount(() => {
		fetch('/api/glitchloop/presets')
			.then((r) => (r.ok ? r.json() : null))
			.then((body) => {
				if (body && Array.isArray(body.bank) && body.presets) presets = body as GlitchLoopPresets;
			})
			.catch((error) => logger.warn('GlitchLoop presets unavailable', { component: 'GlitchCentralView', error }));
	});

	let litPreset = $derived.by(() => {
		const device = glitchLoop.device;
		if (!presets || !device) return -1;
		const byName = new Map<string, number>();
		names.forEach((n, i) => {
			if (!byName.has(n)) byName.set(n, i);
		});
		return matchingPreset(presets, (name) => {
			const i = byName.get(name);
			if (i === undefined) return undefined;
			const value = glitchLoop.paramValue(i);
			const range = selectedTrackStore.paramRange(selectedTrackStore.paramPath(device, i));
			return value === undefined || !range ? undefined : { value, ...range };
		});
	});

	function loadPreset(name: string) {
		const path = glitchLoop.devicePath;
		if (!presets || !path) {
			glitchLoop.loadIfGhost();
			return;
		}
		sendParamsByName(path, presets.presets[name]);
	}

	// ── Variation (Beat Repeat) ────────────────────────────────────────────
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
<div class="glitch-central-layout relative" data-density="compact">
	<!-- ===== GlitchLoop ===== -->
	<section class="group" style="--panel-ink: {glitchInk.primary}; --btn-tint: {glitchInk.primary};">
		<div class="group-title text-xs font-bold tracking-wider">GlitchLoop</div>
		<div class="glitch-body">
			<!-- The preset bank, top to bottom in the device's order. -->
			<div class="presets" class:is-ghost-tab={glitchLoop.isGhost} role="group" aria-label="GlitchLoop presets">
				{#if presets}
					{#each presets.bank as name, i}
						<button
							class="physical-button preset-btn"
							class:active={!glitchLoop.isGhost && litPreset === i}
							aria-pressed={!glitchLoop.isGhost && litPreset === i}
							onclick={() => loadPreset(name)}
						>{name}</button>
					{/each}
				{/if}
			</div>

			<!-- The macros and Drive × Space, a pad each pair. -->
			{#each PADS as pad}
				<div class="pad" style:grid-column="{pad.col} / span 2" style:grid-row={pad.row} class:slot-ghost={glitchLoop.isGhost}>
					<DeviceXY
						xValue={unit(pad.x, fallbackOf(pad.x))}
						yValue={unit(pad.y, fallbackOf(pad.y))}
						title={pad.title}
						isGhost={glitchLoop.isGhost}
						showCurve={false}
						color={glitchInk}
						onTap={() => glitchLoop.loadIfGhost()}
						onInteraction={(x, y) => {
							send(pad.x, x);
							send(pad.y, y);
						}}
					/>
				</div>
			{/each}

			<!-- Duck and Glue, full height. -->
			{#each [{ key: 'duck', title: 'Duck', col: 6 }, { key: 'glue', title: 'Glue', col: 7 }] as const as s}
				<div class="fx-slider" style:grid-column={s.col} class:slot-ghost={glitchLoop.isGhost}>
					<DeviceSlider
						value={unit(s.key, 0)}
						title={s.title}
						orientation="vertical"
						labelOrientation="horizontal"
						labelSize="small"
						isGhost={glitchLoop.isGhost}
						color={glitchInk}
						min={0}
						max={1}
						onTap={() => glitchLoop.loadIfGhost()}
						onInteraction={(t) => send(s.key, t)}
					/>
				</div>
			{/each}
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

			<div class="var-col">
				<div class="var-head text-xs font-bold text-center opacity-70 pb-1">Interval</div>
				<div class="var-stack">
					{#each INTERVAL_OPTIONS as option}
						<button
							class="physical-button var-btn"
							class:active={Math.round(interval) === option.value}
							style="--btn-tint: {varInk.primary};"
							onclick={() => variation.sendParam(INTERVAL_INDEX, option.value)}
						>{option.label}</button>
					{/each}
				</div>
			</div>

			<div class="var-col">
				<div class="var-head text-xs font-bold text-center opacity-70 pb-1">Grid</div>
				<div class="var-stack">
					{#each GRID_OPTIONS as option}
						<button
							class="physical-button var-btn"
							class:active={Math.round(grid) === option.value}
							style="--btn-tint: {varInk.primary};"
							onclick={() => variation.sendParam(GRID_INDEX, option.value)}
						>{option.label}</button>
					{/each}
					<div class="flex-1 min-h-0">
						<DeviceSlider
							value={amount / AMOUNT_MAX}
							title="Rnd"
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

			<div class="var-col">
				<div class="var-head text-xs font-bold text-center opacity-70 pb-1">Length</div>
				<div class="var-stack">
					{#each GATE_OPTIONS as option}
						<button
							class="physical-button var-btn"
							class:active={Math.round(gate) === option.value}
							style="--btn-tint: {varInk.primary};"
							onclick={() => variation.sendParam(GATE_INDEX, option.value)}
						>{option.label}</button>
					{/each}
				</div>
			</div>

			<div class="var-col">
				<div class="var-head text-xs font-bold text-center opacity-70 pb-1">Mode</div>
				<div class="var-stack">
					<button
						class="physical-button var-btn"
						class:active={insertMode}
						aria-pressed={insertMode}
						style="--btn-tint: {varInk.primary};"
						onclick={() => variation.sendParam(ROUTING_INDEX, insertMode ? 0 : 1)}
					>{insertMode ? 'Insert' : 'Mix'}</button>
					<button
						class="physical-button var-btn"
						class:active={triplets}
						style="--btn-tint: {varInk.primary};"
						onclick={() => variation.sendParam(TRIPLETS_INDEX, triplets ? 1 : 0)}
					>Trip</button>
				</div>
			</div>
		</div>
	</section>
</div>

<style>
	.glitch-central-layout {
		display: grid;
		/* glitchloop | seam | variation. GlitchLoop's seven and a half
		   tracks to the Variation's five, one equal track per control. */
		grid-template-columns: minmax(0, 7.6fr) auto minmax(0, 5fr);
		height: 100%;
		width: 100%;
		padding: var(--central-inset);
		gap: var(--central-gap);
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		min-width: 0;
		min-height: 0;
	}

	/* Centred over the group it names, in that device's ink. */
	.group-title {
		flex-shrink: 0;
		text-align: center;
		color: var(--panel-ink);
	}

	/* presets · four pads two by two (two tracks each) · Duck · Glue,
	   over two rows. */
	.glitch-body {
		flex: 1;
		min-height: 0;
		min-width: 0;
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) repeat(6, minmax(0, 1fr));
		grid-template-rows: repeat(2, minmax(0, 1fr));
		gap: var(--central-gap);
	}

	.presets {
		grid-column: 1;
		grid-row: 1 / span 2;
		display: grid;
		grid-auto-rows: minmax(0, 1fr);
		gap: 0.25rem;
		min-height: 0;
	}

	.preset-btn {
		min-height: 0;
		padding: 0 0.375rem;
		font-size: 0.8125rem;
		font-weight: 600;
		line-height: 1.1;
		white-space: normal;
	}

	.pad,
	.fx-slider {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.fx-slider {
		grid-row: 1 / span 2;
	}

	.is-ghost-tab {
		opacity: var(--opacity-ghost);
	}

	.var-body {
		flex: 1;
		min-height: 0;
		min-width: 0;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: var(--central-gap);
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

	.var-btn {
		flex: 1;
		min-height: 0;
		padding: 0 0.25rem;
		font-size: 1rem;
		font-weight: 700;
	}

	/* GRATICULE: column headers and button labels are authored mixed-case
	   and up-cased here for the HUD voice. */
	.var-head,
	.var-btn {
		text-transform: uppercase;
	}

	/* ---- Live skin (flat grammar) ------------------------------------ */
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
	:global([data-grammar="flat"]) .preset-btn,
	:global([data-grammar="flat"]) .var-body .physical-button {
		font-weight: var(--font-weight-medium);
	}
	/* The presets wear GlitchLoop's ink as its pads' titles do (user,
	   2026-10-15): the name in the device ink, the lit one filled with it,
	   as the Pitch Hack columns light a step, rather than the house
	   --phosphor. */
	:global([data-skin="hybrid"]) .preset-btn {
		color: var(--btn-tint);
	}
	:global(.light[data-skin="hybrid"]) .preset-btn {
		color: color-mix(in oklab, var(--btn-tint) 55%, var(--foreground));
	}
	:global([data-grammar="flat"]) .preset-btn.active {
		background: var(--btn-tint);
		border-color: var(--btn-tint);
		color: var(--flat-on-fg);
	}
	/* Variation's tabs wear the Var slider's ink the same way (user,
	   2026-10-15). */
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
