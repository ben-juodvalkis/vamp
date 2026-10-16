<script lang="ts">
	/**
	 * PitchGroup — the Pitch family inside the Auto Pan view (2026-10-15,
	 * the user's call). The Octave, the grid's Pitch tile until then, is
	 * two controls here rather than an XY too narrow to play: its interval
	 * as a column of the tile's four stops and its Mix on a slider. Then,
	 * past a seam, Pitch Hack's Dry / Wet on a slider, a Coarse column of
	 * intervals and the Rate column. Reverse, Recycle and Int Var are not
	 * drawn (the user's call, same day).
	 *
	 * A browser load lands at the END of the chain and an octave pedal
	 * belongs at its head, so an Octave gesture that may load arms the
	 * one-shot move the tile armed (`useBassChainPosition`).
	 *
	 * Its root is `display: contents`, so every control and seam is a grid
	 * item of AutoPanCentralView, which owns the tracks.
	 *
	 * Pitch Hack (Creative Extensions, Max), measured off the running Live
	 * with `owner/probes/device_dump.js` on 2026-10-15:
	 *   1 Cents     -99..99      (not drawn)
	 *   2 Dry / Wet   0..100 %
	 *   3 Coarse    -36..36 st
	 *   4 Level     -96..0 dB    (not drawn)
	 *   5 Rate        0..23, an index into its value_items:
	 *                 7 = 1/16, 10 = 1/8, 13 = 1/4, 16 = 1/2, 19 = 1/1
	 *   6 Recycle     0..95 %    (not drawn)
	 *   7 Reverse     0..100 %   (not drawn)
	 *   8 Int Var     0..24 st   (not drawn)
	 *
	 * Self-contained: queries its own slots, takes no props, and renders
	 * through ghost/loading/active without a `{#if device}` gate.
	 */

	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import { useFxGridSlot, type FxGridSlotHandle } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { useBassChainPosition } from '$lib/components/v6/central/useBassChainPosition.svelte';
	import {
		OCTAVE_PITCH_PARAM,
		OCTAVE_MIX_PARAM,
		OCTAVE_MIX_MAX,
		OCTAVE_PITCH_STEPS
	} from '$lib/components/v6/device-panel/octaveParams';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import { drag } from '$lib/actions';
	import type { DragInfo } from '$lib/actions/drag';
	import { segmentIndex, scrubBoxOf, type ScrubBox } from '$lib/utils/segmentScrub';
	import SectionDivider from '../../SectionDivider.svelte';

	const octave = useFxGridSlot('octave');
	const pitchHack = useFxGridSlot('pitchHack');

	const octaveChain = useBassChainPosition(octave, 'PitchGroup');

	let octaveInk = $derived({
		primary: trackInk(octave.color.primary, paintModeReactive()),
		secondary: octave.color.secondary,
		accent: trackInk(octave.color.accent, paintModeReactive())
	});
	let ink = $derived({
		primary: trackInk(pitchHack.color.primary, paintModeReactive()),
		secondary: pitchHack.color.secondary,
		accent: trackInk(pitchHack.color.accent, paintModeReactive())
	});

	const PH = {
		mix: { index: 2, max: 100 },
		coarse: { index: 3 },
		rate: { index: 5 }
	};

	// Top to bottom, the Octave's order with unison in the middle.
	const COARSE_STEPS = [
		{ label: '+12', value: 12 },
		{ label: '+7', value: 7 },
		{ label: '0', value: 0 },
		{ label: '-5', value: -5 },
		{ label: '-12', value: -12 }
	];

	const RATES = [
		{ label: '1', rate: 19 },
		{ label: '1/2', rate: 16 },
		{ label: '1/4', rate: 13 },
		{ label: '1/8', rate: 10 },
		{ label: '1/16', rate: 7 }
	];

	// The lit step is the one the device matches exactly; a value set by
	// hand in Live lights none.
	let intervalStep = $derived.by(() => {
		const v = octave.paramValue(OCTAVE_PITCH_PARAM);
		return v === undefined ? -1 : OCTAVE_PITCH_STEPS.findIndex((s) => s.value === Math.round(v));
	});
	let coarseStep = $derived.by(() => {
		const v = pitchHack.paramValue(PH.coarse.index);
		return v === undefined ? -1 : COARSE_STEPS.findIndex((s) => s.value === Math.round(v));
	});
	let rateStop = $derived.by(() => {
		const v = pitchHack.paramValue(PH.rate.index);
		return v === undefined ? -1 : RATES.findIndex((r) => r.rate === Math.round(v));
	});

	// A step that loads the device also puts Dry / Wet at full, so the
	// device is heard once touched (user, 2026-10-08). On a loaded device
	// the Mix slider owns Dry / Wet and a step leaves it alone.
	function send(index: number, v: number) {
		if (pitchHack.isGhost) pitchHack.sendParam(PH.mix.index, PH.mix.max);
		pitchHack.sendParam(index, v);
	}

	// The Octave the same way, at its Mix of 50: dry and shifted both at
	// full level, so the interval is heard over the dry signal.
	const OCTAVE_LOAD_MIX = 50;
	function sendOctave(index: number, v: number) {
		if (octave.isGhost) {
			octaveChain.arm();
			if (index !== OCTAVE_MIX_PARAM) octave.sendParam(OCTAVE_MIX_PARAM, OCTAVE_LOAD_MIX);
		}
		octave.sendParam(index, v);
	}

	// Both columns SCRUB, like the Octave's tab did: the stack owns one
	// pointer and resolves the step under it from geometry, so a finger
	// slides between steps. The box is measured at press, per column.
	// Keyed by column name: the Octave's and Pitch Hack's params share indices.
	const boxes = new Map<string, ScrubBox | null>();

	interface Column {
		key: string;
		slot: FxGridSlotHandle;
		index: number;
		values: number[];
		write: (index: number, v: number) => void;
	}

	function scrub(c: Column, current: number, clientY: number) {
		const box = boxes.get(c.key);
		if (!box) return;
		const i = segmentIndex(clientY, box.top, box.height, c.values.length);
		if (i === current && !c.slot.isGhost) return;
		c.write(c.index, c.values[i]);
	}

	function down(c: Column, current: number, info: DragInfo) {
		boxes.set(c.key, scrubBoxOf(info.event?.currentTarget as Element | null));
		scrub(c, current, info.y);
	}

	const INTERVAL: Column = {
		key: 'interval', slot: octave, index: OCTAVE_PITCH_PARAM,
		values: OCTAVE_PITCH_STEPS.map((s) => s.value), write: sendOctave
	};
	const COARSE: Column = {
		key: 'coarse', slot: pitchHack, index: PH.coarse.index,
		values: COARSE_STEPS.map((s) => s.value), write: send
	};
	const RATE: Column = {
		key: 'rate', slot: pitchHack, index: PH.rate.index,
		values: RATES.map((r) => r.rate), write: send
	};

