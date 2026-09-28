<script lang="ts">
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import SectionDivider from '$lib/components/v6/central/SectionDivider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';

	// Param indices for the native Tremolo plugin (AuPluginDevice:Tremolo).
	// Runtime LOM order; all plugin params report normalized 0..1 value/min/max.
	const PARAM = { rate: 1, sync: 2, shape: 3, division: 4, shapeModDiv: 5, amount: 6, randRange: 7, randRate: 8, shapeModDepth: 9 } as const;

	// Param native ranges (for normalized<->engineering conversion on int enums).
	const RAND_RATE_MIN = 1; // randRate16 int 1..64
	const RAND_RATE_MAX = 64;
	const RAND_RANGE_MIN = 0; // randRange float 0..4
	const RAND_RANGE_MAX = 4;

	// Normalized helpers for discrete buttons: norm = (v - min)/(max - min).
	const randRateNorm = (steps: number) => (steps - RAND_RATE_MIN) / (RAND_RATE_MAX - RAND_RATE_MIN);
	const randRangeNorm = (v: number) => (v - RAND_RANGE_MIN) / (RAND_RANGE_MAX - RAND_RANGE_MIN);

	// Rand Rate: re-roll period in 16th notes; faster (fewer 16ths) on top.
	const RAND_RATE_OPTIONS = [
		{ steps: 4, label: '1/4' },
		{ steps: 8, label: '1/2' },
		{ steps: 16, label: '1' },
		{ steps: 32, label: '2' },
		{ steps: 64, label: '4' }
	];

	// Rand Range: int 0–3 (biggest on top)
	const RAND_RANGE_OPTIONS = [
		{ value: 3, label: '3' },
		{ value: 2, label: '2' },
		{ value: 1, label: '1' },
		{ value: 0, label: '0' }
	];

	const fx = useFxGridSlot('tremolo');

	// GRATICULE (§2.4 / §5.5): normalize the device palette through trackInk at
	// injection — hue preserved, luminance/chroma calibrated. secondary (the alpha
	// wash) is left untouched. fx.color is normalized too since the slot config
	// may override the fallback above.
	let fxInk = $derived({
		primary: trackInk(fx.color.primary, paintModeReactive()),
		secondary: fx.color.secondary,
		accent: trackInk(fx.color.accent, paintModeReactive())
	});

	// Plugin params are normalized 0..1. shape's native range is -1..1, so the
	// normalized value IS the (shape+1)/2 the slider wants.
	let shapeNorm = $derived(fx.paramValue(PARAM.shape) ?? 0.25);
	// Engineering value reconstructed for the waveform DSP mirror (-1..1).
	let shape = $derived(shapeNorm * 2 - 1);
	let syncMode = $derived(fx.paramValue(PARAM.sync) ?? 0);
	let isSynced = $derived(syncMode > 0.5);
	let randRateNormVal = $derived(fx.paramValue(PARAM.randRate) ?? randRateNorm(16));
	let randRangeNormVal = $derived(fx.paramValue(PARAM.randRange) ?? 0);
	// Reconstruct engineering ints from normalized for button highlight match.
	let randRate = $derived(Math.round(RAND_RATE_MIN + randRateNormVal * (RAND_RATE_MAX - RAND_RATE_MIN)));
	let randRange = $derived(Math.round(RAND_RANGE_MIN + randRangeNormVal * (RAND_RANGE_MAX - RAND_RANGE_MIN)));
	let shapeModDivNorm = $derived(fx.paramValue(PARAM.shapeModDiv) ?? 0);
	let shapeModDiv = $derived(Math.round(1 + shapeModDivNorm * 15));
	let shapeModDepth = $derived(fx.paramValue(PARAM.shapeModDepth) ?? 0);

	function toggleSync() {
		fx.sendParam(PARAM.sync, isSynced ? 0 : 1);
	}

	// The Shape slider's label: one cycle of the LFO shape it selects,
	// mirroring tremolo-display.js's DSP. Always drawn at full depth — Amount
	// is the FX-grid tile's Y, and a glyph that shrank with it would say
	// nothing about the shape at low amounts.
	const GLYPH_W = 200;
	const GLYPH_H = 100;

	function shark(p: number): number {
		return Math.exp(-p * 5);
	}
	function saw(p: number): number {
		return 1 - p;
	}
	function tri(p: number): number {
		return Math.abs(p * 2 - 1);
	}

	// Morph triangle -> 50/50 square via tanh saturation. u in [0,1]: 0 = triangle, 1 = hard square.
	function powsine(p: number, u: number): number {
		const drive = 0.5 + u * u * 40;
		const bip = Math.sin(p * Math.PI * 2);
		const sq = Math.tanh(bip * drive) / Math.tanh(drive);
		const squareWave = (1 + sq) * 0.5;
		return tri(p) + (squareWave - tri(p)) * u;
	}

	function shapeAt(p: number, s: number): number {
		if (s < -0.5) return shark(p) + (saw(p) - shark(p)) * ((s + 1) * 2);
		if (s < 0) return saw(p) + (tri(p) - saw(p)) * (s * 2 + 1);
		return powsine(p, s);
	}

	let wavePath = $derived.by(() => {
		const steps = shape < -0.7 ? 256 : 128;
		let d = '';
		for (let i = 0; i <= steps; i++) {
			const p = i / steps;
			const px = p * GLYPH_W;
			const py = (1 - shapeAt(p, shape)) * GLYPH_H;
			d += `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
		}
		return d;
	});
</script>

{#snippet shapeGlyph()}
	<svg
		viewBox="0 0 {GLYPH_W} {GLYPH_H}"
		class="trem-shape-glyph"
		preserveAspectRatio="none"
		aria-hidden="true"
	>
		<path
			d={wavePath}
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			vector-effect="non-scaling-stroke"
		/>
	</svg>
{/snippet}

<div class="h-full w-full flex p-(--central-inset)" style="gap: var(--central-gap);" class:slot-ghost={fx.isGhost}>
	<div class="h-full flex" style="gap: var(--central-gap); opacity: {fx.isGhost ? 'var(--opacity-ghost)' : '1'}; width: 100%;">

		<!-- Left: shape-mod sliders (div + depth) -->
		<div class="h-full flex" style="flex: 1; gap: var(--central-gap);">
			<!-- Shape Mod Div: integer 1–16 -->
			<div class="flex-1 h-full">
				<DeviceSlider
					value={shapeModDivNorm}
					title="Div {shapeModDiv}"
					orientation="vertical"
					labelOrientation="horizontal"
					isGhost={fx.isGhost}
					color={fxInk}
					onInteraction={(v) => fx.sendParam(PARAM.shapeModDiv, Math.round(v * 15) / 15)}
				/>
			</div>

			<!-- Shape Mod Depth: float 0–1 -->
			<div class="flex-1 h-full">
				<DeviceSlider
					value={shapeModDepth}
					title="Depth"
					orientation="vertical"
					labelOrientation="horizontal"
					isGhost={fx.isGhost}
					color={fxInk}
					onInteraction={(v) => fx.sendParam(PARAM.shapeModDepth, v)}
				/>
			</div>
		</div>

		<!-- Middle: shape slider + sync button -->
		<div class="h-full flex" style="flex: 1; gap: var(--central-gap);">
			<!-- Shape slider, labelled with the shape itself -->
			<div class="flex-1 h-full">
				<DeviceSlider
					value={shapeNorm}
					title="Shape"
					label={shapeGlyph}
					orientation="vertical"
					labelOrientation="horizontal"
					isGhost={fx.isGhost}
					color={fxInk}
					onInteraction={(v) => fx.sendParam(PARAM.shape, v)}
				/>
			</div>

			<!-- Sync toggle -->
			<div class="flex-1 h-full flex items-center justify-center">
				<button
					onclick={toggleSync}
					class="physical-button trem-sync w-full h-full text-4xl font-bold flex items-center justify-center"
					class:active={isSynced}
					style="--btn-tint: {fxInk.primary};"
				>
					{isSynced ? 'Sync' : 'Free'}
				</button>
			</div>
		</div>

		<!-- Right: randomness (rate + range) — its own section of the device,
		     so a seam rather than the bordered box it sat in until 2026-09-13
		     (the one card the ADR-433 pass missed). The ghost dim is the row's,
		     above; the box applied it a second time. -->
		<SectionDivider orientation="vertical" />
		<div class="trem-random h-full flex flex-col" style="flex: 1; gap: var(--spacing-sm);">
			<div class="trem-label trem-random-title" style="color: var(--trem-label-ink, {fxInk.accent}); letter-spacing: var(--trem-tracking, 0.05em);">Random</div>
			<div class="flex-1 flex" style="gap: var(--central-gap); min-height: 0;">
				<!-- Rand Rate: 5 buttons stacked vertically (fastest on top) -->
				<div class="flex-1 h-full flex flex-col gap-1">
					<div class="trem-label text-xs font-medium text-center mb-1" style="color: var(--trem-label-ink, {fxInk.accent}); font-size: 0.6rem; letter-spacing: var(--trem-tracking, 0.05em);">Rate</div>
					{#each RAND_RATE_OPTIONS as opt}
						<button
							class="physical-button flex-1 text-xs flex items-center justify-center font-medium"
							class:active={randRate === opt.steps}
							style="--btn-tint: {fxInk.primary};"
							onclick={() => fx.sendParam(PARAM.randRate, randRateNorm(opt.steps))}
						>
							{opt.label}
						</button>
					{/each}
				</div>

				<!-- Rand Range: 4 buttons stacked vertically (biggest on top) -->
				<div class="flex-1 h-full flex flex-col gap-1">
					<div class="trem-label text-xs font-medium text-center mb-1" style="color: var(--trem-label-ink, {fxInk.accent}); font-size: 0.6rem; letter-spacing: var(--trem-tracking, 0.05em);">Range</div>
					{#each RAND_RANGE_OPTIONS as opt}
						<button
							class="physical-button flex-1 text-xs flex items-center justify-center font-medium"
							class:active={randRange === opt.value}
							style="--btn-tint: {fxInk.primary};"
							onclick={() => fx.sendParam(PARAM.randRange, randRangeNorm(opt.value))}
						>
							{opt.label}
						</button>
					{/each}
				</div>
			</div>
		</div>

	</div>
</div>

<style>
	/* GRATICULE: the Random / Rate / Range eyebrows and the Sync / Free
	   toggle are authored mixed-case and up-cased here for the HUD voice. */
	.trem-label,
	.trem-sync {
		text-transform: uppercase;
	}

	/* The Shape slider's glyph. Sized off the slider (DeviceSlider's label
	   layer sits inside its size container), inked by the label's own colour
	   through currentColor — device ink on the well, the on-fill ink where the
	   fill has risen over it, the ghost mix on a ghost. */
	.trem-shape-glyph {
		display: block;
		width: 72cqw;
		height: min(36cqw, 30cqh);
		overflow: visible;
		stroke-width: 3px;
	}

	/* ---- Live skin (flat grammar). The sliders and every RATE / RANGE /
	   SYNC button are DeviceSlider / .physical-button — already flat. What
	   this file owns is lifted into custom properties (Graticule fallbacks
	   are the old inline values, so the Graticule render is unchanged) and
	   re-read here: the RANDOM / RATE / RANGE eyebrows lose their tracking
	   and upper-casing and read as Live's grey control text, and the SYNC /
	   FREE literal settles from bold to medium. (The waveform well that took
	   a ControlBackground frame here is gone since 2026-09-14 — its shape is
	   the Shape slider's label now.) Every rule below sits under
	   [data-grammar="flat"] / [data-skin]. */
	/* The Random section's name — the eyebrow every named group in a central
	   view wears (EnvelopeGroup's), upright and centred over its columns. */
	.trem-random-title {
		font-size: 0.75rem;
		font-weight: 700;
		text-align: center;
	}
	:global([data-grammar="flat"]) .trem-random-title {
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .trem-label {
		--trem-tracking: 0;
		--trem-label-ink: var(--muted-foreground);
		text-transform: none;
	}
	:global([data-grammar="flat"]) .trem-sync {
		font-weight: var(--font-weight-medium);
		text-transform: none;
	}
	/* Hybrid: the device family keeps its voice on the eyebrows (mirrors the
	   DeviceSlider hybrid label — ink text on the flat grey module). */
	:global([data-skin="hybrid"]) .trem-label {
		--trem-label-ink: initial;
	}
</style>
