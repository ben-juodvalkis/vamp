<script lang="ts">
  import { press } from '$lib/actions/press';
	/**
	 * GlitchCentralView — the Glitch tile's view (2026-10-15, the user's
	 * design). GlitchLoop's Play page, mirrored: the preset bank, the loop
	 * macros and Drive × Space on four XY pads, two by two (Length × Reach,
	 * Tone × Repeats over Drive × Space, Drift × Chaos), then Clock, Duck and
	 * Glue. Mix is the Glitch tile's slider, so the
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
	 * pads, then Clock over Duck and Glue. It was compact (8px gaps) until
	 * then; it takes the house 16px now, so its seams match every other face.
	 *
	 * Since the Ink rollout (ADR-544):
	 * - A Mac with no glitchloop checkout has no bank (the route answers
	 *   404), and the Presets section is then not drawn: an empty frame stood
	 *   there. The face is 6 · 2, the pads over the bank's columns too.
	 * - A pad is named in its top corner, on one line, across × up
	 *   ("Length × Reach"). The two words stood stacked in the pad's middle,
	 *   where a macro at noon rests its dot.
	 * - Clock, Duck and Glue are three knobs of one size: Clock on top,
	 *   across the section, Duck and Glue side by side under it (Duck over
	 *   Glue at one size beside a larger Clock before).
	 * - One ink: the presets' words are labels and the lit one on's block.
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

	// The selected track's ink, as the slot's scheme hands it over (ADR-544).
	let glitchInk = $derived(glitchLoop.color);

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
	// A pad's name is what it moves across × what it moves up.
	const PADS = [
		{ title: 'Length × Reach', x: 'length', y: 'reach', col: 1, row: 1 },
		{ title: 'Tone × Repeats', x: 'tone', y: 'repeats', col: 2, row: 1 },
		{ title: 'Drive × Space', x: 'drive', y: 'space', col: 1, row: 2 },
		{ title: 'Drift × Chaos', x: 'drift', y: 'chaos', col: 2, row: 2 }
	] as const satisfies readonly { title: string; x: GlitchLoopParam; y: GlitchLoopParam; col: number; row: number }[];

	const NOON = 0.5;
	const fallbackOf = (key: GlitchLoopParam) => (key === 'chaos' || key === 'space' ? 0 : NOON);


	// ── Presets ────────────────────────────────────────────────────────────
	let presets = $state<GlitchLoopPresets | null>(null);
	/** A pad's width in face columns: two beside the bank, three where its columns are the pads'. */
	let padSpan = $derived(presets ? 2 : 3);

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

{#snippet knob(key: 'duck' | 'glue')}
	<div class="fx-box" class:slot-ghost={glitchLoop.isGhost}>
		<DeviceSlider
			value={unit(key, 0)}
			title={key === 'duck' ? 'Duck' : 'Glue'}
			face="knob"
			knobSize="m"
			knobCaptionBelow
			orientation="vertical"
			isGhost={glitchLoop.isGhost}
			color={glitchInk}
			min={0}
			max={1}
			readout={glitchLoop.paramDisplay(gIndex(key))}
			onTap={() => glitchLoop.loadIfGhost()}
			onInteraction={(t) => send(key, t)}
		/>
	</div>
{/snippet}

<!-- NO {#if device} gate - always render, handle ghost/loading states.
     One face grid (ADR-510), eight columns of ~108px at 1366 x 1024:
     Presets 2 · the four pads 4 (two by two) · Clock over Duck and Glue 2.
     With no bank to list the pads take its two columns too, 6 · 2, so the
     knobs stand where they do with one. -->
<div class="glitch-central-layout relative">
<FaceGrid sections={presets ? [2, 4, 2] : [6, 2]}>
	<!-- The preset bank, top to bottom in the device's order: one segmented tab. -->
	{#if presets}
		<FaceSection span={2}>
			{#snippet head()}<PanelEyebrow title="Presets" color={glitchInk.primary} />{/snippet}
			<div class="device-segmented seg-grid presets face-span-2" class:is-ghost-tab={glitchLoop.isGhost} role="group" aria-label="GlitchLoop presets">
				{#each presets.bank as name, i}
					<button
						class="device-segment preset-btn"
						class:active={!glitchLoop.isGhost && litPreset === i}
						aria-pressed={!glitchLoop.isGhost && litPreset === i}
						use:press={{ onPress: () => loadPreset(name) }}
					>{name}</button>
				{/each}
			</div>
		</FaceSection>
		<FaceSeam ink={glitchInk.primary} />
	{/if}

	<!-- The macros and Drive × Space, a pad each pair, two by two on the
	     face's columns. -->
	<FaceSection span={presets ? 4 : 6}>
		{#snippet head()}<PanelEyebrow title="Macros" color={glitchInk.primary} />{/snippet}
		<div class="pads face-span-all">
			{#each PADS as pad}
				<div class="pad" style:grid-column="{(pad.col - 1) * padSpan + 1} / span {padSpan}" style:grid-row={pad.row} class:slot-ghost={glitchLoop.isGhost}>
					<DeviceXY
						xValue={unit(pad.x, fallbackOf(pad.x))}
						yValue={unit(pad.y, fallbackOf(pad.y))}
						title={pad.title}
						titleClass="pad-corner"
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
		{#snippet head()}<PanelEyebrow title="Clock · Glue" color={glitchInk.primary} />{/snippet}
		<!-- Three knobs of one size (ADR-544): Clock, in its detents, on top
		     across the section; Duck and Glue side by side under it, two
		     controls, not a pair on one pad. Medium: two rows of captioned
		     96px knobs need 272px and the band has 226. -->
		<div class="knobs face-span-2">
			<div class="fx-box clock" class:slot-ghost={glitchLoop.isGhost}>
				<DeviceSlider
					value={clockUnit}
					title="Clock"
					face="knob"
					knobSize="m"
					knobCaptionBelow
					orientation="vertical"
					isGhost={glitchLoop.isGhost}
					color={glitchInk}
					min={0}
					max={1}
					readout={glitchLoop.paramDisplay(gIndex('clock'))}
					onTap={() => glitchLoop.loadIfGhost()}
					onInteraction={(t) => sendClock(t)}
				/>
			</div>
			{@render knob('duck')}
			{@render knob('glue')}
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

	/* A pad's name in its top corner, one line at a tab's size, clear of a
	   dot resting at noon or on the floor (DeviceXY's own place for it is
	   the pad's middle, at a size that broke two words over two lines). */
	.pad :global(.center-title.pad-corner) {
		top: 0.5rem;
		left: 0.75rem;
		right: 0.75rem;
		transform: none;
		align-items: flex-start;
		font-size: 1rem;
		line-height: 1.15;
		white-space: nowrap;
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

	/* A preset's name is a label and the lit one on's block, by app.css's
	   own law (ADR-544): the view passes no tint. */
	.preset-btn {
		min-height: 0;
		padding: 0 0.375rem;
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.1;
		white-space: normal;
	}

	.pad,
	.fx-box {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	/* Clock across the top, Duck and Glue under it: two equal rows on the
	   section's two columns. */
	.knobs {
		display: grid;
		grid-template-columns: subgrid;
		grid-template-rows: repeat(2, minmax(0, 1fr));
		row-gap: var(--face-gutter);
		min-height: 0;
	}
	.clock {
		grid-column: 1 / -1;
	}

	.is-ghost-tab {
		opacity: var(--opacity-ghost);
	}

	/* ---- Flat grammar: control text medium, in its authored case. */
	:global([data-grammar="flat"]) .preset-btn {
		font-weight: var(--font-weight-medium);
	}
</style>
