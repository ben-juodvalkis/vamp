<script lang="ts">
	import { sequencerStore, DIVISION_OPTIONS } from '$lib/stores/v6/sequencerStore.svelte';
	import MuteSequencerControl from '$lib/components/v6/clips/MuteSequencerControl.svelte';
	import PitchSequencerControl from '$lib/components/v6/clips/PitchSequencerControl.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { v3Store } from '$lib/stores/v3/normalized.svelte';
	import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import { TRACK_DEFAULTS } from '$lib/components/v6/tracks/TrackStrip/utils/trackConstants';
	import SectionDivider from '../SectionDivider.svelte';
	import { readFxScope } from '../fxScope';
	import { PERMUTE_MAX_STEPS } from '$lib/config/permuteLayout';

	let device = $derived(sequencerStore.device);

	// ADR-435: under a pad scope the view is that pad's Permute — the chip
	// on the seam names it, and the mute row takes the pad's chain colour
	// (the track's when Live left the pad uncoloured), as the Drum Rack
	// view's controls do while the pad is held.
	let scope = $derived(sequencerStore.scope);
	let scopeInk = $derived(
		scope && scope.color !== null ? trackInk(rgbToHex(scope.color), paintModeReactive()) : null
	);
	// Mounted in the Drum Rack view's pane (`PadFxPane` provides the scope
	// context) the pane's own header already names the pad, so the seam
	// carries no chip there; at the top level it is the only thing that says
	// whose sequencer this is.
	const getFxScope = readFxScope();
	let inPane = $derived(getFxScope() !== null);
	let scopeLabel = $derived(scope && !inPane ? (scope.name || `Pad ${scope.note}`) : null);

	// Mute length/rate controls follow the selected track's color (greyed
	// when muted), matching the mute step row. Pitch controls keep blue.
	let selectedTrackRecord = $derived(
		session.selectedTrackIndex >= 0
			? v3Store.tracks.get(`tracks/${session.selectedTrackIndex}`)
			: undefined
	);
	// GRATICULE (§5.5): live track color calibrated through trackInk; the muted
	// branch keeps the fixed dim grey (chrome, not a live signal). The flat
	// skins re-point that grey at --signal-dim via --permute-dim-ink (set in
	// the style block); Graticule falls through to the literal unchanged.
	let muteColor = $derived(
		(selectedTrackRecord?.mute ?? false)
			? 'var(--permute-dim-ink, hsl(220 8% 55%))'
			: (scopeInk ?? trackInk(rgbToHex(selectedTrackRecord?.color ?? TRACK_DEFAULTS.color), paintModeReactive()))
	);
	// Pitch controls ride a fixed blue accent, calibrated through trackInk.
	let pitchColor = $derived(trackInk('#3869fa', paintModeReactive()));

	let muteLength = $derived(sequencerStore.muteLength);
	let muteRate = $derived(sequencerStore.muteRate);
	let pitchLength = $derived(sequencerStore.pitchLength);
	let pitchRate = $derived(sequencerStore.pitchRate);

	const MIN_LENGTH = 2;
	const MAX_LENGTH = PERMUTE_MAX_STEPS;
	const RATE_COUNT = 8;
	const LENGTH_DRAG_SENSITIVITY = 20;
	const RATE_DRAG_SENSITIVITY = 25;

	const rateProgression = [
		{ mode: 'bars', value: 8, display: '8' },
		{ mode: 'bars', value: 4, display: '4' },
		{ mode: 'bars', value: 2, display: '2' },
		{ mode: 'bars', value: 1, display: '1' },
		{ mode: '16ths', value: 8, display: '1/2' },
		{ mode: '16ths', value: 4, display: '1/4' },
		{ mode: '16ths', value: 2, display: '1/8' },
		{ mode: '16ths', value: 1, display: '1/16' },
	];

	let muteRateIndex = $derived((() => {
		const opt = DIVISION_OPTIONS[muteRate];
		if (!opt) return 0;
		return rateProgression.findIndex(r => r.mode === opt.mode && r.value === opt.value);
	})());
	let pitchRateIndex = $derived((() => {
		const opt = DIVISION_OPTIONS[pitchRate];
		if (!opt) return 0;
		return rateProgression.findIndex(r => r.mode === opt.mode && r.value === opt.value);
	})());

	let muteRateDisplay = $derived(muteRateIndex >= 0 ? rateProgression[muteRateIndex].display : '?');
	let pitchRateDisplay = $derived(pitchRateIndex >= 0 ? rateProgression[pitchRateIndex].display : '?');

	// — mute length drag —
	let isDraggingMuteLength = $state(false);
	let startMuteLengthY = $state(0);
	let startMuteLengthVal = $state(0);

	function onMuteLengthDown(e: PointerEvent) {
		e.preventDefault();
		isDraggingMuteLength = true;
		startMuteLengthY = e.clientY;
		startMuteLengthVal = muteLength;
		(e.target as Element).setPointerCapture(e.pointerId);
	}
	function onMuteLengthMove(e: PointerEvent) {
		if (!isDraggingMuteLength) return;
		e.preventDefault();
		const delta = Math.round((startMuteLengthY - e.clientY) / LENGTH_DRAG_SENSITIVITY);
		const next = Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, startMuteLengthVal + delta));
		if (next !== muteLength) (device ? sequencerStore.handleMuteLengthChange : sequencerStore.handleMuteLengthChangeGhost)(next);
	}
	function onMuteLengthUp(e: PointerEvent) {
		e.preventDefault();
		isDraggingMuteLength = false;
	}

	// — mute rate drag —
	let isDraggingMuteRate = $state(false);
	let startMuteRateY = $state(0);
	let startMuteRateIdx = $state(0);

	function onMuteRateDown(e: PointerEvent) {
		e.preventDefault();
		isDraggingMuteRate = true;
		startMuteRateY = e.clientY;
		startMuteRateIdx = muteRateIndex;
		(e.target as Element).setPointerCapture(e.pointerId);
	}
	function onMuteRateMove(e: PointerEvent) {
		if (!isDraggingMuteRate) return;
		e.preventDefault();
		const delta = Math.round((startMuteRateY - e.clientY) / RATE_DRAG_SENSITIVITY);
		const next = Math.max(0, Math.min(RATE_COUNT - 1, startMuteRateIdx + delta));
		if (next !== muteRateIndex) {
			const divIdx = DIVISION_OPTIONS.findIndex(o => o.mode === rateProgression[next].mode && o.value === rateProgression[next].value);
			if (divIdx >= 0) (device ? sequencerStore.handleMuteRateChange : sequencerStore.handleMuteRateChangeGhost)(divIdx);
		}
	}
	function onMuteRateUp(e: PointerEvent) {
		e.preventDefault();
		isDraggingMuteRate = false;
	}

	// — pitch length drag —
	let isDraggingPitchLength = $state(false);
	let startPitchLengthY = $state(0);
	let startPitchLengthVal = $state(0);

	function onPitchLengthDown(e: PointerEvent) {
		e.preventDefault();
		isDraggingPitchLength = true;
		startPitchLengthY = e.clientY;
		startPitchLengthVal = pitchLength;
		(e.target as Element).setPointerCapture(e.pointerId);
	}
	function onPitchLengthMove(e: PointerEvent) {
		if (!isDraggingPitchLength) return;
		e.preventDefault();
		const delta = Math.round((startPitchLengthY - e.clientY) / LENGTH_DRAG_SENSITIVITY);
		const next = Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, startPitchLengthVal + delta));
		if (next !== pitchLength) (device ? sequencerStore.handlePitchLengthChange : sequencerStore.handlePitchLengthChangeGhost)(next);
	}
	function onPitchLengthUp(e: PointerEvent) {
		e.preventDefault();
		isDraggingPitchLength = false;
	}

	// — pitch rate drag —
	let isDraggingPitchRate = $state(false);
	let startPitchRateY = $state(0);
	let startPitchRateIdx = $state(0);

	function onPitchRateDown(e: PointerEvent) {
		e.preventDefault();
		isDraggingPitchRate = true;
		startPitchRateY = e.clientY;
		startPitchRateIdx = pitchRateIndex;
		(e.target as Element).setPointerCapture(e.pointerId);
	}
	function onPitchRateMove(e: PointerEvent) {
		if (!isDraggingPitchRate) return;
		e.preventDefault();
		const delta = Math.round((startPitchRateY - e.clientY) / RATE_DRAG_SENSITIVITY);
		const next = Math.max(0, Math.min(RATE_COUNT - 1, startPitchRateIdx + delta));
		if (next !== pitchRateIndex) {
			const divIdx = DIVISION_OPTIONS.findIndex(o => o.mode === rateProgression[next].mode && o.value === rateProgression[next].value);
			if (divIdx >= 0) (device ? sequencerStore.handlePitchRateChange : sequencerStore.handlePitchRateChangeGhost)(divIdx);
		}
	}
	function onPitchRateUp(e: PointerEvent) {
		e.preventDefault();
		isDraggingPitchRate = false;
	}
