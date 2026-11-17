<script lang="ts">
  import { press } from '$lib/actions/press';
	/**
	 * EchoCentralView — what the Echo tile opens (2026-09-14).
	 *
	 *   Delay  [Sync over Time] [Filter  Filter]
	 *   | LFO  [Wave 2x3] [LFO Sync over Rate] [the wave drawn, over LFO > Time  LFO > Filter]
	 *   | Levels [Input over Output] [Feedback] [Mix]
	 *
	 * on one face grid (ADR-510), sections 3 · 4 · 3, in the signal's order.
	 *
	 * Re-laid for Ink (ADR-544, 2026-11-17). Every knob is one size (medium:
	 * the column holds no larger). A switch sits over the knob it switches,
	 * one touch row, as Auto Filter's Time/Sync does. The LFO reads left to
	 * right as its shape, its rate, and its wave drawn over the two depths
	 * it is sent to (it was a small picture over the shapes, a large knob and
	 * two medium ones). Feedback and Mix, the pair the Echo tile plays, are
	 * full-height boxes: at half height a fill resting mid-range cut their
	 * names. The filter's two dots are both the track's ink: left is the
	 * high-pass, right the low-pass.
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
	 * The LFO Rate is ONE knob over two parameters: it reads LFO Sync and
	 * writes the free rate (Hz) or the synced rate (a note value), and its
	 * readout is Live's own string for whichever is live.
	 *
	 * The filter graph is Echo's own panel: a high-pass dot and a low-pass
	 * dot on one response curve, frequency across and resonance up. A press
	 * grabs the nearer dot and the drag moves only that one.
	 */
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import FilterCurve from '$lib/components/v6/device-panel/FilterCurve.svelte';
	import type { ControlGlyphName } from '$lib/components/v6/device-panel/ControlGlyph.svelte';
	import FaceGrid from '$lib/components/v6/central/FaceGrid.svelte';
	import FaceSection from '$lib/components/v6/central/FaceSection.svelte';
	import FaceSeam from '$lib/components/v6/central/FaceSeam.svelte';
	import PanelEyebrow from './panel/PanelEyebrow.svelte';
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
	import { FilterResponseCalculator } from '$lib/utils/filterResponseCalculator';
	import { drag } from '$lib/actions';
	import type { DragInfo } from '$lib/actions/drag';
	import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';
	import LfoGraph from '../LfoGraph.svelte';
	import { pictureParams } from './panel/usePanelParams.svelte';

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
	/** The LFO's wave as a picture over its shapes (ADR-514), as many cycles as its rate. */
	const lfoPicture = pictureParams(() => ({ Rate: lfoRate }));


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
	// Half speed: a full-height drag covers half of either rail (user, 2026-10-02).
	const GAIN_SENSITIVITY = 0.5;
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

	// Both dots in the track's ink (ADR-544: a second colour would mean a
	// second owner). Which is which is where it sits: high-pass left.
	let dots = $derived([
		{ freq: hpT, resonance: hpResT, type: 'highpass' as const, color: echo.color.primary },
		{ freq: lpT, resonance: lpResT, type: 'lowpass' as const, color: echo.color.primary }
	]);

	let graph = $state<HTMLElement | null>(null);
	// The curve is drawn in a box of the graph's own shape, so its dots are
	// round whatever the columns come to (a fixed 4:3 box, stretched to a
	// taller graph, drew them as ovals).
	const CURVE_SCALE = 1.6;
	let graphW = $state(0);
	let graphH = $state(0);
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

