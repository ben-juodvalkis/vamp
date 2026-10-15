<script lang="ts">
	/**
	 * PitchCentralView — the Pitch tile's view (2026-10-15, the user's
	 * design): the pitch devices the Chorus view used to lead with, the
	 * Octave panel and Pitch Hack's Rate column ("Reverse").
	 *
	 * Self-contained: queries its own slots, takes no props, and renders
	 * through ghost/loading/active without a `{#if device}` gate.
	 */

	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import SectionDivider from '../SectionDivider.svelte';
	import OctavePanel from '../OctavePanel.svelte';
	import { drag } from '$lib/actions';
	import type { DragInfo } from '$lib/actions/drag';
	import { segmentIndex, scrubBoxOf, type ScrubBox } from '$lib/utils/segmentScrub';

	const pitchHack = useFxGridSlot('pitchHack');

	let pitchHackInk = $derived({
		primary: trackInk(pitchHack.color.primary, paintModeReactive()),
		secondary: pitchHack.color.secondary,
		accent: trackInk(pitchHack.color.accent, paintModeReactive())
	});

	// ── Pitch Hack (Creative Extensions, Max) ──────────────────────────────
	// One upright tab of Rate stops (user, 2026-10-08), drawn and scrubbed
	// like the Octave's pitch tab beside it: a tap loads the device if it is
	// not there, sets its Rate and puts Dry / Wet at full, so the device is
	// always heard once it is touched. Indices read off the running device
	// 2026-09-23: Dry / Wet is param 2 (0–100), Rate is param 5, an index
	// into its value_items: 7 = 1/16, 10 = 1/8, 13 = 1/4, 16 = 1/2, 19 = 1/1.
	// The lit stop is the one Rate matches exactly; a rate set by hand in
	// Live lights none.
	const PITCH_HACK_PARAMS = {
		mix: { index: 2, max: 100 },
		rate: { index: 5 }
	};
	const PITCH_HACK_RATES = [
		{ label: '1', rate: 19 },
		{ label: '1/2', rate: 16 },
		{ label: '1/4', rate: 13 },
		{ label: '1/8', rate: 10 },
		{ label: '1/16', rate: 7 }
	];
	let pitchHackRate = $derived(pitchHack.paramValue(PITCH_HACK_PARAMS.rate.index));
	let pitchHackStop = $derived(
		pitchHackRate === undefined ? -1 : PITCH_HACK_RATES.findIndex((r) => r.rate === Math.round(pitchHackRate!))
	);

	// On a ghost slot both writes wait for the device and the first
	// triggers its load (useFxGridSlot).
	function sendPitchHackRate(rate: number) {
		pitchHack.sendParam(PITCH_HACK_PARAMS.rate.index, rate);
		pitchHack.sendParam(PITCH_HACK_PARAMS.mix.index, PITCH_HACK_PARAMS.mix.max);
	}

	// The tab SCRUBS, like the Octave's: the stack owns one pointer and
	// resolves the stop under it from geometry, so a finger slides between
	// rates. The box is measured at press.
	let pitchHackBox: ScrubBox | null = null;

	function pitchHackScrub(clientY: number) {
		if (!pitchHackBox) return;
		const i = segmentIndex(clientY, pitchHackBox.top, pitchHackBox.height, PITCH_HACK_RATES.length);
		if (i === pitchHackStop && !pitchHack.isGhost) return;
		sendPitchHackRate(PITCH_HACK_RATES[i].rate);
	}

	function pitchHackDown(info: DragInfo) {
		pitchHackBox = scrubBoxOf(info.event?.currentTarget as Element | null);
		pitchHackScrub(info.y);
	}
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="pitch-central-layout relative">
	<div class="device-wrapper pad">
		<OctavePanel />
	</div>

	<SectionDivider orientation="vertical" ink={pitchHackInk.primary} />

	<!-- Pitch Hack, titled Reverse (user, 2026-10-08), over one tab of Rate
	     stops, 1 to 1/16 top to bottom. -->
	<div class="device-wrapper pitch-hack" style="--btn-tint: {pitchHackInk.primary};">
		<span class="column-title" style="color: {pitchHackInk.primary};">Reverse</span>
		<div
			class="device-segmented pitch-hack-rate"
			class:is-ghost-tab={pitchHack.isGhost}
			style:grid-template-rows="repeat({PITCH_HACK_RATES.length}, 1fr)"
			role="group"
			aria-label="Pitch Hack rate"
			use:drag={{
				commit: 'immediate',
				onDown: (info) => pitchHackDown(info),
				onMove: (info) => pitchHackScrub(info.y)
			}}
		>
			{#each PITCH_HACK_RATES as stop, i}
				<button
					class="device-segment rate-step num"
					class:active={!pitchHack.isGhost && pitchHackStop === i}
					aria-label="Pitch Hack rate {stop.label}"
					aria-pressed={!pitchHack.isGhost && pitchHackStop === i}
					onclick={() => sendPitchHackRate(stop.rate)}
				>{stop.label}</button>
			{/each}
		</div>
	</div>
</div>

<style>
	.pitch-central-layout {
		display: grid;
		/* octave (fader + tab) | seam | pitch hack rate tab: three equal
		   tracks across the whole view. */
		grid-template-columns: repeat(2, minmax(0, 1fr)) auto minmax(0, 1fr);
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

	.pad {
		grid-column: span 2;
	}

	.pitch-hack {
		gap: var(--spacing-sm);
	}

	/* The house eyebrow, as the Octave panel's title. */
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

	.pitch-hack-rate {
		flex: 1 1 0;
		min-height: 0;
		min-width: 0;
		display: grid;
	}

	/* The stack owns the pointer; the stops are its face. Keyboard focus
	   and Enter still activate one. */
	.rate-step {
		pointer-events: none;
		min-height: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	.is-ghost-tab {
		opacity: var(--opacity-ghost);
	}

	/* One ink per device: a lit stop takes Pitch Hack's own ink rather than
	   the house --phosphor, as Octave's column does. */
	:global([data-grammar="flat"]) .pitch-hack-rate .device-segment.active {
		background: var(--btn-tint);
		border-color: var(--btn-tint);
		color: var(--flat-on-fg);
	}
</style>