</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="pitch-group" style="--btn-tint: {ink.primary};">
	<SectionDivider orientation="vertical" ink={octaveInk.primary} />

	<!-- The Octave: its interval, +12 to -12 top to bottom, the grid tile's
	     four stops. -->
	<div class="cell column" style="--btn-tint: {octaveInk.primary};">
		<span class="column-title" style="color: {octaveInk.primary};">Octave</span>
		<div
			class="device-segmented step-stack octave-interval"
			class:is-ghost-tab={octave.isGhost}
			style:grid-template-rows="repeat({OCTAVE_PITCH_STEPS.length}, 1fr)"
			role="group"
			aria-label="Octave interval"
			use:drag={{
				commit: 'immediate',
				onDown: (info) => down(INTERVAL, intervalStep, info),
				onMove: (info) => scrub(INTERVAL, intervalStep, info.y)
			}}
		>
			{#each OCTAVE_PITCH_STEPS as step, i}
				<button
					class="device-segment step num"
					class:active={!octave.isGhost && intervalStep === i}
					aria-label="Octave interval {step.label}"
					aria-pressed={!octave.isGhost && intervalStep === i}
					onclick={() => sendOctave(OCTAVE_PITCH_PARAM, step.value)}
				>{step.label}</button>
			{/each}
		</div>
	</div>

	<div class="cell octave-mix" class:slot-ghost={octave.isGhost}>
		<DeviceSlider
			value={octave.paramValue(OCTAVE_MIX_PARAM) ?? 0}
			title="Mix"
			icon="mix"
			orientation="vertical"
			labelOrientation="horizontal"
			isGhost={octave.isGhost}
			color={octaveInk}
			min={0}
			max={OCTAVE_MIX_MAX}
			onTap={() => {
				if (!octave.isGhost) return;
				octaveChain.arm();
				octave.loadIfGhost();
			}}
			onInteraction={(v) => sendOctave(OCTAVE_MIX_PARAM, Math.max(0, Math.min(OCTAVE_MIX_MAX, v)))}
		/>
	</div>

	<SectionDivider orientation="vertical" ink={ink.primary} />

	<!-- Pitch Hack. -->
	<div class="cell pitch-hack-mix" class:slot-ghost={pitchHack.isGhost}>
		<DeviceSlider
			value={pitchHack.paramValue(PH.mix.index) ?? 0}
			title="Mix"
			icon="mix"
			orientation="vertical"
			labelOrientation="horizontal"
			isGhost={pitchHack.isGhost}
			color={ink}
			min={0}
			max={PH.mix.max}
			onTap={() => pitchHack.loadIfGhost()}
			onInteraction={(v) => pitchHack.sendParam(PH.mix.index, Math.max(0, Math.min(PH.mix.max, v)))}
		/>
	</div>

	<!-- Coarse, +12 to -12 top to bottom. -->
	<div class="cell column">
		<span class="column-title" style="color: {ink.primary};">Coarse</span>
		<div
			class="device-segmented step-stack pitch-hack-coarse"
			class:is-ghost-tab={pitchHack.isGhost}
			style:grid-template-rows="repeat({COARSE_STEPS.length}, 1fr)"
			role="group"
			aria-label="Pitch Hack coarse"
			use:drag={{
				commit: 'immediate',
				onDown: (info) => down(COARSE, coarseStep, info),
				onMove: (info) => scrub(COARSE, coarseStep, info.y)
			}}
		>
			{#each COARSE_STEPS as step, i}
				<button
					class="device-segment step num"
					class:active={!pitchHack.isGhost && coarseStep === i}
					aria-label="Pitch Hack coarse {step.label}"
					aria-pressed={!pitchHack.isGhost && coarseStep === i}
					onclick={() => send(PH.coarse.index, step.value)}
				>{step.label}</button>
			{/each}
		</div>
	</div>

	<!-- Rate, 1 to 1/16 top to bottom. -->
	<div class="cell column">
		<span class="column-title" style="color: {ink.primary};">Rate</span>
		<div
			class="device-segmented step-stack pitch-hack-rate"
			class:is-ghost-tab={pitchHack.isGhost}
			style:grid-template-rows="repeat({RATES.length}, 1fr)"
			role="group"
			aria-label="Pitch Hack rate"
			use:drag={{
				commit: 'immediate',
				onDown: (info) => down(RATE, rateStop, info),
				onMove: (info) => scrub(RATE, rateStop, info.y)
			}}
		>
			{#each RATES as stop, i}
				<button
					class="device-segment step num"
					class:active={!pitchHack.isGhost && rateStop === i}
					aria-label="Pitch Hack rate {stop.label}"
					aria-pressed={!pitchHack.isGhost && rateStop === i}
					onclick={() => send(PH.rate.index, stop.rate)}
				>{stop.label}</button>
			{/each}
		</div>
	</div>
</div>

<style>
	.pitch-group {
		display: contents;
	}

	.cell {
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
	}

	.column {
		gap: var(--spacing-sm);
	}

	/* The house eyebrow. */
	.column-title {
		flex: 0 0 auto;
		min-height: 1rem;
		font-size: 0.75rem;
		letter-spacing: 0.05em;
		font-weight: 700;
		text-align: center;
	}

	:global([data-grammar="flat"]) .column-title {
		text-transform: none;
		letter-spacing: normal;
	}

	.step-stack {
		flex: 1 1 0;
		min-height: 0;
		min-width: 0;
		display: grid;
	}

	/* The stack owns the pointer; the steps are its face. Keyboard focus
	   and Enter still activate one. */
	.step {
		pointer-events: none;
		min-height: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	.is-ghost-tab {
		opacity: var(--opacity-ghost);
	}

	/* One ink per device: a lit step takes Pitch Hack's own ink rather than
	   the house --phosphor. */
	:global([data-grammar="flat"]) .step-stack .device-segment.active {
		background: var(--btn-tint);
		border-color: var(--btn-tint);
		color: var(--flat-on-fg);
	}
</style>