<!-- An unloaded Echo dims as one: every control here is the one device. -->
<!-- One face grid (ADR-510), ten columns of ~91px at 1366 x 1024:
     Delay 3 (Time, the filter graph over two) · LFO 4 (shapes, rate, the
     wave over its two depths) · Levels 3 (Input over Output, Feedback, Mix). -->
{#snippet knob(title: string, value: number, icon: ControlGlyphName, write: (t: number) => void, more: { valueText?: string; readout?: string; sensitivity?: number; onDown?: () => void } = {})}
	<div class="knob-cell">
		<DeviceSlider
			{value}
			{title}
			valueText={more.valueText}
			face="knob"
			knobSize="m"
			knobFit
			{icon}
			sensitivity={more.sensitivity ?? 1}
			orientation="vertical"
			isGhost={echo.isGhost}
			color={echo.color}
			readout={more.readout}
			onTap={() => echo.loadIfGhost()}
			onDown={more.onDown}
			onInteraction={write}
		/>
	</div>
{/snippet}

{#snippet levelBox(title: string, value: number, icon: ControlGlyphName, index: number)}
	<div class="col">
		<DeviceSlider
			{value}
			{title}
			{icon}
			orientation="vertical"
			isGhost={echo.isGhost}
			color={echo.color}
			readout={echo.paramDisplay(index)}
			onTap={() => echo.loadIfGhost()}
			onInteraction={(t) => echo.sendParam(index, t)}
		/>
	</div>
{/snippet}

<div class="echo-layout" class:slot-ghost={echo.isGhost}>
<FaceGrid sections={[3, 4, 3]}>
	<FaceSection span={3}>
	{#snippet head()}<PanelEyebrow title="Delay" color={echo.color.primary} />{/snippet}
	<div class="col switch-over-knob">
		<button
			class="physical-button btn-toggle echo-switch"
			class:active={synced}
			aria-pressed={synced}
			use:press={{ onPress: () => toggleSync() }}
		>
			Sync
		</button>
		{@render knob('Time', timeT, 'delay', (t) => send(ECHO.timeWrites(t, true)), { valueText: timeLabel })}
	</div>

	<div
		class="col filter-graph face-span-2"
		role="slider"
		aria-label="Filter: high-pass {Math.round(hpT * 100)}%, low-pass {Math.round(lpT * 100)}%"
		aria-valuenow={Math.round(lpT * 100)}
		tabindex="-1"
		data-echo-filter
		bind:this={graph}
		bind:clientWidth={graphW}
		bind:clientHeight={graphH}
		use:drag={{ commit: 'immediate', onDown: filterDown, onMove: (i) => writeDot(pointAt(i)) }}
	>
		<FilterCurve
			curveType="eq"
			{bands}
			filterDots={dots}
			width={graphW > 0 ? Math.round(graphW * CURVE_SCALE) : 400}
			height={graphH > 0 ? Math.round(graphH * CURVE_SCALE) : 300}
			curveColor={echo.color.primary}
		/>
		<span class="graph-title">Filter</span>
	</div>
	</FaceSection>
	<FaceSeam />

	<FaceSection span={4}>
	{#snippet head()}<PanelEyebrow title="LFO" color={echo.color.primary} />{/snippet}
	<!-- The six shapes, one tab the column's height: two columns of three. -->
	<ScrubTabs
		options={ECHO_LFO_WAVES}
		selected={lfoWave}
		onSelect={(i) => echo.sendParam(ECHO_LFO.wave, i)}
		cols={WAVE_COLS}
		label={(w) => `LFO wave ${w}`}
		name="echo-lfo-wave"
		style="--scrub-padding: 4px;"
	>
		{#snippet item(w)}{@render waveGlyph(w)}{/snippet}
	</ScrubTabs>

	<div class="col switch-over-knob" data-echo-lfo>
		<button
			class="physical-button btn-toggle echo-switch"
			class:active={lfoSynced}
			aria-pressed={lfoSynced}
			use:press={{ onPress: () => toggleLfoSync() }}
		>
			LFO Sync
		</button>
		{@render knob('Rate', lfoRate, 'rate', (t) => send([lfoRateWrite(lfoSynced, t)]), { valueText: lfoLabel })}
	</div>

	<!-- The wave as it runs (ADR-514), as many cycles as its rate, over the
	     two depths it is sent to: Time and Filter, on the face's columns. -->
	<div class="face-span-2 picture-over-knobs">
		<div class="wave-pic">
			<LfoGraph params={lfoPicture} shape={ECHO_LFO_WAVES[lfoWave]} rate="Rate" ink={echo.color.primary} interactive={false} />
		</div>
		{@render knob('LFO > Time', lfoToTime, 'lfo', (t) => echo.sendParam(ECHO_LFO.toTime, t), { readout: echo.paramDisplay(ECHO_LFO.toTime) })}
		{@render knob('LFO > Filter', lfoToFilter, 'cutoff', (t) => echo.sendParam(ECHO_LFO.toFilter, t), { readout: echo.paramDisplay(ECHO_LFO.toFilter) })}
	</div>
	</FaceSection>
	<FaceSeam />

	<FaceSection span={3}>
	{#snippet head()}<PanelEyebrow title="Levels" color={echo.color.primary} />{/snippet}
	<!-- Input over Output, set and left (Input drags Output the other way):
	     knobs. Then Feedback and Mix, the pair the Echo tile plays: boxes,
	     each the band's height (ADR-509, ADR-544). -->
	<div class="col knob-pair">
		{@render knob('Input', input, 'gain', inputMoved, { readout: echo.paramDisplay(ECHO.inputGain), sensitivity: GAIN_SENSITIVITY, onDown: inputDown })}
		{@render knob('Output', output, 'output', (t) => echo.sendParam(ECHO.outputGain, fullValue(ECHO.outputGain, t)), { readout: echo.paramDisplay(ECHO.outputGain), sensitivity: GAIN_SENSITIVITY })}
	</div>
	{@render levelBox('Feedback', feedback, 'feedback', ECHO.feedback)}
	{@render levelBox('Mix', mix, 'mix', ECHO.mix)}
	</FaceSection>
</FaceGrid>
</div>

<style>
	/* The face is the FaceGrid (ADR-510): Delay (Time, the filter graph
	   over two columns) | LFO (shapes, rate, the wave over its depths) |
	   Levels, ten equal columns. A column of ~91px holds a medium knob
	   (70px + 8) and no larger, so every knob here is medium. */
	.echo-layout {
		height: 100%;
		width: 100%;
		min-height: 0;
	}

	.col {
		display: flex;
		flex-direction: column;
		gap: var(--face-gutter);
		min-height: 0;
		min-width: 0;
		height: 100%;
	}
	.col > :global(.device-slider) {
		flex: 1 1 0;
		min-height: 0;
	}

	/* A knob's cell: an equal share of whatever stacks it. */
	.knob-cell {
		flex: 1 1 0;
		display: flex;
		min-height: 0;
		min-width: 0;
	}
	.knob-cell > :global(*) {
		flex: 1 1 0;
		min-width: 0;
	}

	/* A knob's switch: one touch row over it, the column's width (ADR-544). */
	.echo-switch {
		flex: 0 0 var(--height-touch);
		min-height: 0;
		width: 100%;
		font-size: 0.875rem;
		font-weight: var(--font-weight-medium);
	}

	/* The wave over its two depths: the face's two columns, two equal rows,
	   so the depths sit level with Output, the lower knob of the pair. */
	.picture-over-knobs {
		display: grid;
		grid-template-columns: subgrid;
		grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--face-gutter);
		min-height: 0;
		min-width: 0;
	}
	.wave-pic {
		grid-column: 1 / -1;
		min-height: 0;
		min-width: 0;
	}

	/* LFO Wave: two columns of three, a ScrubTabs. */
	.wave-glyph {
		width: 100%;
		height: 100%;
		max-height: 22px;
	}

	.filter-graph {
		position: relative;
		overflow: hidden;
		border: 1px solid var(--line-strong);
		border-radius: 2px;
		background: var(--surface-well);
		cursor: crosshair;
	}
	/* The graph's name is a label (ADR-544), not the curve's colour. */
	.graph-title {
		position: absolute;
		top: 0.5rem;
		left: 0.75rem;
		font-size: 0.8125rem;
		font-weight: var(--font-weight-medium);
		color: var(--label);
		pointer-events: none;
		user-select: none;
	}
</style>