</script>

<!--
  10 equal columns: mute-len | mute-steps | mute-rate (row 1)
                    ───────── seam ─────────
                    pitch-len | pitch-steps | pitch-rate (row 3)

  The step block is 8 columns wide whatever the length: it holds as many
  cells as the row's length, 2..16 (ADR-443), so at 16 each cell is half
  the width it has at 8. The length cell's fill is length / 16 — the
  default 8 reads half full, which is the headroom it has.

  Two sequencers, one per row, sharing a grid. They run at their own
  lengths and their own rates and only their ink said so; the seam between
  them says it in the layout (2026-09-13).
-->
<div class="h-full w-full p-(--central-inset) grid-layout" data-permute-scope={scope?.note ?? undefined}>
	<!-- Mute length — col 1, row 1 -->
	<div
		class="ctrl-cell cursor-ns-resize select-none"
		style="--cell-ink: {muteColor}; grid-column: 1; grid-row: 1;"
		onpointerdown={onMuteLengthDown}
		onpointermove={onMuteLengthMove}
		onpointerup={onMuteLengthUp}
		onpointercancel={onMuteLengthUp}
		title="Mute length: {muteLength} steps"
		role="slider" aria-valuemin={MIN_LENGTH} aria-valuemax={MAX_LENGTH} aria-valuenow={muteLength} tabindex="0"
	>
		<div class="fill" style="height: {(muteLength / MAX_LENGTH) * 100}%"></div>
		<span class="label">{muteLength}</span>
	</div>

	<!-- Mute rate — col 10, row 1 -->
	<div
		class="ctrl-cell cursor-ns-resize select-none"
		style="--cell-ink: {muteColor}; grid-column: 10; grid-row: 1;"
		onpointerdown={onMuteRateDown}
		onpointermove={onMuteRateMove}
		onpointerup={onMuteRateUp}
		onpointercancel={onMuteRateUp}
		title="Mute rate"
		role="slider" aria-valuemin={0} aria-valuemax={RATE_COUNT - 1} aria-valuenow={muteRateIndex} tabindex="0"
	>
		<div class="fill" style="height: {(muteRateIndex / (RATE_COUNT - 1)) * 100}%"></div>
		<span class="label">{muteRateDisplay}</span>
	</div>

	<!-- Mute steps — cols 2-9, row 1 -->
	<div class="grid-mute-steps">
		<MuteSequencerControl showLengthSlider={false} showRateSlider={false} />
	</div>

	<div class="permute-seam">
		{#if scopeLabel !== null}
			<!-- Whose sequencer this is (ADR-435): the held pad, in its ink. -->
			<span class="scope-chip" style="--chip-ink: {muteColor};">{scopeLabel}</span>
		{/if}
		<SectionDivider orientation="horizontal" />
	</div>

	<!-- Pitch length — col 1, row 3 -->
	<div
		class="ctrl-cell cursor-ns-resize select-none"
		style="--cell-ink: {pitchColor}; grid-column: 1; grid-row: 3;"
		onpointerdown={onPitchLengthDown}
		onpointermove={onPitchLengthMove}
		onpointerup={onPitchLengthUp}
		onpointercancel={onPitchLengthUp}
		title="Pitch length: {pitchLength} steps"
		role="slider" aria-valuemin={MIN_LENGTH} aria-valuemax={MAX_LENGTH} aria-valuenow={pitchLength} tabindex="0"
	>
		<div class="fill" style="height: {(pitchLength / MAX_LENGTH) * 100}%"></div>
		<span class="label">{pitchLength}</span>
	</div>

	<!-- Pitch rate — col 10, row 3 -->
	<div
		class="ctrl-cell cursor-ns-resize select-none"
		style="--cell-ink: {pitchColor}; grid-column: 10; grid-row: 3;"
		onpointerdown={onPitchRateDown}
		onpointermove={onPitchRateMove}
		onpointerup={onPitchRateUp}
		onpointercancel={onPitchRateUp}
		title="Pitch rate"
		role="slider" aria-valuemin={0} aria-valuemax={RATE_COUNT - 1} aria-valuenow={pitchRateIndex} tabindex="0"
	>
		<div class="fill" style="height: {(pitchRateIndex / (RATE_COUNT - 1)) * 100}%"></div>
		<span class="label">{pitchRateDisplay}</span>
	</div>

	<!-- Pitch steps — cols 2-9, row 2 -->
	<div class="grid-pitch-steps">
		<PitchSequencerControl showLengthSlider={false} showRateSlider={false} />
	</div>
</div>

<style>
	.grid-layout {
		display: grid;
		grid-template-columns: repeat(10, 1fr);
		/* mute row | seam | pitch row */
		grid-template-rows: 1fr auto 1fr;
		gap: var(--central-gap);
	}

	/* The seam spans the whole ruler, so it separates the two sequencers
	   rather than only their step blocks. */
	.permute-seam {
		grid-column: 1 / -1;
		grid-row: 2;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	/* The pad's name on the seam while the view is a pad's (ADR-435): a
	   small outlined chip in the mute row's ink, the way the FX grid's
	   scope chip names the pad it is scoped to. */
	.scope-chip {
		flex: 0 0 auto;
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: var(--font-weight-medium);
		letter-spacing: 0.04em;
		line-height: 1;
		padding: 3px 8px;
		border: 1px solid var(--chip-ink);
		border-radius: 999px;
		color: var(--chip-ink);
		white-space: nowrap;
	}

	/* col 1=length, 2-9=steps, 10=rate */
	.grid-mute-steps {
		grid-column: 2 / 10;
		grid-row: 1;
	}

	.grid-pitch-steps {
		grid-column: 2 / 10;
		grid-row: 3;
	}

	/* --cell-ink is set at the call site (mute / pitch colour); the 70%
	   frame + fill mixes used to sit inline on each cell — lifted here so
	   the flat grammar can re-read them without !important. */
	.ctrl-cell {
		position: relative;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid;
		border-color: color-mix(in srgb, var(--cell-ink), transparent 30%);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--background), transparent 50%);
	}

	.ctrl-cell .fill {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: color-mix(in srgb, var(--cell-ink), transparent 30%);
		transition: height 0.15s;
		pointer-events: none;
	}

	.ctrl-cell .label {
		position: relative;
		z-index: 10;
		font-size: 1rem;
		font-weight: 700;
		color: var(--foreground);
	}

	/* ---- Live skin: length / rate cells are ControlBackground fields in a
	   1px dark frame (no background wash, no ink-mix frame) with a SOLID value
	   fill and a medium-weight readout; the muted-track grey rides the
	   palette's --signal-dim instead of the fixed hsl literal. --cell-ink is
	   the same ink the Graticule rules mix from, so the fill can go solid
	   here without touching Graticule. */
	:global([data-grammar="flat"]) .grid-layout {
		--permute-dim-ink: var(--signal-dim);
	}
	:global([data-grammar="flat"]) .ctrl-cell {
		background: var(--surface-well);
		border-color: var(--line-strong);
	}
	:global([data-grammar="flat"]) .ctrl-cell .fill {
		background-color: var(--cell-ink); /* 70% wash → solid */
	}
	:global([data-grammar="flat"]) .ctrl-cell .label {
		font-weight: var(--font-weight-medium);
	}
</style>
