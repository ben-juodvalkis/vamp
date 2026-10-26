<script lang="ts">
	/**
	 * The Chorus's view (Live's Chorus-Ensemble, the `chorus` slot). One
	 * device per view since the FX chain overview took over from the grid
	 * (2026-10-26); until then this file drew the rest of the Chorus family
	 * (Blur, Comb, Phaser), each in a view of its own now.
	 *
	 *   [pad: Rate across, Dry/Wet up] [Mode] [Amount / Feedback] [Width / Warmth]
	 *
	 * The pad is the `chorus` control (deviceControls, ADR-479). Mode is one
	 * segmented tab (ADR-474), the rest value boxes (ADR-477), added at the
	 * user's call the same day. Indices, rails and labels measured on the rig
	 * (the Chorus-Ensemble preset loaded and dumped, 2026-10-26): 1 Mode 0..2
	 * Chorus / Ensemble / Vibrato, 4 Amount, 5 Feedback (99 % at 1), 12 Width
	 * (0..200 % on 0..1), 13 Warmth, all 0..1. A ghost draws Live's defaults;
	 * its first write loads it.
	 *
	 * NO {#if device} gate - every control handles its own ghost state.
	 */
	import ChorusControl from '$lib/components/v6/device-panel/ChorusControl.svelte';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { getSlotByDeviceType } from '$lib/config/fxGridLayout';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';

	const chorus = useFxGridSlot('chorus');

	// The Chorus keeps its layout entry (hidden from the grid) so its slot
	// still resolves by position.
	const chorusPosition = getSlotByDeviceType('chorus')!.position;

	let chorusInk = $derived({
		primary: trackInk(chorus.color.primary, paintModeReactive()),
		secondary: chorus.color.secondary,
		accent: trackInk(chorus.color.accent, paintModeReactive())
	});

	const MODE = 1;
	const MODES = ['Chorus', 'Ensemble', 'Vibrato'] as const;
	let mode = $derived(Math.round(chorus.paramValue(MODE) ?? 0));

	/** Index, title, and Live's value on a fresh Chorus-Ensemble. */
	const COLUMNS = [
		[
			{ index: 4, title: 'Amount', rest: 0.5 },
			{ index: 5, title: 'Feedback', rest: 0 }
		],
		[
			{ index: 12, title: 'Width', rest: 0.5 },
			{ index: 13, title: 'Warmth', rest: 0 }
		]
	] as const;
</script>

<div class="device-layout" data-view="chorus">
	<div class="cell" class:slot-ghost={chorus.isGhost}>
		<ChorusControl device={chorus.device} position={chorusPosition} />
	</div>

	<div
		class="cell device-segmented mode-tab"
		class:slot-ghost={chorus.isGhost}
		style="--btn-tint: {chorusInk.primary}; grid-template-rows: repeat({MODES.length}, 1fr);"
		role="radiogroup"
		aria-label="Mode"
	>
		{#each MODES as label, step (label)}
			<button
				class="device-segment mode-step"
				class:active={mode === step}
				role="radio"
				aria-checked={mode === step}
				onclick={() => chorus.sendParam(MODE, step)}
			>{label}</button>
		{/each}
	</div>

	{#each COLUMNS as column, c (c)}
		<div class="cell boxes" class:slot-ghost={chorus.isGhost}>
			{#each column as box (box.index)}
				<DeviceSlider
					value={chorus.paramValue(box.index) ?? box.rest}
					title={box.title}
					orientation="vertical"
					min={0}
					max={1}
					isGhost={chorus.isGhost}
					color={chorusInk}
					readout={chorus.paramDisplay(box.index)}
					onInteraction={(v) => chorus.sendParam(box.index, v)}
				/>
			{/each}
		</div>
	{/each}
</div>

<style>
	/* The pad two shares; the tab and the two box columns one each. */
	.device-layout {
		display: grid;
		grid-template-columns: minmax(0, 2fr) repeat(3, minmax(0, 1fr));
		gap: var(--central-gap);
		height: 100%;
		width: 100%;
		padding: var(--central-inset);
	}

	.cell {
		display: flex;
		flex-direction: column;
		gap: var(--central-gap);
		min-height: 0;
		min-width: 0;
	}

	.boxes > :global(*) {
		flex: 1 1 0;
		min-height: 0;
	}

	.mode-tab {
		display: grid;
		gap: 0;
	}

	.mode-step {
		min-height: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	/* Flat grammar: medium weight, and the device's own ink when chosen. */
	:global([data-grammar="flat"]) .mode-step {
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .mode-tab .device-segment.active {
		background: var(--btn-tint);
		border-color: var(--btn-tint);
		color: var(--flat-on-fg);
	}
	:global([data-grammar="flat"]) .mode-tab .device-segment:not(.active) {
		color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
	}
</style>
