<script lang="ts">
	/**
	 * GlitchCentralView — the Glitch tile's view (2026-10-15, the user's
	 * design): GlitchLoop.
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

	// GRATICULE §5.5: calibrate the device's ink at injection (hue preserved).
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

</div>

<style>
	.glitch-central-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
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

	/* ---- Live skin (flat grammar) ------------------------------------ */
	/* Live sets control text medium, keeps authored case, and does not
	   letterspace its section legends; headers are plain secondary text. */
	:global([data-grammar="flat"]) .group-title {
		font-weight: var(--font-weight-medium);
		letter-spacing: 0;
	}
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
