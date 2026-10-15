<script lang="ts">
	/**
	 * PitchCentralView — the Pitch tile's view (2026-10-15, the user's
	 * design). The tile is the Octave's Mix and interval, so the view leaves
	 * those out (the user's call: no control that mirrors the XY) and is
	 * Pitch Hack's: Dry / Wet, Reverse, Recycle and Int Var on sliders, a
	 * Coarse column of intervals and the Rate column.
	 *
	 * Pitch Hack (Creative Extensions, Max), measured off the running Live
	 * with `owner/probes/device_dump.js` on 2026-10-15:
	 *   1 Cents     -99..99      (not drawn)
	 *   2 Dry / Wet   0..100 %
	 *   3 Coarse    -36..36 st
	 *   4 Level     -96..0 dB    (not drawn)
	 *   5 Rate        0..23, an index into its value_items:
	 *                 7 = 1/16, 10 = 1/8, 13 = 1/4, 16 = 1/2, 19 = 1/1
	 *   6 Recycle     0..95 %
	 *   7 Reverse     0..100 %
	 *   8 Int Var     0..24 st
	 *
	 * Self-contained: queries its own slot, takes no props, and renders
	 * through ghost/loading/active without a `{#if device}` gate.
	 */

	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import { drag } from '$lib/actions';
	import type { DragInfo } from '$lib/actions/drag';
	import { segmentIndex, scrubBoxOf, type ScrubBox } from '$lib/utils/segmentScrub';

	const pitchHack = useFxGridSlot('pitchHack');

	let ink = $derived({
		primary: trackInk(pitchHack.color.primary, paintModeReactive()),
		secondary: pitchHack.color.secondary,
		accent: trackInk(pitchHack.color.accent, paintModeReactive())
	});

	const PH = {
		mix: { index: 2, max: 100 },
		coarse: { index: 3 },
		rate: { index: 5 },
		recycle: { index: 6, max: 95 },
		reverse: { index: 7, max: 100 },
		intVar: { index: 8, max: 24 }
	};

	const SLIDERS = [
		{ title: 'Mix', icon: 'mix', ...PH.mix },
		{ title: 'Reverse', icon: undefined, ...PH.reverse },
		{ title: 'Recycle', icon: 'feedback', ...PH.recycle },
		{ title: 'Int Var', icon: 'dice', ...PH.intVar }
	] as const;

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

	// An unloaded slot draws 0: an empty slot adds nothing.
	const value = (index: number) => pitchHack.paramValue(index) ?? 0;

	// The lit step is the one the device matches exactly; a value set by
	// hand in Live lights none.
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

	// Both columns SCRUB, like the Octave's tab did: the stack owns one
	// pointer and resolves the step under it from geometry, so a finger
	// slides between steps. The box is measured at press, per column.
	const boxes = new Map<number, ScrubBox | null>();

	function scrub(index: number, values: number[], current: number, clientY: number) {
		const box = boxes.get(index);
		if (!box) return;
		const i = segmentIndex(clientY, box.top, box.height, values.length);
		if (i === current && !pitchHack.isGhost) return;
		send(index, values[i]);
	}

	function down(index: number, values: number[], current: number, info: DragInfo) {
		boxes.set(index, scrubBoxOf(info.event?.currentTarget as Element | null));
		scrub(index, values, current, info.y);
	}

	const coarseValues = COARSE_STEPS.map((s) => s.value);
	const rateValues = RATES.map((r) => r.rate);
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="pitch-central-layout relative" style="--btn-tint: {ink.primary};">
	{#each SLIDERS as s}
		<div class="device-wrapper" class:slot-ghost={pitchHack.isGhost}>
			<DeviceSlider
				value={value(s.index)}
				title={s.title}
				icon={s.icon}
				orientation="vertical"
				labelOrientation="horizontal"
				isGhost={pitchHack.isGhost}
				color={ink}
				min={0}
				max={s.max}
				onTap={() => pitchHack.loadIfGhost()}
				onInteraction={(v) => pitchHack.sendParam(s.index, Math.max(0, Math.min(s.max, v)))}
			/>
		</div>
	{/each}

	<!-- Coarse, +12 to -12 top to bottom. -->
	<div class="device-wrapper column">
		<span class="column-title" style="color: {ink.primary};">Coarse</span>
		<div
			class="device-segmented step-stack pitch-hack-coarse"
			class:is-ghost-tab={pitchHack.isGhost}
			style:grid-template-rows="repeat({COARSE_STEPS.length}, 1fr)"
			role="group"
			aria-label="Pitch Hack coarse"
			use:drag={{
				commit: 'immediate',
				onDown: (info) => down(PH.coarse.index, coarseValues, coarseStep, info),
				onMove: (info) => scrub(PH.coarse.index, coarseValues, coarseStep, info.y)
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
	<div class="device-wrapper column">
		<span class="column-title" style="color: {ink.primary};">Rate</span>
		<div
			class="device-segmented step-stack pitch-hack-rate"
			class:is-ghost-tab={pitchHack.isGhost}
			style:grid-template-rows="repeat({RATES.length}, 1fr)"
			role="group"
			aria-label="Pitch Hack rate"
			use:drag={{
				commit: 'immediate',
				onDown: (info) => down(PH.rate.index, rateValues, rateStop, info),
				onMove: (info) => scrub(PH.rate.index, rateValues, rateStop, info.y)
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
	.pitch-central-layout {
		display: grid;
		/* mix · reverse · recycle · int var · coarse · rate: one equal track
		   per control across the whole view, no seam (one device). */
		grid-template-columns: repeat(6, minmax(0, 1fr));
		height: 100%;
		width: 100%;
		padding: var(--central-inset);
		gap: var(--central-gap);
	}

	.device-wrapper {
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
