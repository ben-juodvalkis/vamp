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
	import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';

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
	/** Every length a row can have, 2..16 (ADR-443): one cell of the tab each. */
	const LENGTHS = Array.from({ length: MAX_LENGTH - MIN_LENGTH + 1 }, (_, i) => MIN_LENGTH + i);

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
	const RATE_LABELS = rateProgression.map((r) => r.display);

	function rateIndexOf(division: number): number {
		const opt = DIVISION_OPTIONS[division];
		if (!opt) return -1;
		return rateProgression.findIndex(r => r.mode === opt.mode && r.value === opt.value);
	}
	let muteRateIndex = $derived(rateIndexOf(muteRate));
	let pitchRateIndex = $derived(rateIndexOf(pitchRate));

	/** A rate tab's pick, as the division the store writes. */
	function divisionOf(rateIndex: number): number {
		const r = rateProgression[rateIndex];
		return DIVISION_OPTIONS.findIndex(o => o.mode === r.mode && o.value === r.value);
	}

	// A ghost (no Permute yet) writes through the ghost path, which loads it.
	function setMuteLength(next: number) {
		(device ? sequencerStore.handleMuteLengthChange : sequencerStore.handleMuteLengthChangeGhost)(next);
	}
	function setPitchLength(next: number) {
		(device ? sequencerStore.handlePitchLengthChange : sequencerStore.handlePitchLengthChangeGhost)(next);
	}
	function setMuteRate(rateIndex: number) {
		const divIdx = divisionOf(rateIndex);
		if (divIdx >= 0) (device ? sequencerStore.handleMuteRateChange : sequencerStore.handleMuteRateChangeGhost)(divIdx);
	}
	function setPitchRate(rateIndex: number) {
		const divIdx = divisionOf(rateIndex);
		if (divIdx >= 0) (device ? sequencerStore.handlePitchRateChange : sequencerStore.handlePitchRateChangeGhost)(divIdx);
	}
</script>

<!--
  10 equal columns: mute-len | mute-steps | mute-rate (row 1)
                    ───────── seam ─────────
                    pitch-len | pitch-steps | pitch-rate (row 3)

  The step block is 8 columns wide whatever the length: it holds as many
  cells as the row's length, 2..16 (ADR-443), so at 16 each cell is half
  the width it has at 8. Length and rate are scrub tabs, a cell per value
  (2026-11-25; knobs from 2026-11-09): Length 2..16 three across, Rate
  8 bars..1/16 two across, each under its name.

  Two sequencers, one per row, sharing a grid. They run at their own
  lengths and their own rates and only their ink said so; the seam between
  them says it in the layout (2026-09-13).
-->
<div class="h-full w-full p-(--central-inset) grid-layout" data-permute-scope={scope?.note ?? undefined}>
	<!-- Mute length — col 1, row 1 -->
	<div class="ctrl-cell" data-layout-box style="grid-column: 1; grid-row: 1;">
		<span class="tab-name">Mute length</span>
		<ScrubTabs
			options={LENGTHS}
			selected={muteLength - MIN_LENGTH}
			onSelect={(_, n) => setMuteLength(n)}
			cols={3}
			tint={muteColor}
			ghost={!device}
			label={(n) => `Mute length ${n} steps`}
			groupLabel="Mute length"
			name="mute-length"
			style="--scrub-font-size: 1rem;"
		>
			{#snippet item(option)}{option}{/snippet}
		</ScrubTabs>
	</div>

	<!-- Mute rate — col 10, row 1 -->
	<div class="ctrl-cell" data-layout-box style="grid-column: 10; grid-row: 1;">
		<span class="tab-name">Mute rate</span>
		<ScrubTabs
			options={RATE_LABELS}
			selected={muteRateIndex}
			onSelect={(i) => setMuteRate(i)}
			cols={2}
			tint={muteColor}
			ghost={!device}
			label={(r) => `Mute rate ${r}`}
			groupLabel="Mute rate"
			name="mute-rate"
			style="--scrub-font-size: 1rem;"
		>
			{#snippet item(option)}{option}{/snippet}
		</ScrubTabs>
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
	<div class="ctrl-cell" data-layout-box style="grid-column: 1; grid-row: 3;">
		<span class="tab-name">Pitch length</span>
		<ScrubTabs
			options={LENGTHS}
			selected={pitchLength - MIN_LENGTH}
			onSelect={(_, n) => setPitchLength(n)}
			cols={3}
			tint={pitchColor}
			ghost={!device}
			label={(n) => `Pitch length ${n} steps`}
			groupLabel="Pitch length"
			name="pitch-length"
			style="--scrub-font-size: 1rem;"
		>
			{#snippet item(option)}{option}{/snippet}
		</ScrubTabs>
	</div>

	<!-- Pitch rate — col 10, row 3 -->
	<div class="ctrl-cell" data-layout-box style="grid-column: 10; grid-row: 3;">
		<span class="tab-name">Pitch rate</span>
		<ScrubTabs
			options={RATE_LABELS}
			selected={pitchRateIndex}
			onSelect={(i) => setPitchRate(i)}
			cols={2}
			tint={pitchColor}
			ghost={!device}
			label={(r) => `Pitch rate ${r}`}
			groupLabel="Pitch rate"
			name="pitch-rate"
			style="--scrub-font-size: 1rem;"
		>
			{#snippet item(option)}{option}{/snippet}
		</ScrubTabs>
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

	/* Length and rate are scrub tabs (2026-11-25), each under the name of
	   what it sets: Mute length, Pitch rate. The tab fills the cell under
	   its name. */
	.ctrl-cell {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		min-height: 0;
	}
	.ctrl-cell > :global(.scrub-tabs) {
		flex: 1 1 0;
	}
	.tab-name {
		text-align: center;
		font-size: 14px;
		font-weight: 600;
		line-height: 1.2;
		color: var(--label);
		white-space: nowrap;
	}

	/* The muted-track grey rides the palette's --signal-dim on the flat
	   skins instead of the fixed hsl literal. */
	:global([data-grammar="flat"]) .grid-layout {
		--permute-dim-ink: var(--signal-dim);
	}
</style>
