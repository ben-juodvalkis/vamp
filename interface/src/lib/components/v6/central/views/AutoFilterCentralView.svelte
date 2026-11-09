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

	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import LfoGraph from '../LfoGraph.svelte';
	import type { PanelParams } from './panel/usePanelParams.svelte';
	import FaceGrid from '../FaceGrid.svelte';
	import FaceSection from '../FaceSection.svelte';
	import FaceSeam from '../FaceSeam.svelte';
	import PanelEyebrow from './panel/PanelEyebrow.svelte';

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
	// 0..1, default 1). Each has its own control: Drive no longer pulls
	// Output down with it (2026-11-09, the user's call).
	const DRIVE_INDEX = 8;
	const OUTPUT_INDEX = 34;
	const OUTPUT_DEFAULT = 1;

	// Dry/Wet index 36, 0..1, ships fully wet. Read off the running device
	// (2026-09-14), because AutoFilter2 nests a sidechain element, the thing
	// that shifts a flat .adv scan on Compressor2. Live lists the sidechain's
	// own On / Gain / Mix last (42-44), so 36 is Dry/Wet in both.
	const MIX_INDEX = 36;
	const MIX_DEFAULT = 1;

	// Each type wears a small sketch of its response (2026-11-09, the
	// user's call): x is frequency, y level, passband at the top of a
	// 40x20 box. A sketch, not a measurement. `faint` paths are the
	// shapes a sweeping type passes through.
	type Curve = { d: string; faint?: boolean };
	const FILTER_TYPES: { value: number; label: string; curves: Curve[] }[] = [
		{ value: 0, label: 'LP', curves: [{ d: 'M1 6 H20 C26 6 27 3 29 7 S34 17 39 18' }] },
		{ value: 1, label: 'HP', curves: [{ d: 'M1 18 C6 17 11 7 11 7 S14 6 20 6 H39' }] },
		{ value: 2, label: 'BP', curves: [{ d: 'M1 18 C11 17 14 5 20 5 S29 17 39 18' }] },
		{ value: 3, label: 'Notch', curves: [{ d: 'M1 6 H14 C17 6 18 18 20 18 S23 6 26 6 H39' }] },
		{
			value: 4,
			label: 'Morph',
			curves: [
				{ d: 'M1 6 H14 C19 6 21 17 26 18 H39', faint: true },
				{ d: 'M1 18 H14 C19 17 21 6 26 6 H39', faint: true },
				{ d: 'M1 18 C11 17 14 5 20 5 S29 17 39 18' }
			]
		},
		{
			value: 5,
			label: 'DJ',
			curves: [
				{ d: 'M1 6 H8 C12 6 13 17 17 18', faint: true },
				{ d: 'M23 18 C27 17 28 6 32 6 H39', faint: true },
				{ d: 'M8 12 H32' }
			]
		},
		// Live's own labels from 6 on (dumped 2026-10-25, autoFilterParams):
		// Comb, Resampling, Notch+LP, Vowel. They read Vowel, Comb, Resamp, SV.
	// Notch+LP reads N+LP: beside its sketch the whole name did not fit.
		{ value: 6, label: 'Comb', curves: [{ d: 'M1 6 Q4 20 7 6 Q10 20 13 6 Q16 20 19 6 Q22 20 25 6 Q28 20 31 6 Q34 20 37 6 L39 6' }] },
		{ value: 7, label: 'Resamp', curves: [{ d: 'M1 6 H22 V9 H26 V12 H30 V15 H34 V18 H39' }] },
		{ value: 8, label: 'N+LP', curves: [{ d: 'M1 6 H7 C9 6 10 16 12 16 S15 6 17 6 H24 C29 6 30 15 39 18' }] },
		{ value: 9, label: 'Vowel', curves: [{ d: 'M1 17 C4 17 6 5 9 5 S13 14 16 14 S20 8 23 8 S27 15 30 15 S34 11 36 11 S38 17 39 18' }] }
	];

	const LFO_SHAPE_OPTIONS = [
		{ value: 0, label: 'Sine', symbol: '∿' },
		{ value: 1, label: 'Triangle', symbol: '△' },
		{ value: 2, label: 'Saw', symbol: '⋰' },
		{ value: 3, label: 'Square', symbol: '⊓' },
		{ value: 4, label: 'Ramp Up', symbol: '⟋' },
		{ value: 5, label: 'Ramp Down', symbol: '⟍' },
		{ value: 6, label: 'Wander', symbol: '※' }, // Live: Wander (read Random)
		{ value: 7, label: 'S&H', symbol: 'S&H' }
	];

	const CIRCUIT_OPTIONS = [
		{ value: 0, label: 'SVF' },
		{ value: 1, label: 'DFM' },
		{ value: 2, label: 'MS2' }, // Live: MS2 (read SV2)
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
	let output = $derived(fx.paramValue(OUTPUT_INDEX) ?? OUTPUT_DEFAULT);

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
	/** The LFO picture's two axes over Live's parameters: Rate is Time inverted, with the synced division beside it. */
	const lfoParams: PanelParams = {
		has: () => true,
		raw: (n) => (n === 'Rate' ? 1 - lfoTime : n === 'Amount' ? lfoAmount : undefined),
		range: () => ({ min: 0, max: 1 }),
		display: (n) => (n === 'Rate' ? lfoXDisplay : fx.paramDisplay(12)),
		isOn: () => true,
		write: () => {},
		unit: (n) => (n === 'Rate' ? 1 - lfoTime : n === 'Amount' ? lfoAmount : undefined),
		writeUnit: (n, t) => {
			const x = Math.max(0, Math.min(1, t));
			if (n === 'Rate') {
				fx.sendParam(16, 1 - x); // LFO Time, inverted
				fx.sendParam(18, Math.round(16 - x * 12)); // the synced division, 16 (slow) to 4
			} else if (n === 'Amount') fx.sendParam(12, x);
		}
	};
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
	One face grid (ADR-510), eight columns of ~108px at 1366 x 1024:
	  LFO 4 (shapes · Morph · the LFO pad over two) | Filter 3 (types over
	  two · circuit + slope) | Output 1 (Drive over Output over Mix)
	A column holds a large knob (96px + 8, ADR-509), so Morph and Drive
	draw at their size.
-->
<div class="h-full w-full min-h-0 relative" class:slot-ghost={fx.isGhost}>
<FaceGrid sections={[4, 3, 1]}>
	<FaceSection span={4}>
	{#snippet head()}<PanelEyebrow title="LFO" color={lfoInk.primary} />{/snippet}
	<!-- The eight LFO shapes, one segmented tab, two columns of
	     four filled down then across. -->
	<div
		class="min-h-0 device-segmented seg-grid grid grid-cols-2 grid-rows-4 grid-flow-col"
		style="--btn-tint: {lfoInk.primary};"
	>
		{#each LFO_SHAPE_OPTIONS.slice(0, 8) as option}
			<!-- A one-glyph symbol draws large; a word ("S&H") at the tab's own size, so it fits its cell. -->
			<button
				class="device-segment min-h-0 px-1 text-center flex items-center justify-center"
				class:text-3xl={option.symbol.length === 1}
				class:text-sm={option.symbol.length > 1}
				class:active={lfoShape === option.value}
				onclick={() => {
					fx.sendParam(13, option.value);
				}}
				title={option.label}
			>
				{option.symbol}
			</button>
		{/each}
	</div>

	<!-- MORPH: one large knob (ADR-509), one column. -->
	<div class="min-h-0">
		<DeviceSlider
			value={morphAmount}
			title="Morph"
			face="knob"
			knobSize="l"
			icon="morph"
			orientation="vertical"
			isGhost={fx.isGhost}
			color={lfoInk}
			readout={fx.paramDisplay(23)}
			onInteraction={(value) => {
				fx.sendParam(23, value);
			}}
		/>
	</div>

	<!-- LFO XY pad (two columns) over its Time/Sync switch -->
	<div class="face-span-2 min-h-0 flex flex-col gap-(--face-gutter)">
		<div class="flex-1 min-h-0">
			<!-- The LFO drawn as Live draws it (ADR-514): its shape, as many
			     cycles as its rate and as tall as its amount; across is the rate
			     (Time, inverted), up the amount, as the XY it replaces. -->
			<LfoGraph
				params={lfoParams}
				shape={LFO_SHAPE_OPTIONS.find((o) => o.value === Math.round(lfoShape))?.label}
				rate="Rate"
				amount="Amount"
				ink={lfoInk.primary}
				label={lfoTitle}
			/>
		</div>
		<!-- Time/Sync, one touch row under the pad it switches. It floated
		     over the pad's top-right corner until 2026-10-27, 8px past it,
		     which on a small iPad put it across the frame's edge. -->
		<button
			class="physical-button btn-toggle lfo-sync-toggle text-sm font-medium"
			class:active={lfoSync >= 3}
			style="--btn-tint: {lfoInk.primary};"
			onclick={toggleLfoSync}
			title={lfoSync >= 3 ? 'Sync' : 'Time'}
		>
			{lfoSync >= 3 ? 'Sync' : 'Time'}
		</button>
	</div>

	</FaceSection>
	<!-- The seam between the LFO and the filter. This view had the
	     interface's first hand-rolled seam; it is the face grid's now. -->
	<FaceSeam ink={fxInk.primary} />

	<FaceSection span={3}>
	{#snippet head()}<PanelEyebrow title="Filter" color={fxInk.primary} />{/snippet}
	<!-- The ten filter types, one segmented tab, two columns of
	     five filled down then across. -->
	<div
		class="face-span-2 min-h-0 device-segmented seg-grid grid grid-cols-2 grid-rows-5 grid-flow-col"
		style="--btn-tint: {fxInk.primary};"
	>
		{#each FILTER_TYPES.slice(0, 10) as type}
			<button
				class="device-segment type-option min-h-0 px-2 text-sm flex items-center justify-start gap-1.5"
				class:active={filterType === type.value}
				title={type.label}
				onclick={() => selectFilterType(type.value)}
			>
				<svg class="type-curve" viewBox="0 0 40 20" aria-hidden="true">
					{#each type.curves as c, i (i)}
						<path d={c.d} class:faint={c.faint} />
					{/each}
				</svg>
				<span class="type-label">{type.label}</span>
			</button>
		{/each}
	</div>

	<!-- Circuit buttons + Slope toggle -->
	<div class="h-full min-h-0 flex flex-col gap-(--face-gutter)">
		<!-- The circuits are one pick-one tab; the slope under it is a
		     switch of its own, so a separate button. Each option keeps one
		     share of the column. -->
		<div
			class="min-h-0 device-segmented seg-grid flex flex-col"
			style="flex: {CIRCUIT_OPTIONS.length} 1 0; --btn-tint: {fxInk.primary};"
		>
			{#each CIRCUIT_OPTIONS as option}
				<button
					class="device-segment flex-1 min-h-0 px-1 text-sm text-center font-medium flex items-center justify-center"
					class:active={circuit === option.value}
					onclick={() => {
						fx.sendParam(7, option.value);
					}}
					title={option.label}
				>
					{option.label}
				</button>
			{/each}
		</div>
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

	</FaceSection>
	<FaceSeam ink={fxInk.primary} />

	<FaceSection span={1}>
	{#snippet head()}<PanelEyebrow title="Output" color={fxInk.primary} />{/snippet}
	<!-- Drive over Output over Mix (Dry/Wet): a knob over two value boxes,
	     in the device's own order (Live's panel ends on Output, Soft Clip
	     and Dry/Wet). Output is its own control, not tied to Drive. -->
	<div class="h-full min-h-0 flex flex-col gap-(--face-gutter)">
		<!-- A large knob and its caption: 104 x 150px (ADR-509); Output and Mix share the rest. -->
		<div class="flex-none h-[9.375rem] min-h-0">
			<DeviceSlider
				value={drive}
				title="Drive"
				face="knob"
				knobSize="l"
				icon="drive"
				orientation="vertical"
				isGhost={fx.isGhost}
				color={fxInk}
				readout={fx.paramDisplay(DRIVE_INDEX)}
				onInteraction={(value) => {
					fx.sendParam(DRIVE_INDEX, value);
				}}
			/>
		</div>
		<div class="flex-1 min-h-0">
			<DeviceSlider
				value={output}
				title="Output"
				icon="output"
				orientation="vertical"
				isGhost={fx.isGhost}
				color={fxInk}
				readout={fx.paramDisplay(OUTPUT_INDEX)}
				onInteraction={(value) => {
					fx.sendParam(OUTPUT_INDEX, value);
				}}
			/>
		</div>
		<div class="flex-1 min-h-0">
			<DeviceSlider
				value={mix}
				title="Mix"
				icon="mix"
				orientation="vertical"
				isGhost={fx.isGhost}
				color={fxInk}
				readout={fx.paramDisplay(MIX_INDEX)}
				onInteraction={(value) => {
					fx.sendParam(MIX_INDEX, value);
				}}
			/>
		</div>
	</div>
	</FaceSection>
</FaceGrid>
</div>

<style>
	/* ---- Live skin (flat grammar): every AutoFilter control is already a
	   flat field — the shape / type / circuit / slope buttons are
	   .physical-button (app.css gives them the ControlBackground field and
	   ChosenDefault ON fill), MORPH / DRIVE are DeviceSlider and the LFO pad
	   is DeviceXY (both flat, both re-case their own titles), and the
	   Time/Sync switch under the pad is a plain .physical-button too. */
	.lfo-sync-toggle {
		flex: 0 0 var(--height-touch);
		min-height: 0;
	}

	/* A filter type: its response sketch, then its name. The sketch is
	   drawn in the label's colour, so it lights with the segment. */
	.type-option {
		container-type: inline-size;
	}
	.type-curve {
		flex: 0 0 auto;
		width: 2rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5px;
		stroke-linecap: round;
		stroke-linejoin: round;
		overflow: visible;
	}
	.type-curve path {
		vector-effect: non-scaling-stroke;
	}
	.type-curve .faint {
		opacity: 0.35;
	}
	.type-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Too narrow for both: the sketch alone, the name in its title. */
	@container (max-width: 5.5rem) {
		.type-label {
			display: none;
		}
		.type-option {
			justify-content: center;
		}
	}
</style>