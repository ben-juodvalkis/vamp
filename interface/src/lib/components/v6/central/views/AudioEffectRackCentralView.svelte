<script lang="ts">
	/**
	 * Audio Effect Rack Central View - Dynamic Macro Layout
	 *
	 * One slider per named macro; empty/unnamed macros are skipped.
	 */
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import { familyScheme, type DeviceColorScheme } from '$lib/config/devicePresets';
	import { buildMacroLayout, cleanParameterName, type ControlLayout } from '$lib/utils/macroLayoutUtils';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import DeviceEmptyState from '../DeviceEmptyState.svelte';

	// Import constants
	import constants from '$config/constants.json';

	interface Props {
		color?: DeviceColorScheme;
	}

	let { color }: Props = $props();

	// PR-3.5.5: path-keyed Audio Effect Rack — reads off the v3 tree
	// directly; preset swaps/track switches re-derive automatically.
	// Threads the DeviceRecord straight into paramPath() /
	// paramNamesForDevice() (both accept DeviceRecord as of PR-3.5.2a /
	// PR-3.5.4) without reopening the v2 lookup.
	const audioEffectRack = $derived(selectedTrackStore.audioEffectRackByPath);

	// Device configuration constants
	const MACRO_COUNT = constants.devices.audioEffectRack.macroCount;
	const MACRO_MIN = constants.devices.audioEffectRack.macroRange.min;
	const MACRO_MAX = constants.devices.audioEffectRack.macroRange.max;

	// Default color — rack theme (rackVoice rose, ADR-400; racks are rose
	// across InstrumentRack macros and this fx-rack view alike).
	const defaultColor: DeviceColorScheme = familyScheme('rackVoice');
	let rawColor = $derived(color || defaultColor);
	// GRATICULE (§5.5): calibrate primary + accent through trackInk at injection.
	let effectiveColor = $derived({
		primary: trackInk(rawColor.primary, paintModeReactive()),
		secondary: rawColor.secondary,
		accent: trackInk(rawColor.accent, paintModeReactive())
	});

	// Parameter state - single array for all macros
	let macroValues = $state(Array(MACRO_COUNT).fill(0));

	// PR-3.5.4: parameter names derived from the v3 store; preset swaps
	// re-run automatically.
	let parameterNames = $derived(
		audioEffectRack ? selectedTrackStore.paramNamesForDevice(audioEffectRack) : []
	);

	// Derived layout based on current parameter names (uses shared utility)
	const controlLayout = $derived<ControlLayout>(buildMacroLayout(parameterNames, 1, MACRO_COUNT));

	// Update all macro values in single effect
	$effect(() => {
		if (audioEffectRack) {
			macroValues = Array.from({ length: MACRO_COUNT }, (_, i) =>
				selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(audioEffectRack, i + 1)) ?? MACRO_MIN
			);
		} else {
			macroValues = Array(MACRO_COUNT).fill(MACRO_MIN);
		}
	});

	// Get normalized value (0-1) for a macro index (1-based)
	function getNormalizedValue(macroIndex: number): number {
		const value = macroValues[macroIndex - 1] ?? MACRO_MIN;
		return value / MACRO_MAX;
	}

	// Slider interaction handler (normalized 0-1 input, converts to 0-127)
	function handleSliderChange(paramIndex: number, normalizedValue: number) {
		if (audioEffectRack) {
			selectedTrackStore.setParamValue(
				selectedTrackStore.paramPath(audioEffectRack, paramIndex), normalizedValue * MACRO_MAX
			);
		}
	}

</script>

{#if audioEffectRack}
	<div class="audio-effect-rack-view" data-density="compact">
		<!-- Dynamic Controls -->
		{#if controlLayout.length > 0}
			<div class="controls-panel">
				{#each controlLayout as control}
					<div class="control-slot slider-slot">
						<DeviceSlider
							value={getNormalizedValue(control.macroIndex)}
							title={control.name}
							orientation="vertical"
							color={effectiveColor}
							onInteraction={(val) => handleSliderChange(control.macroIndex, val)}
						/>
					</div>
				{/each}
			</div>
		{:else}
			<!-- Fallback: show grid of all 16 macros when no named macros found -->
			<div class="macro-grid">
				{#each {length: MACRO_COUNT} as _, i}
					{@const paramIndex = i + 1}
					{@const macroValue = macroValues[i]}
					{@const paramName = parameterNames[paramIndex] ? cleanParameterName(parameterNames[paramIndex]) : `Macro ${paramIndex}`}
					<div class="macro-control">
						<DeviceSlider
							value={macroValue / MACRO_MAX}
							title={paramName}
							color={effectiveColor}
							onInteraction={(val) => handleSliderChange(paramIndex, val * MACRO_MAX)}
						/>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{:else}
	<DeviceEmptyState glyph="◌" message="No Audio Effect Rack detected" color={effectiveColor.primary} />
{/if}

<style>
	.audio-effect-rack-view {
		padding: var(--central-inset);
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--central-gap);
	}

	/* Dynamic controls layout */
	.controls-panel {
		flex: 1;
		display: flex;
		flex-direction: row;
		gap: var(--central-gap);
		min-height: 0;
		overflow: hidden;
	}

	.control-slot {
		display: flex;
		min-height: 0;
		min-width: 0;
		height: 100%;
		flex-shrink: 1;
	}

	.slider-slot {
		flex: 1 1 0;
		min-width: 40px;
	}


	/* Fallback grid layout for unnamed macros */
	.macro-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		grid-template-rows: repeat(4, 1fr);
		gap: var(--central-gap);
		flex: 1;
		height: 100%;
		min-height: 0;
	}

	.macro-control {
		display: flex;
		justify-content: center;
		align-items: stretch;
		min-height: 0;
		height: 100%;
	}

	.macro-control :global(.device-vertical-slider) {
		height: 100%;
		flex: 1;
	}

	/* Responsive grid for fallback */
	@media (max-width: 768px) {
		.macro-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	@media (max-width: 600px) {
		.macro-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
