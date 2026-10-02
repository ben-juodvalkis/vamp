<script lang="ts">
	/**
	 * AutoFilterCentralView - Slot-Aware Version
	 *
	 * Self-contained central view that queries its own slot state.
	 * Renders immediately with ghost/loading/active states.
	 * Uses filter type buttons, XY pad, and sliders.
	 *
	 * NO {#if device} gate - always renders, handles its own state.
	 * NO props required - queries selectedTrackStore directly.
	 */

	import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import SectionDivider from '../SectionDivider.svelte';

	const fx = useFxGridSlot('filter');

	// Match the purple used by the LFO shape buttons (purple-600 / purple-300)
	const LFO_COLOR = {
		primary: 'rgb(168, 85, 247)',
		secondary: 'rgba(168, 85, 247, 0.1)',
		accent: 'rgb(216, 180, 254)'
	};

	// GRATICULE (§2.4 / §5.5): normalize the device + LFO palettes through trackInk
	// at injection — hue preserved, luminance/chroma calibrated. secondary (the
	// alpha wash) is left untouched. fx.color is normalized too since the slot
	// config may override the fallback we passed above.
	let fxInk = $derived({
		primary: trackInk(fx.color.primary, paintModeReactive()),
		secondary: fx.color.secondary,
		accent: trackInk(fx.color.accent, paintModeReactive())
	});
	let lfoInk = $derived({
		primary: trackInk(LFO_COLOR.primary, paintModeReactive()),
		secondary: LFO_COLOR.secondary,
		accent: trackInk(LFO_COLOR.accent, paintModeReactive())
	});

	// Initial UI state before the first param echo lands. These four used to
	// be looked up in data/device-configs.json with these same numbers as the
	// `?? fallback`; the config carried no value for LFO Amount and carried
	// exactly these for the other three, so the lookup only ever returned the
	// fallback. Literals say what the values are without the indirection.
	const LFO_AMOUNT_DEFAULT = 0;
	const LFO_TIME_DEFAULT = 0.2;
	const LFO_SYNC_DEFAULT = 1;
	const MORPH_DEFAULT = 0.5;
	const FILTER_TYPE_DEFAULT = 0;  // LP
	const SLOPE_DEFAULT = 0;  // 12dB
	const LFO_SHAPE_DEFAULT = 0;  // Sine
	const DRIVE_DEFAULT = 0;  // No drive
	const CIRCUIT_DEFAULT = 0;  // SVF

	// Drive index 8, Output index 34 (verified against Auto Filter.adv's
	// automatable-param order, which maps to LOM index - 1; Output is
	// 0..1, default 1). Drive adds gain as it saturates, so the slider
	// pulls Output down with it — full drive lands the output at 0.25,
	// which keeps the level roughly where it started.
	const DRIVE_INDEX = 8;
	const OUTPUT_INDEX = 34;
	const OUTPUT_AT_FULL_DRIVE = 0.25;

	/** Output trim that compensates a given drive amount: 1 → 0.25, linear. */
	function outputForDrive(driveValue: number): number {
		const d = Math.min(Math.max(driveValue, 0), 1);
		return 1 - d * (1 - OUTPUT_AT_FULL_DRIVE);
	}

	// Dry/Wet index 36, 0..1, ships fully wet. Read off the running device
	// (2026-09-14), because AutoFilter2 nests a sidechain element, the thing
	// that shifts a flat .adv scan on Compressor2. Live lists the sidechain's
	// own On / Gain / Mix last (42-44), so 36 is Dry/Wet in both.
	const MIX_INDEX = 36;
	const MIX_DEFAULT = 1;

	const FILTER_TYPES = [
		{ value: 0, label: 'LP' },
		{ value: 1, label: 'HP' },
		{ value: 2, label: 'BP' },
		{ value: 3, label: 'Notch' },
		{ value: 4, label: 'Morph' },
		{ value: 5, label: 'DJ' },
		{ value: 6, label: 'Vowel' },
		{ value: 7, label: 'Comb' },
		{ value: 8, label: 'Resamp' },
		{ value: 9, label: 'SV' }
	];

	const LFO_SHAPE_OPTIONS = [
		{ value: 0, label: 'Sine', symbol: '∿' },
		{ value: 1, label: 'Triangle', symbol: '△' },
		{ value: 2, label: 'Saw', symbol: '⋰' },
		{ value: 3, label: 'Square', symbol: '⊓' },
		{ value: 4, label: 'Ramp Up', symbol: '⟋' },
		{ value: 5, label: 'Ramp Down', symbol: '⟍' },
		{ value: 6, label: 'Random', symbol: '※' },
		{ value: 7, label: 'S&H', symbol: 'S&H' }
	];

	const CIRCUIT_OPTIONS = [
		{ value: 0, label: 'SVF' },
		{ value: 1, label: 'DFM' },
		{ value: 2, label: 'SV2' },
		{ value: 3, label: 'PRD' }
	];

	let lfoAmount = $derived(fx.paramValue(12) ?? LFO_AMOUNT_DEFAULT);
	let lfoTime = $derived(fx.paramValue(16) ?? LFO_TIME_DEFAULT);
	let filterType = $derived(fx.paramValue(4) ?? FILTER_TYPE_DEFAULT);
	let slope = $derived(fx.paramValue(5) ?? SLOPE_DEFAULT);
	let lfoSync = $derived(fx.paramValue(14) ?? LFO_SYNC_DEFAULT);
	let morphAmount = $derived(fx.paramValue(23) ?? MORPH_DEFAULT);
	let lfoShape = $derived(fx.paramValue(13) ?? LFO_SHAPE_DEFAULT);
	let drive = $derived(fx.paramValue(DRIVE_INDEX) ?? DRIVE_DEFAULT);
	let circuit = $derived(fx.paramValue(7) ?? CIRCUIT_DEFAULT);
	let mix = $derived(fx.paramValue(MIX_INDEX) ?? MIX_DEFAULT);

	// LFO X-axis display string from Live's GUI formatter. When the
	// Time/Sync toggle is in "Sync" mode (lfoSync >= 3) the active
	// X-axis param is the integer rate (param 18, "1/16" .. "1/4");
	// in "Time" mode it's the continuous time/freq (param 16, "Hz" or
	// seconds). `paramDisplay()` returns undefined until the user has
	// dragged the relevant param at least once — that's the surface's
	// hot-path discipline. We don't synthesize a fallback string
	// because mirroring Live's exact formatting curves locally would
	// drift; an empty title suffix when idle is the honest UX.
	let lfoXDisplay = $derived(
		lfoSync >= 3 ? fx.paramDisplay(18) : fx.paramDisplay(16)
	);
	let lfoTitle = $derived(lfoXDisplay ? `LFO · ${lfoXDisplay}` : 'LFO');

	function selectFilterType(typeValue: number) {
		fx.sendParam(4, typeValue);
	}

	function toggleSlope() {
		fx.sendParam(5, slope > 0.5 ? 0 : 1);
	}

	function toggleLfoSync() {
		fx.sendParam(14, lfoSync >= 3 ? 1 : 5);
	}
