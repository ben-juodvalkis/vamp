<script lang="ts">
	/**
	 * ChorusCentralView - Slot-Aware Version
	 *
	 * Self-contained central view that queries its own slot state.
	 * Renders immediately with ghost/loading/active states.
	 * Displays Octave, GlitchLoop, Blur, Comb and Phaser controls.
	 *
	 * Contains virtual devices (smudge, comb, phaser, glitchLoop, octave) which have
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
	// What each control does, at a glance (user, 2026-10-06): ControlGlyph's
	// drawn marks. A pad also marks its axes, X bottom-right, Y top-left.

	const fx = useFxGridSlot('chorus');
	const comb = useFxGridSlot('comb');
	const smudge = useFxGridSlot('smudge');
	const phaser = useFxGridSlot('phaser');
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
		feedback: { index: 9, max: 120, default: 0 }
	};

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

	<SectionDivider orientation="vertical" ink={glitchLoopInk.primary} />

	<!-- GlitchLoop (virtual device): its Dry/Wet and Feedback, in Pitch
	     Hack's old place (2026-10-06). -->
	<div class="device-wrapper" class:slot-ghost={glitchLoop.isGhost}>
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

	<div class="device-wrapper" class:slot-ghost={glitchLoop.isGhost}>
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
			<CombControl device={comb.device} icon="comb" xIcon="tune" yIcon="feedback" />
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
						xIcon="rate"
						yIcon="feedback"
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
		/* octave | glitchloop mix · feedback | blur | comb over phaser.
		   One equal track per slider, a seam its hairline; a pad (and the
		   Octave panel, its fader and its tab) spans two tracks, so it is
		   exactly two sliders and the gap between them, and every control
		   grows with the view (user, 2026-10-05). */
		grid-template-columns:
			repeat(2, minmax(0, 1fr)) auto
			repeat(2, minmax(0, 1fr)) auto
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

</style>
