<script lang="ts">
  import { press } from '$lib/actions/press';
	/**
	 * GlitchCentralView — the Glitch tile's view (2026-10-15, the user's
	 * design). GlitchLoop's Play page, mirrored: the preset bank, the loop
	 * macros and Drive × Space on four XY pads, two by two (Length × Reach,
	 * Tone × Repeats over Drive × Space, Drift × Chaos), Duck over Glue as
	 * two value boxes and Clock at full height (ADR-477). Mix is the Glitch
	 * tile's slider, so the
	 * view leaves it out, and there is no Freeze or Mod Hold (the user's
	 * calls). Pairs agreed with the glitchloop side: what one hand moves
	 * together; Duck and Glue stay apart. A bipolar macro's noon is the
	 * pad's middle, "as the preset set it". Pitch Hack (titled Reverse) sat
	 * past a seam from 2026-10-24 until the FX chain overview gave every
	 * device a view of its own (2026-10-26); it is `ReverseCentralView` now.
	 *
	 * GlitchLoop's parameters resolve by name (`glitchLoopParams.ts`). Its
	 * presets are not parameters (the device keeps them out of Live's undo
	 * and storage), so the bank comes from glitchloop's own generated file
	 * (`GET /api/glitchloop/presets`) and a press writes the preset's
	 * values by name in one undo step (`sendParamsByName`). The lit preset
	 * is the one the device's values match.
	 *
	 * The Variation (Beat Repeat) was this view's other half until
	 * 2026-10-24, then a `part` of it; it is `VariationCentralView` now, its
	 * own file (the user's call, the same day).
	 *
	 * The face is one grid (ADR-510), sections 2 · 4 · 2: Presets, the four
	 * pads, Duck over Glue beside Clock. It was compact (8px gaps) until
	 * then; it takes the house 16px now, so its seams match every other face.
	 *
	 * Self-contained: queries its own slots and renders through
	 * ghost/loading/active without a `{#if device}` gate.
	 */

	import { onMount } from 'svelte';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
	import FaceGrid from '$lib/components/v6/central/FaceGrid.svelte';
	import FaceSection from '$lib/components/v6/central/FaceSection.svelte';
	import FaceSeam from '$lib/components/v6/central/FaceSeam.svelte';
	import PanelEyebrow from './panel/PanelEyebrow.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { sendParamsByName } from '$lib/services/deviceParams';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import { logger } from '$lib/utils/logger';
	import {
		GLITCH_LOOP_PARAMS,
		glitchLoopIndex,
		toUnit,
		fromUnit,
		matchingPreset,
		type GlitchLoopParam,
		type GlitchLoopPresets
	} from '$lib/components/v6/device-panel/glitchLoopParams';

	const glitchLoop = useFxGridSlot('glitchLoop');

	// GRATICULE §5.5: calibrate each device's ink at injection (hue preserved).
	let glitchInk = $derived({
		primary: trackInk(glitchLoop.color.primary, paintModeReactive()),
		secondary: glitchLoop.color.secondary,
		accent: trackInk(glitchLoop.color.accent, paintModeReactive())
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

	// Clock, the coupled pitch / length / fidelity macro, in its eleven
	// detents: the old Glitch XY's X (2026-10-24). A fresh device holds the
	// middle detent.
	const CLOCK = GLITCH_LOOP_PARAMS.clock;
	let clockUnit = $derived(((glitchLoop.paramValue(gIndex('clock')) ?? 5) - CLOCK.min) / (CLOCK.max - CLOCK.min));
	function sendClock(t: number) {
		const v = Math.round(Math.min(1, Math.max(0, t)) * (CLOCK.max - CLOCK.min)) + CLOCK.min;
		if (glitchLoop.isGhost || v !== Math.round(glitchLoop.paramValue(gIndex('clock')) ?? -1)) {
			glitchLoop.sendParam(gIndex('clock'), v);
		}
	}

	// Two by two: the loop on top, Drive × Space and Drift × Chaos under it.
	const PADS = [
		{ title: 'Length Reach', x: 'length', y: 'reach', col: 1, row: 1 },
		{ title: 'Tone Repeats', x: 'tone', y: 'repeats', col: 3, row: 1 },
		{ title: 'Drive Space', x: 'drive', y: 'space', col: 1, row: 2 },
		{ title: 'Drift Chaos', x: 'drift', y: 'chaos', col: 3, row: 2 }
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
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states.
     One face grid (ADR-510), eight columns of ~108px at 1366 x 1024:
     Presets 2 · the four pads 4 (two by two) · Duck over Glue, and Clock 2. -->
<div class="glitch-central-layout relative" style="--panel-ink: {glitchInk.primary}; --btn-tint: {glitchInk.primary};">
<FaceGrid sections={[2, 4, 2]}>
	<!-- The preset bank, top to bottom in the device's order: one segmented tab. -->
	<FaceSection span={2}>
		{#snippet head()}<PanelEyebrow title="Presets" color={glitchInk.primary} />{/snippet}
		<div class="device-segmented seg-grid presets face-span-2" class:is-ghost-tab={glitchLoop.isGhost} role="group" aria-label="GlitchLoop presets">
			{#if presets}
				{#each presets.bank as name, i}
					<button
						class="device-segment preset-btn"
						class:active={!glitchLoop.isGhost && litPreset === i}
						aria-pressed={!glitchLoop.isGhost && litPreset === i}
						use:press={{ onPress: () => loadPreset(name) }}
					>{name}</button>
				{/each}
			{/if}
		</div>
	</FaceSection>
	<FaceSeam ink={glitchInk.primary} />

	<!-- The macros and Drive × Space, a pad each pair, two by two on the
	     face's columns. -->
	<FaceSection span={4}>
		{#snippet head()}<PanelEyebrow title="GlitchLoop" color={glitchInk.primary} />{/snippet}
		<div class="pads face-span-all">
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
		</div>
	</FaceSection>
	<FaceSeam ink={glitchInk.primary} />

	<FaceSection span={2}>
		{#snippet head()}<PanelEyebrow title="Glue · Clock" color={glitchInk.primary} />{/snippet}
		<!-- Duck over Glue, two knobs in one column (ADR-509): two
		     controls, not a pair on one pad. Medium: two captioned 96px
		     knobs need 316px and the band has 263. -->
		<div class="knob-pair">
			{#each [{ key: 'duck', title: 'Duck' }, { key: 'glue', title: 'Glue' }] as const as s}
				<div class="fx-box" class:slot-ghost={glitchLoop.isGhost}>
					<DeviceSlider
						value={unit(s.key, 0)}
						title={s.title}
						face="knob"
						knobSize="m"
						orientation="vertical"
						labelSize="small"
						isGhost={glitchLoop.isGhost}
						color={glitchInk}
						min={0}
						max={1}
						readout={glitchLoop.paramDisplay(gIndex(s.key))}
						onTap={() => glitchLoop.loadIfGhost()}
						onInteraction={(t) => send(s.key, t)}
					/>
				</div>
			{/each}
		</div>

		<!-- Clock, full height, in its detents: one large knob. -->
		<div class="fx-slider" class:slot-ghost={glitchLoop.isGhost}>
			<DeviceSlider
				value={clockUnit}
				title="Clock"
				face="knob"
				knobSize="l"
				orientation="vertical"
				labelSize="small"
				isGhost={glitchLoop.isGhost}
				color={glitchInk}
				min={0}
				max={1}
				readout={glitchLoop.paramDisplay(gIndex('clock'))}
				onTap={() => glitchLoop.loadIfGhost()}
				onInteraction={(t) => sendClock(t)}
			/>
		</div>
	</FaceSection>
</FaceGrid>
</div>

<style>
	/* The face is the FaceGrid (ADR-510). */
	.glitch-central-layout {
		height: 100%;
		width: 100%;
		min-height: 0;
	}

	/* The four pads two by two, on the section's own columns (subgrid), two
	   equal rows with the face's gutter between. */
	.pads {
		display: grid;
		grid-template-columns: subgrid;
		grid-template-rows: repeat(2, minmax(0, 1fr));
		row-gap: var(--face-gutter);
		min-height: 0;
	}

	/* Two columns of three, filled down then across, so the bank still
	   reads in the device's order (2026-10-24, the user's call; one column
	   of six before). One segmented tab, as the Reverse column and Drift's
	   choosers are: an outer frame, hairlines between, the lit one filled. */
	.presets {
		display: grid;
		grid-template-rows: repeat(3, minmax(0, 1fr));
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
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
	.fx-slider,
	.fx-box {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.knob-pair {
		display: flex;
		flex-direction: column;
		gap: var(--face-gutter);
		min-height: 0;
	}
	.fx-box {
		flex: 1 1 0;
	}

	.is-ghost-tab {
		opacity: var(--opacity-ghost);
	}

	/* ---- Live skin (flat grammar) ------------------------------------ */
	/* Live sets control text medium and keeps authored case. */
	:global([data-grammar="flat"]) .preset-btn {
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
</style>