</script>

<!--
	10-column flex layout: each column = flex-[1], LFO XY spans 2.
	  shp1:1 | shp2:1 | morph+sync:1 | LFO XY:2 | flt1:1 | flt2:1 | drive:1 | circuit+slope:1 | mix:1
	A `SectionDivider` sits between the LFO group (cols 1-4) and the rest.
-->
<div class="h-full w-full flex min-h-0 p-(--central-inset) relative" style="gap: var(--central-gap);" class:slot-ghost={fx.isGhost}>
	<!-- Col 1 — LFO shapes 1-4 (vertical stack) -->
	<div
		class="flex-[1] min-h-0 flex flex-col gap-1"
		style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}
	>
		{#each LFO_SHAPE_OPTIONS.slice(0, 4) as option}
			<button
				class="physical-button flex-1 px-1 text-3xl text-center flex items-center justify-center"
				class:active={lfoShape === option.value}
				style="--btn-tint: {lfoInk.primary};"
				onclick={() => {
					fx.sendParam(13, option.value);
				}}
				title={option.label}
			>
				{option.symbol}
			</button>
		{/each}
	</div>

	<!-- Col 2 — LFO shapes 5-8 (vertical stack) -->
	<div
		class="flex-[1] min-h-0 flex flex-col gap-1"
		style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}
	>
		{#each LFO_SHAPE_OPTIONS.slice(4, 8) as option}
			<button
				class="physical-button flex-1 px-1 text-3xl text-center flex items-center justify-center"
				class:active={lfoShape === option.value}
				style="--btn-tint: {lfoInk.primary};"
				onclick={() => {
					fx.sendParam(13, option.value);
				}}
				title={option.label}
			>
				{option.symbol}
			</button>
		{/each}
	</div>

	<!-- Col 3 — vertical MORPH slider -->
	<div
		class="flex-[1] min-h-0"
		style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}
	>
		<DeviceSlider
			value={morphAmount}
			title="Morph"
			orientation="vertical"
			labelOrientation="horizontal"
			isGhost={fx.isGhost}
			color={lfoInk}
			onInteraction={(value) => {
				fx.sendParam(23, value);
			}}
		/>
	</div>

	<!-- Cols 4-5 — LFO XY pad (double width) with floating Time/Sync toggle -->
	<div class="flex-[2] min-h-0 relative">
		<DeviceXY
			xValue={1 - lfoTime}
			yValue={lfoAmount}
			title={lfoTitle}
			isGhost={fx.isGhost}
			showCurve={false}
			color={lfoInk}
			onInteraction={(x, y) => {
				// LFO Time parameter (continuous)
				fx.sendParam(16, 1 - x); // LFO Time - inverted

				// LFO Rate/Division parameter (integer 4-16)
				// X=0 (left) → value 16, X=1 (right) → value 4
				const lfoRate = Math.round(16 - (x * 12)); // Maps X from 0-1 to 16-4
				fx.sendParam(18, lfoRate); // LFO Rate as integer

				// LFO Amount
				fx.sendParam(12, y); // LFO Amount
			}}
		/>
		<!-- Floating Time/Sync toggle, nudged inward from the XY pad's top-right corner -->
		<button
			class="physical-button lfo-sync-toggle absolute z-10 text-xs font-medium flex items-center justify-center"
			class:active={lfoSync >= 3}
			style="--btn-tint: {lfoInk.primary}; width: 44px; height: 44px; top: -8px; right: -8px; border-radius: var(--lfo-toggle-radius, 9999px);"
			onclick={toggleLfoSync}
			title={lfoSync >= 3 ? 'Sync' : 'Time'}
		>
			{lfoSync >= 3 ? 'Sync' : 'Time'}
		</button>
	</div>

	<!-- Divider between LFO controls and the rest. This view had the
	     interface's first hand-rolled seam; since 2026-09-13 it is the shared
	     `SectionDivider` every other central view uses, and it names what
	     follows it. -->
	<SectionDivider orientation="vertical" ink={fxInk.primary} />

	<!-- Col 6 — Filter types 1-5 (vertical stack) -->
	<div
		class="flex-[1] min-h-0 flex flex-col gap-1"
		style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}
	>
		{#each FILTER_TYPES.slice(0, 5) as type}
			<button
				class="physical-button flex-1 px-3 text-sm text-center flex items-center justify-center"
				class:active={filterType === type.value}
				style="--btn-tint: {fxInk.primary};"
				onclick={() => selectFilterType(type.value)}
			>
				{type.label}
			</button>
		{/each}
	</div>

	<!-- Col 7 — Filter types 6-10 (vertical stack) -->
	<div
		class="flex-[1] min-h-0 flex flex-col gap-1"
		style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}
	>
		{#each FILTER_TYPES.slice(5, 10) as type}
			<button
				class="physical-button flex-1 px-3 text-sm text-center flex items-center justify-center"
				class:active={filterType === type.value}
				style="--btn-tint: {fxInk.primary};"
				onclick={() => selectFilterType(type.value)}
			>
				{type.label}
			</button>
		{/each}
	</div>

	<!-- Col 8 — Drive vertical slider -->
	<div class="flex-[1] h-full" style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
		<DeviceSlider
			value={drive}
			title="Drive"
			orientation="vertical"
			labelOrientation="horizontal"
			isGhost={fx.isGhost}
			color={fxInk}
			onInteraction={(value) => {
				fx.sendParam(DRIVE_INDEX, value);
				fx.sendParam(OUTPUT_INDEX, outputForDrive(value));
			}}
		/>
	</div>

	<!-- Col 9 — Circuit buttons + Slope toggle -->
	<div
		class="flex-[1] h-full flex flex-col gap-1"
		style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}
	>
		{#each CIRCUIT_OPTIONS as option}
			<button
				class="physical-button flex-1 px-1 text-sm text-center font-medium flex items-center justify-center"
				class:active={circuit === option.value}
				style="--btn-tint: {fxInk.primary};"
				onclick={() => {
					fx.sendParam(7, option.value);
				}}
				title={option.label}
			>
				{option.label}
			</button>
		{/each}
		<!-- Slope Toggle (12/24 dB) -->
		<button
			class="physical-button num flex-1 px-1 text-sm text-center flex items-center justify-center"
			class:active={slope > 0.5}
			style="--btn-tint: {fxInk.primary};"
			onclick={toggleSlope}
			title="Filter Slope"
		>
			{slope > 0.5 ? '24' : '12'}
		</button>
	</div>

	<!-- Col 10 — Mix (Dry/Wet). Last because it is the device's last stage:
	     Live's own panel ends on Output, Soft Clip and Dry/Wet. -->
	<div class="flex-[1] h-full" style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
		<DeviceSlider
			value={mix}
			title="Mix"
			orientation="vertical"
			labelOrientation="horizontal"
			isGhost={fx.isGhost}
			color={fxInk}
			onInteraction={(value) => {
				fx.sendParam(MIX_INDEX, value);
			}}
		/>
	</div>

</div>

<style>
	/* ---- Live skin (flat grammar): every AutoFilter control is already a
	   flat field — the shape / type / circuit / slope buttons are
	   .physical-button (app.css gives them the ControlBackground field and
	   ChosenDefault ON fill), MORPH / DRIVE are DeviceSlider and the LFO pad
	   is DeviceXY (both flat, both re-case their own titles). The one
	   hold-out is the floating Time/Sync pill: its 9999px radius is inline,
	   so it is lifted into --lfo-toggle-radius (Graticule fallback 9999px —
	   unchanged) and squared here. Every rule sits under
	   [data-grammar="flat"]; Graticule is untouched. */
	:global([data-grammar="flat"]) .lfo-sync-toggle {
		--lfo-toggle-radius: 2px;
	}

	/* The `absolute` utility alone loses: app.css's `.physical-button {
	   position: relative }` is unlayered and Tailwind's utilities live in a
	   layer, so the toggle was drawn IN FLOW — under the LFO pad and 20px
	   past the frame's bottom edge, clipped (measured by the tour's layout
	   check, 2026-09-14). A scoped rule outranks both. */
	.lfo-sync-toggle {
		position: absolute;
	}
</style>