<script lang="ts">
	/**
	 * EchoCentralView — what the Echo tile opens (2026-09-14).
	 *
	 *   [Time over Sync] [Filter  Filter]
	 *   | [LFO Wave 2x3] [Rate over LFO Sync] [LFO > Time] [LFO > Filter]
	 *   | [Input] [Output] [Feedback] [Mix]
	 *
	 * Every axis of the tile has its own control here (user's call), plus
	 * what the tile has no room for: the Sync switch, Echo's two-dot filter
	 * graph, the LFO, and Input and Output across their full rails. Time
	 * writes both of Echo's time controls the way the tile's X does, but
	 * spans the full 1..16 sixteenths. Feedback stays on the tile's 0..1.
	 * Mix reaches past the tile's 0.5 ceiling to full wet — the pad caps it
	 * because its Y also drives feedback, and this slider is the escape
	 * hatch, as the Delay view it replaced carried. Every index and span
	 * lives in `echoParams.ts`, shared with the tile.
	 *
	 * The LFO Rate is ONE slider over two parameters: it reads LFO Sync and
	 * writes the free rate (Hz) or the synced rate (a note value), and its
	 * readout is Live's own string for whichever is live.
	 *
	 * The filter graph is Echo's own panel: a high-pass dot and a low-pass
	 * dot on one response curve, frequency across and resonance up. A press
	 * grabs the nearer dot and the drag moves only that one.
	 */
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import FilterCurve from '$lib/components/v6/device-panel/FilterCurve.svelte';
	import SectionDivider from '$lib/components/v6/central/SectionDivider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import {
		ECHO,
		ECHO_LFO,
		ECHO_LFO_WAVES,
		compensatedOutput,
		freqTFrom,
		freqValueFor,
		lfoRateLabel,
		lfoRateT,
		lfoRateWrite,
		resTFrom,
		resValueFor,
		type ParamWrite
	} from '$lib/components/v6/device-panel/echoParams';
	import { DEVICE_FAMILY_INKS } from '$lib/config/devicePresets';
	import { FilterResponseCalculator } from '$lib/utils/filterResponseCalculator';
	import { drag } from '$lib/actions';
	import type { DragInfo } from '$lib/actions/drag';
	import { gridCellIndex, scrubBoxOf, type ScrubBox } from '$lib/utils/segmentScrub';

	const echo = useFxGridSlot('echo');

	function send(writes: ParamWrite[]) {
		for (const [index, value] of writes) echo.sendParam(index, value);
	}

	/** The LOM range of a param, once the device exists (ghost: none). */
	function rangeOf(index: number) {
		if (!echo.device) return undefined;
		return selectedTrackStore.paramRange(selectedTrackStore.paramPath(echo.device, index));
	}

	const t01 = (v: number | undefined) => Math.min(1, Math.max(0, v ?? 0));

	// ── Time / Sync ─────────────────────────────────────────────────────
	let synced = $derived((echo.paramValue(ECHO.sync) ?? 1) >= 0.5);
	let sixteenths = $derived(echo.paramValue(ECHO.sixteenths));
	let time = $derived(echo.paramValue(ECHO.time));
	let timeT = $derived(ECHO.timeTFrom(synced, sixteenths, time, true));
	let timeLabel = $derived(ECHO.timeLabel(synced, sixteenths, echo.paramDisplay(ECHO.time), time));

	function toggleSync() {
		echo.sendParam(ECHO.sync, synced ? 0 : 1);
	}

	// ── LFO ─────────────────────────────────────────────────────────────
	// At rest (ghost) Echo.adv has LFO Sync on at 1/16 (step 17).
	let lfoSynced = $derived((echo.paramValue(ECHO_LFO.sync) ?? 1) >= 0.5);
	let lfoFreq = $derived(echo.paramValue(ECHO_LFO.freq));
	let lfoStep = $derived(echo.paramValue(ECHO_LFO.synced) ?? (echo.device ? undefined : 17));
	let lfoRate = $derived(lfoRateT(lfoSynced, lfoFreq, lfoStep));
	let lfoLabel = $derived(lfoRateLabel(lfoSynced, lfoFreq, lfoStep));
	let lfoToTime = $derived(t01(echo.paramValue(ECHO_LFO.toTime)));
	let lfoToFilter = $derived(t01(echo.paramValue(ECHO_LFO.toFilter)));

	function toggleLfoSync() {
		echo.sendParam(ECHO_LFO.sync, lfoSynced ? 0 : 1);
	}

	/**
	 * LFO Wave as pictures, Drift's waveform grammar (user, 2026-09-14): one
	 * cycle per glyph in a 24x12 box, Live's name on `title` and in the
	 * accessible name. The grid scrubs — it owns the pointer and resolves
	 * the cell from geometry, so only a cell EDGE reaches Live.
	 */
	const WAVE_COLS = 2;
	const WAVE_ROWS = 3;
	const LFO_WAVE_GLYPHS: Record<(typeof ECHO_LFO_WAVES)[number], string> = {
		Sine: 'M0 6 Q6 -1 12 6 T24 6',
		Triangle: 'M0 6 L6 2 L18 10 L24 6',
		'Saw Up': 'M0 10 L20 2 L20 10',
		'Saw Down': 'M4 10 L4 2 L24 10',
		Square: 'M0 10 L0 2 L12 2 L12 10 L24 10',
		// Sample-and-hold: flat steps at unrelated heights.
		Random: 'M0 7 L5 7 L5 3 L10 3 L10 9 L15 9 L15 5 L20 5 L20 8 L24 8'
	};

	// At rest (ghost) Echo.adv's LFO is Saw Up (2).
	let lfoWave = $derived(Math.round(echo.paramValue(ECHO_LFO.wave) ?? 2));

	let waveGrid = $state<HTMLElement | null>(null);
	let waveBox: ScrubBox | null = null;

	function waveAt(clientX: number, clientY: number) {
		if (!waveBox) return;
		const cell = gridCellIndex(clientX, clientY, waveBox, WAVE_COLS, WAVE_ROWS);
		if (cell < 0 || cell >= ECHO_LFO_WAVES.length || cell === lfoWave) return;
		echo.sendParam(ECHO_LFO.wave, cell);
	}

	function waveScrubDown(info: DragInfo) {
		waveBox = scrubBoxOf(waveGrid);
		waveAt(info.x, info.y);
	}

	// ── Input / Output / Feedback / Mix ─────────────────────────────────
	// Input and Output span each parameter's full LOM rail (user, 2026-09-14),
	// read at runtime; before the device exists the slider writes 0..1 raw.
	function fullT(index: number): number {
		const v = echo.paramValue(index);
		if (v === undefined) return 0.5;
		return resTFrom(v, rangeOf(index), 0.5);
	}
	function fullValue(index: number, t: number): number {
		return resValueFor(t, rangeOf(index));
	}
	let input = $derived(fullT(ECHO.inputGain));
	let output = $derived(fullT(ECHO.outputGain));

	// Input drags Output the other way, dB for dB, from wherever Output
	// stands (user, 2026-10-02); Output moves alone. Both rails are 0..1.
	let gainsAtDown = { input: 0.5, output: 0.5 };
	function inputDown() {
		gainsAtDown = { input, output };
	}
	function inputMoved(t: number) {
		echo.sendParam(ECHO.inputGain, fullValue(ECHO.inputGain, t));
		const out = compensatedOutput(gainsAtDown.output, gainsAtDown.input, t);
		echo.sendParam(ECHO.outputGain, fullValue(ECHO.outputGain, out));
	}
	let feedback = $derived(t01(echo.paramValue(ECHO.feedback)));
	let mix = $derived(t01(echo.paramValue(ECHO.mix)));

	// ── Filter graph ────────────────────────────────────────────────────
	// At rest (ghost): where Echo.adv puts them — HP 137 Hz, LP 4.4 kHz, a
	// quarter of the resonance rail.
	const HP_AT_REST = 0.28;
	const LP_AT_REST = 0.71;
	const RES_AT_REST = 0.27;

	let hpT = $derived(freqTFrom(echo.paramValue(ECHO.hpFreq), rangeOf(ECHO.hpFreq), HP_AT_REST));
	let lpT = $derived(freqTFrom(echo.paramValue(ECHO.lpFreq), rangeOf(ECHO.lpFreq), LP_AT_REST));
	let hpResT = $derived(resTFrom(echo.paramValue(ECHO.hpRes), rangeOf(ECHO.hpRes), RES_AT_REST));
	let lpResT = $derived(resTFrom(echo.paramValue(ECHO.lpRes), rangeOf(ECHO.lpRes), RES_AT_REST));

	const calculator = new FilterResponseCalculator(44100);
	const q = (t: number) => calculator.normalizedToQ(t, 0.5, 6);

	let bands = $derived([
		{ freq: calculator.normalizedToFrequency(hpT), gain: 0, q: q(hpResT), type: 'highpass' },
		{ freq: calculator.normalizedToFrequency(lpT), gain: 0, q: q(lpResT), type: 'lowpass' }
	]);

	// HP warm, LP cool — the two ends of the family wheel (ADR-400).
	let dots = $derived([
		{ freq: hpT, resonance: hpResT, type: 'highpass' as const, color: DEVICE_FAMILY_INKS.distortion.primary },
		{ freq: lpT, resonance: lpResT, type: 'lowpass' as const, color: DEVICE_FAMILY_INKS.filter.primary }
	]);

	let graph = $state<HTMLElement | null>(null);
	let box: DOMRect | null = null;
	let grabbed: 'hp' | 'lp' = 'hp';

	function pointAt(info: DragInfo) {
		if (!box) return { x: 0, y: 0 };
		return {
			x: Math.min(1, Math.max(0, (info.x - box.left) / box.width)),
			y: Math.min(1, Math.max(0, 1 - (info.y - box.top) / box.height))
		};
	}

	function writeDot({ x, y }: { x: number; y: number }) {
		if (grabbed === 'hp') {
			send([
				[ECHO.hpFreq, freqValueFor(x, rangeOf(ECHO.hpFreq))],
				[ECHO.hpRes, resValueFor(y, rangeOf(ECHO.hpRes))]
			]);
		} else {
			send([
				[ECHO.lpFreq, freqValueFor(x, rangeOf(ECHO.lpFreq))],
				[ECHO.lpRes, resValueFor(y, rangeOf(ECHO.lpRes))]
			]);
		}
	}

	function filterDown(info: DragInfo) {
		box = graph?.getBoundingClientRect() ?? null;
		const p = pointAt(info);
		const dHp = Math.hypot(p.x - hpT, p.y - hpResT);
		const dLp = Math.hypot(p.x - lpT, p.y - lpResT);
		grabbed = dHp <= dLp ? 'hp' : 'lp';
		writeDot(p);
	}
