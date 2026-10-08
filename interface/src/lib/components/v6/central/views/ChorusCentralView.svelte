<script lang="ts">
	/**
	 * ChorusCentralView - Slot-Aware Version
	 *
	 * Self-contained central view that queries its own slot state.
	 * Renders immediately with ghost/loading/active states.
	 * Displays Octave, Pitch Hack, GlitchLoop, Blur, Comb and Phaser controls.
	 *
	 * Contains virtual devices (smudge, comb, phaser, pitchHack, glitchLoop, octave) which have
	 * their own ghost states.
	 * NO {#if device} gate - always renders, handles its own state.
	 * NO props required - queries selectedTrackStore directly.
	 */

	import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import SmudgeControl from '../../device-panel/SmudgeControl.svelte';
	import CombControl from '../../device-panel/CombControl.svelte';
	import BaseDeviceControl from '../../device-panel/BaseDeviceControl.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import SectionDivider from '../SectionDivider.svelte';
	import OctavePanel from '../OctavePanel.svelte';
	import { drag } from '$lib/actions';
	import type { DragInfo } from '$lib/actions/drag';
	import { segmentIndex, scrubBoxOf, type ScrubBox } from '$lib/utils/segmentScrub';
	// What each control does, at a glance (user, 2026-10-06): ControlGlyph's
	// drawn marks.

	const fx = useFxGridSlot('chorus');
	const comb = useFxGridSlot('comb');
	const smudge = useFxGridSlot('smudge');
	const phaser = useFxGridSlot('phaser');
	const pitchHack = useFxGridSlot('pitchHack');
	const glitchLoop = useFxGridSlot('glitchLoop');

	// GRATICULE (§5.5): calibrate the slot palette through trackInk at injection.
	let fxInk = $derived({
		primary: trackInk(fx.color.primary, paintModeReactive()),
		secondary: fx.color.secondary,
		accent: trackInk(fx.color.accent, paintModeReactive())
	});
	let phaserInk = $derived({
		primary: trackInk(phaser.color.primary, paintModeReactive()),
		secondary: phaser.color.secondary,
		accent: trackInk(phaser.color.accent, paintModeReactive())
	});
	let pitchHackInk = $derived({
		primary: trackInk(pitchHack.color.primary, paintModeReactive()),
		secondary: pitchHack.color.secondary,
		accent: trackInk(pitchHack.color.accent, paintModeReactive())
	});
	let glitchLoopInk = $derived({
		primary: trackInk(glitchLoop.color.primary, paintModeReactive()),
		secondary: glitchLoop.color.secondary,
		accent: trackInk(glitchLoop.color.accent, paintModeReactive())
	});

	// ── Phaser (Phaser-Flanger) ────────────────────────────────────────────
	// X = LFO speed (param 3), Y = feedback (param 25). Both indices and
	// both ranges were read off the shipped preset
	// (Effect Patches/Phaser.adv → PhaserNew, each parameter's
	// MidiControllerRange), not from device docs: Speed is 0.01–40 Hz in
	// Live's own units and Feedback tops out at 0.99, so neither axis is a
	// pass-through.
	const PHASER_PARAMS = {
		speed:    { index: 3,  min: 0.01, max: 40,   default: 0.1486274302 },
		feedback: { index: 25, min: 0,    max: 0.99, default: 0 }
	};

	// Speed is exponential: a linear pad would put 20 Hz at centre and bury
	// every usable sweep rate in the leftmost sliver. 0.01·4000^x lands the
	// classic 0.05–5 Hz range across the middle ~55% of the pad.
	const SPEED_RATIO = PHASER_PARAMS.speed.max / PHASER_PARAMS.speed.min; // 4000

	function normalizedToSpeed(normalized: number): number {
		const clamped = Math.max(0, Math.min(1, normalized));
		return PHASER_PARAMS.speed.min * Math.pow(SPEED_RATIO, clamped);
	}

	function speedToNormalized(speed: number): number {
		const clamped = Math.max(PHASER_PARAMS.speed.min, Math.min(PHASER_PARAMS.speed.max, speed));
		return Math.log(clamped / PHASER_PARAMS.speed.min) / Math.log(SPEED_RATIO);
	}

	function normalizedToFeedback(normalized: number): number {
		const clamped = Math.max(0, Math.min(1, normalized));
		return PHASER_PARAMS.feedback.min +
			clamped * (PHASER_PARAMS.feedback.max - PHASER_PARAMS.feedback.min);
	}

	function feedbackToNormalized(feedback: number): number {
		return (feedback - PHASER_PARAMS.feedback.min) /
			(PHASER_PARAMS.feedback.max - PHASER_PARAMS.feedback.min);
	}

	let phaserSpeed = $derived(
		speedToNormalized(phaser.paramValue(PHASER_PARAMS.speed.index) ?? PHASER_PARAMS.speed.default)
	);
	let phaserFeedback = $derived(
		feedbackToNormalized(
			phaser.paramValue(PHASER_PARAMS.feedback.index) ?? PHASER_PARAMS.feedback.default
		)
	);

	// ── Pitch Hack (Creative Extensions, Max) ──────────────────────────────
	// Back 2026-10-08 as one upright tab of Rate stops (user), drawn and
	// scrubbed like the Octave's pitch tab beside it: a tap
	// loads the device if it is not there, sets its Rate and puts Dry / Wet
	// at full, so the device is always heard once it is touched. Indices read
	// off the running device 2026-09-23: Dry / Wet is param 2 (0–100), Rate
	// is param 5, an index into its value_items:
	// 7 = 1/16, 10 = 1/8, 13 = 1/4, 16 = 1/2, 19 = 1/1.
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

	// ── GlitchLoop (the owner's PitchLoop89 build, Max) ────────────────────
	// Took Pitch Hack's place 2026-10-06; one slider for now, more to come.
	// Dry/Wet is param 7, 0–100, read off the running device by the user
	// (2026-10-06). The device opens at 50, PitchLoop89's own default, but
	// an unloaded slot draws 0, the user's call (2026-10-06): an empty slot
	// adds nothing. Feedback is param 9, the left channel's (Feedback L,
	// 0–120 %; Live lists the device's parameters by long name, so R is 10),
	// named by the user 2026-10-07; unloaded, it draws 0 the same way.
	const GLITCH_LOOP_PARAMS = {
		mix: { index: 7, max: 100, default: 0 },
		feedback: { index: 9, max: 120, default: 0 },
		pitchLeft: { index: 5, default: 0 },
		pitchRight: { index: 6, default: 0 }
	};

	// Pitch: Off · Up · Spread (user, 2026-10-07), written to Pitch L and
	// Pitch R (params 5 and 6, ±24 st, integers) as raw semitones. The lit
	// mode is the one both values match exactly; a pitch set by hand in
	// Live lights none.
	// Top to bottom, like Octave's column: Up, Spread, Off.
	const GLITCH_PITCH_MODES = [
		{ label: 'Up', left: 12, right: 12 },
		{ label: 'Spread', left: -12, right: 12 },
		{ label: 'Off', left: 0, right: 0 }
	];
	let glitchPitchLeft = $derived(
		Math.round(glitchLoop.paramValue(GLITCH_LOOP_PARAMS.pitchLeft.index) ?? GLITCH_LOOP_PARAMS.pitchLeft.default)
	);
	let glitchPitchRight = $derived(
		Math.round(glitchLoop.paramValue(GLITCH_LOOP_PARAMS.pitchRight.index) ?? GLITCH_LOOP_PARAMS.pitchRight.default)
	);
	let glitchPitchMode = $derived(
		GLITCH_PITCH_MODES.findIndex((m) => m.left === glitchPitchLeft && m.right === glitchPitchRight)
	);

	function sendGlitchPitchMode(mode: (typeof GLITCH_PITCH_MODES)[number]) {
		glitchLoop.sendParam(GLITCH_LOOP_PARAMS.pitchLeft.index, mode.left);
		glitchLoop.sendParam(GLITCH_LOOP_PARAMS.pitchRight.index, mode.right);
	}

	let glitchLoopMix = $derived(
		glitchLoop.paramValue(GLITCH_LOOP_PARAMS.mix.index) ?? GLITCH_LOOP_PARAMS.mix.default
	);

	let glitchLoopFeedback = $derived(
		glitchLoop.paramValue(GLITCH_LOOP_PARAMS.feedback.index) ?? GLITCH_LOOP_PARAMS.feedback.default
	);

	function sendGlitchLoopMix(amount: number) {
		const { index, max } = GLITCH_LOOP_PARAMS.mix;
		glitchLoop.sendParam(index, Math.max(0, Math.min(max, amount)));
	}

	function sendGlitchLoopFeedback(amount: number) {
		const { index, max } = GLITCH_LOOP_PARAMS.feedback;
		glitchLoop.sendParam(index, Math.max(0, Math.min(max, amount)));
	}
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="chorus-central-layout relative">
	<!-- Octave (Polyphonic Pitch Shifter), moved here from the Guitar view
	     2026-10-05: the pitch devices (Octave, then Pitch Hack) lead the view. -->
	<div class="device-wrapper pad">
		<OctavePanel />
	</div>

	<SectionDivider orientation="vertical" ink={pitchHackInk.primary} />

	<!-- Pitch Hack (virtual device): its title over one tab of Rate stops,
	     1 to 1/16 top to bottom, the Octave's tab beside it as the model; a
	     tap loads it and opens its mix (2026-10-08). -->
	<div class="device-wrapper pitch-hack" style="--btn-tint: {pitchHackInk.primary};">
		<span class="column-title" style="color: {pitchHackInk.primary};">Pitch Hack</span>
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

	<SectionDivider orientation="vertical" ink={glitchLoopInk.primary} />

	<!-- GlitchLoop (virtual device): its Dry/Wet and Feedback, then its
	     Up · Spread · Off pitch column, in Pitch Hack's old place
	     (2026-10-06). -->
	<div class="glitch-group" class:slot-ghost={glitchLoop.isGhost}>
		<div class="glitch-sliders">
			<div class="device-wrapper">
				<DeviceSlider
					value={glitchLoopMix}
					title="GlitchLoop"
					icon="mix"
					orientation="vertical"
					labelOrientation="horizontal"
					isGhost={glitchLoop.isGhost}
					color={glitchLoopInk}
					min={0}
					max={GLITCH_LOOP_PARAMS.mix.max}
					onTap={() => glitchLoop.loadIfGhost()}
					onInteraction={sendGlitchLoopMix}
				/>
			</div>
			<div class="device-wrapper">
				<DeviceSlider
					value={glitchLoopFeedback}
					title="Feedback"
					icon="feedback"
					orientation="vertical"
					labelOrientation="horizontal"
					isGhost={glitchLoop.isGhost}
					color={glitchLoopInk}
					min={0}
					max={GLITCH_LOOP_PARAMS.feedback.max}
					onTap={() => glitchLoop.loadIfGhost()}
					onInteraction={sendGlitchLoopFeedback}
				/>
			</div>
		</div>
		<div
			class="device-segmented glitch-pitch"
			style:grid-template-rows="repeat({GLITCH_PITCH_MODES.length}, 1fr)"
			style="--btn-tint: {glitchLoopInk.primary};"
			role="group"
			aria-label="GlitchLoop pitch"
		>
			{#each GLITCH_PITCH_MODES as mode, i}
				<button
					class="device-segment text-sm font-medium"
					class:active={!glitchLoop.isGhost && glitchPitchMode === i}
					aria-label="GlitchLoop pitch {mode.label}"
					aria-pressed={!glitchLoop.isGhost && glitchPitchMode === i}
					onclick={() => (glitchLoop.isGhost ? glitchLoop.loadIfGhost() : sendGlitchPitchMode(mode))}
				>{mode.label}</button>
			{/each}
		</div>
	</div>

	<SectionDivider orientation="vertical" ink={fxInk.primary} />

	<!-- Blur's dry/wet (the `smudge` slot; virtual device - handles its own slot state) -->
	<div class="device-wrapper" class:slot-ghost={smudge.isGhost}>
		<SmudgeControl device={smudge.device} icon="blur" />
	</div>

	<!-- Seams fall on the DEVICE boundaries: Blur | Comb | Phaser. The pads
	     are the same size and two wear the same ink, so without them the
	     Phaser reads as a second Comb (2026-09-13, ADR-433). -->
	<SectionDivider orientation="vertical" ink={fxInk.primary} />

	<!-- Comb over Phaser, one pad-wide column, each half its height
	     (user, 2026-10-05); a horizontal seam between the two devices. -->
	<div class="device-wrapper pad pad-stack">
		<!-- Comb (virtual device - handles its own slot state). The Zebrify
		     preset's second pad, "Comb LFO", went with the plug-in (2026-10-05):
		     the Max device has no LFO. -->
		<div class="stack-cell" class:slot-ghost={comb.isGhost}>
			<CombControl device={comb.device} icon="comb" />
		</div>

		<SectionDivider orientation="horizontal" ink={phaserInk.primary} />

		<!-- Phaser (virtual device) — X: LFO speed, Y: feedback. Wrapped in
		     BaseDeviceControl like Blur and Comb so it carries the same
		     move-to-first / move-to-last arrows. -->
		<div class="stack-cell" class:slot-ghost={phaser.isGhost}>
			<BaseDeviceControl slotKey="phaser" device={phaser.device} title="Phaser" disableCentralViewOnTap={true} showMoveToTop={true} showMoveToEnd={true}>
				{#snippet children({ handleTap })}
					<DeviceXY
						xValue={phaserSpeed}
						yValue={phaserFeedback}
						title="Phaser"
						icon="phaser"
						isGhost={phaser.isGhost}
						showCurve={false}
						color={phaserInk}
						onTap={() => (phaser.isGhost ? phaser.loadIfGhost() : handleTap())}
						onInteraction={(x, y) => {
							phaser.sendParam(PHASER_PARAMS.speed.index, normalizedToSpeed(x));
							phaser.sendParam(PHASER_PARAMS.feedback.index, normalizedToFeedback(y));
						}}
					/>
				{/snippet}
			</BaseDeviceControl>
		</div>
	</div>

</div>

<style>
	.chorus-central-layout {
		display: grid;
		/* octave | pitch hack rate tab | glitchloop mix · feedback · pitch column | blur
		   | comb over phaser.
		   One equal track per slider, a seam its hairline; a pad (and the
		   Octave panel, its fader and its tab) spans two tracks, so it is
		   exactly two sliders and the gap between them, and every control
		   grows with the view (user, 2026-10-05). */
		grid-template-columns:
			repeat(2, minmax(0, 1fr)) auto
			minmax(0, 1fr) auto
			repeat(3, minmax(0, 1fr)) auto
			minmax(0, 1fr) auto
			repeat(2, minmax(0, 1fr));
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

	.pad-stack {
		gap: var(--central-gap);
	}

	.stack-cell {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}


	/* GlitchLoop: two sliders and the pitch column, a track each. */
	.glitch-group {
		grid-column: span 3;
		display: grid;
		grid-template-columns: subgrid;
		min-height: 0;
		min-width: 0;
	}

	.glitch-sliders {
		grid-column: span 2;
		min-height: 0;
		display: grid;
		grid-template-columns: subgrid;
	}

	/* The house segmented control upright, like Octave's pitch column. */
	.glitch-pitch {
		display: grid;
		min-height: 0;
		min-width: 0;
	}

	/* One ink per device: a lit mode takes GlitchLoop's own ink rather than
	   the house --phosphor, as Octave's column does. */
	:global([data-grammar="flat"]) .glitch-pitch .device-segment.active,
	:global([data-grammar="flat"]) .pitch-hack-rate .device-segment.active {
		background: var(--btn-tint);
		border-color: var(--btn-tint);
		color: var(--flat-on-fg);
	}

	/* Pitch Hack: the Octave panel's title row and tab, one track wide. */
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
</style>