</script>

<!-- One LFO waveform, `currentColor` so a lit cell's glyph inverts with it. -->
{#snippet waveGlyph(label: (typeof ECHO_LFO_WAVES)[number])}
	<svg class="wave-glyph" viewBox="0 0 24 12" aria-hidden="true" focusable="false">
		<path
			d={LFO_WAVE_GLYPHS[label]}
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
			vector-effect="non-scaling-stroke"
		/>
	</svg>
{/snippet}

<div class="echo-layout">
	<div class="col slider-over-switch">
		<div class="slider-part">
			<DeviceSlider
				value={timeT}
				title="Time {timeLabel}"
				orientation="vertical"
				labelOrientation="horizontal"
				labelSize="small"
				isGhost={echo.isGhost}
				color={echo.color}
				onTap={() => echo.loadIfGhost()}
				onInteraction={(t) => send(ECHO.timeWrites(t, true))}
			/>
		</div>
		<button
			class="physical-button echo-switch w-full font-bold"
			class:active={synced}
			style="--btn-tint: {echo.color.primary};{echo.isGhost ? ' opacity: var(--opacity-ghost);' : ''}"
			aria-pressed={synced}
			onclick={toggleSync}
		>
			Sync
		</button>
	</div>

	<div
		class="col filter-graph"
		class:ghost={echo.isGhost}
		style="--curve-color: {echo.color.primary};"
		role="slider"
		aria-label="Filter: high-pass {Math.round(hpT * 100)}%, low-pass {Math.round(lpT * 100)}%"
		aria-valuenow={Math.round(lpT * 100)}
		tabindex="-1"
		data-echo-filter
		bind:this={graph}
		use:drag={{ commit: 'immediate', onDown: filterDown, onMove: (i) => writeDot(pointAt(i)) }}
	>
		<FilterCurve curveType="eq" {bands} filterDots={dots} width={400} height={300} curveColor={echo.color.primary} />
		<span class="graph-title">Filter</span>
	</div>

	<SectionDivider orientation="vertical" />

	<div
		class="col wave-grid"
		style={echo.isGhost ? 'opacity: var(--opacity-ghost);' : ''}
		data-echo-lfo-wave
		bind:this={waveGrid}
		use:drag={{ commit: 'immediate', onDown: waveScrubDown, onMove: (i) => waveAt(i.x, i.y) }}
	>
		{#each ECHO_LFO_WAVES as label, value}
			<button
				class="physical-button wave-button"
				class:active={lfoWave === value}
				style="--btn-tint: {echo.color.primary};"
				title={label}
				aria-label="LFO wave {label}"
				aria-pressed={lfoWave === value}
				onclick={() => echo.sendParam(ECHO_LFO.wave, value)}
			>
				{@render waveGlyph(label)}
			</button>
		{/each}
	</div>

	<div class="col slider-over-switch" data-echo-lfo>
		<div class="slider-part">
			<DeviceSlider
				value={lfoRate}
				title="Rate {lfoLabel}"
				orientation="vertical"
				labelOrientation="horizontal"
				labelSize="small"
				isGhost={echo.isGhost}
				color={echo.color}
				onTap={() => echo.loadIfGhost()}
				onInteraction={(t) => send([lfoRateWrite(lfoSynced, t)])}
			/>
		</div>
		<button
			class="physical-button echo-switch w-full font-bold"
			class:active={lfoSynced}
			style="--btn-tint: {echo.color.primary};{echo.isGhost ? ' opacity: var(--opacity-ghost);' : ''}"
			aria-pressed={lfoSynced}
			onclick={toggleLfoSync}
		>
			LFO Sync
		</button>
	</div>

	<div class="col">
		<DeviceSlider
			value={lfoToTime}
			title="LFO > Time"
			orientation="vertical"
			labelOrientation="horizontal"
			labelSize="small"
			isGhost={echo.isGhost}
			color={echo.color}
			onTap={() => echo.loadIfGhost()}
			onInteraction={(t) => echo.sendParam(ECHO_LFO.toTime, t)}
		/>
	</div>

	<div class="col">
		<DeviceSlider
			value={lfoToFilter}
			title="LFO > Filter"
			orientation="vertical"
			labelOrientation="horizontal"
			labelSize="small"
			isGhost={echo.isGhost}
			color={echo.color}
			onTap={() => echo.loadIfGhost()}
			onInteraction={(t) => echo.sendParam(ECHO_LFO.toFilter, t)}
		/>
	</div>

	<SectionDivider orientation="vertical" />

	<div class="col">
		<DeviceSlider
			value={input}
			title="Input"
			orientation="vertical"
			labelOrientation="horizontal"
			labelSize="small"
			isGhost={echo.isGhost}
			color={echo.color}
			onTap={() => echo.loadIfGhost()}
			onDown={inputDown}
			onInteraction={inputMoved}
		/>
	</div>

	<div class="col">
		<DeviceSlider
			value={output}
			title="Output"
			orientation="vertical"
			labelOrientation="horizontal"
			labelSize="small"
			isGhost={echo.isGhost}
			color={echo.color}
			onTap={() => echo.loadIfGhost()}
			onInteraction={(t) => echo.sendParam(ECHO.outputGain, fullValue(ECHO.outputGain, t))}
		/>
	</div>

	<div class="col">
		<DeviceSlider
			value={feedback}
			title="Feedback"
			orientation="vertical"
			labelOrientation="horizontal"
			labelSize="small"
			isGhost={echo.isGhost}
			color={echo.color}
			onTap={() => echo.loadIfGhost()}
			onInteraction={(t) => echo.sendParam(ECHO.feedback, t)}
		/>
	</div>

	<div class="col">
		<DeviceSlider
			value={mix}
			title="Mix"
			orientation="vertical"
			labelOrientation="horizontal"
			labelSize="small"
			isGhost={echo.isGhost}
			color={echo.color}
			onTap={() => echo.loadIfGhost()}
			onInteraction={(t) => echo.sendParam(ECHO.mix, t)}
		/>
	</div>
</div>

<style>
	/* Eleven equal columns — the filter graph spans two — with an `auto`
	   track for each seam: Time + Filter | LFO (wave, rate, depths) | levels. */
	.echo-layout {
		display: grid;
		grid-template-columns:
			repeat(3, minmax(0, 1fr)) auto
			repeat(4, minmax(0, 1fr)) auto
			repeat(4, minmax(0, 1fr));
		gap: var(--central-gap);
		height: 100%;
		width: 100%;
		padding: var(--central-inset);
	}

	.col {
		min-height: 0;
		min-width: 0;
		height: 100%;
	}

	/* A slider over its switch: the Drum Buss view's Trim-over-Comp shape. */
	.slider-over-switch {
		display: flex;
		flex-direction: column;
		gap: var(--central-gap);
	}
	.slider-part {
		flex: 3 1 0;
		min-height: 0;
	}
	.echo-switch {
		flex: 1 1 0;
		min-height: var(--height-touch);
		font-size: 1rem;
		text-transform: uppercase;
	}

	/* LFO Wave: two columns of three, as Drift's waveform grid. The grid owns
	   the pointer (it scrubs); the buttons are its face, and keyboard focus
	   and Enter still reach them. */
	.wave-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		grid-template-rows: repeat(3, minmax(0, 1fr));
		gap: var(--spacing-sm);
	}
	.wave-button {
		pointer-events: none;
		min-height: 0;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
	}
	.wave-glyph {
		width: 100%;
		height: 100%;
		max-height: 22px;
	}

	.filter-graph {
		grid-column: span 2;
		position: relative;
		overflow: hidden;
		border: 1px solid var(--line-strong);
		border-radius: 2px;
		background: var(--surface-well);
		cursor: crosshair;
	}
	.filter-graph.ghost {
		opacity: var(--opacity-ghost);
	}
	.graph-title {
		position: absolute;
		top: 0.5rem;
		left: 0.75rem;
		font-size: 0.8125rem;
		font-weight: var(--font-weight-medium);
		color: var(--curve-color);
		pointer-events: none;
		user-select: none;
	}

	:global([data-grammar="flat"]) .echo-switch {
		font-weight: var(--font-weight-medium);
		text-transform: none;
	}
	/* One ink for the view: a lit switch wears the Echo's own teal rather
	   than the house --phosphor, as the Drum Buss view's Comp does. */
	:global([data-grammar="flat"]) .wave-button.active,
	:global([data-grammar="flat"]) .echo-switch.active {
		background: var(--btn-tint);
		border-color: var(--btn-tint);
		color: var(--flat-on-fg);
	}
	:global([data-grammar="flat"]) .echo-switch:not(.active) {
		color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
	}
</style>
