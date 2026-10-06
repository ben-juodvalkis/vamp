<script lang="ts">
	/**
	 * ChorusCentralView - Slot-Aware Version
	 *
	 * Self-contained central view that queries its own slot state.
	 * Renders immediately with ghost/loading/active states.
	 * Displays Blur, Comb, Phaser, Pitch Hack and Octave controls.
	 *
	 * Contains virtual devices (smudge, comb, phaser, pitchHack, octave) which have
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
	const pitchHack = useFxGridSlot('pitchHack');

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
	// Indices and rails read off the running device on 2026-09-23
	// (parameters.*name/min/max): 0 Device On, 1 Cents, 2 Dry / Wet 0–100,
	// 3 Coarse ±36 st, 4 Level, 5 Rate 0–23 (quantized), 6 Recycle 0–95,
	// 7 Reverse, 8 Int Var. Dry / Wet, Coarse and Recycle are Max int
	// params, so every write is rounded. Defaults are what Pitch Hack.adv
	// saves: dry, no shift, Rate 1/8, no recycle.
	// Pad: X = Rate, Y = Mix. Pitch and Recycle (titled Feedback) are
	// sliders of their own.
	const PITCH_HACK_PARAMS = {
		mix:     { index: 2, max: 100, default: 0 },
		pitch:   { index: 3, min: -36, max: 36, default: 0 },
		rate:    { index: 5, max: 23, default: 10 },
		recycle: { index: 6, max: 95, default: 0 }
	};

	// Rate's value_items on the running device, index = parameter value.
	// Identical to the patch's own parameter_enum.
	const PITCH_HACK_RATES = [
		'1/128', '1/64', '1/32T', '1/64D', '1/32', '1/16T', '1/32D', '1/16',
		'1/8T', '1/16D', '1/8', '1/4T', '1/8D', '1/4', '1/2T', '1/4D',
		'1/2', '1/1T', '1/2D', '1/1', '1/1D', '2/1', '3/1', '4/1'
	];

	let pitchHackRate = $derived(
		Math.max(0, Math.min(PITCH_HACK_PARAMS.rate.max, Math.round(
			pitchHack.paramValue(PITCH_HACK_PARAMS.rate.index) ?? PITCH_HACK_PARAMS.rate.default
		)))
	);
	let pitchHackMix = $derived(
		(pitchHack.paramValue(PITCH_HACK_PARAMS.mix.index) ?? PITCH_HACK_PARAMS.mix.default) /
			PITCH_HACK_PARAMS.mix.max
	);
	let pitchHackRecycle = $derived(
		pitchHack.paramValue(PITCH_HACK_PARAMS.recycle.index) ?? PITCH_HACK_PARAMS.recycle.default
	);
	let pitchHackPitch = $derived(
		pitchHack.paramValue(PITCH_HACK_PARAMS.pitch.index) ?? PITCH_HACK_PARAMS.pitch.default
	);
	// Pitch is three stops, not a sweep (user, 2026-10-05): -12, 0, +12,
	// left to right under the pad, written as raw Coarse semitones. The lit
	// stop is the one nearest the device's value, so a shift set by hand in
	// Live still lights the closest.
	const PITCH_HACK_STEPS = [
		{ label: '-12', value: -12 },
		{ label: '0', value: 0 },
		{ label: '+12', value: 12 }
	];
	let pitchHackStep = $derived(
		PITCH_HACK_STEPS.reduce(
			(best, step, i) =>
				Math.abs(step.value - pitchHackPitch) < Math.abs(PITCH_HACK_STEPS[best].value - pitchHackPitch) ? i : best,
			0
		)
	);

	function sendPitchHackXY(x: number, y: number) {
		const { rate, mix } = PITCH_HACK_PARAMS;
		pitchHack.sendParam(rate.index, Math.round(Math.max(0, Math.min(1, x)) * rate.max));
		pitchHack.sendParam(mix.index, Math.round(Math.max(0, Math.min(1, y)) * mix.max));
	}

	function sendPitchHackPitch(semitones: number) {
		const { index, min, max } = PITCH_HACK_PARAMS.pitch;
		pitchHack.sendParam(index, Math.max(min, Math.min(max, Math.round(semitones))));
	}

	function sendPitchHackRecycle(amount: number) {
		const { index, max } = PITCH_HACK_PARAMS.recycle;
		pitchHack.sendParam(index, Math.max(0, Math.min(max, Math.round(amount))));
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

	<!-- Pitch Hack (virtual device) — X: Rate (24 steps, the division is the
	     pad's readout), Y: Dry / Wet. The two sliders beside it are the same
	     device's Coarse shift and Recycle. -->
	<div class="device-wrapper pad">
		<BaseDeviceControl slotKey="pitchHack" device={pitchHack.device} title="Pitch Hack" disableCentralViewOnTap={true} showMoveToTop={true} showMoveToEnd={true}>
			{#snippet children({ handleTap })}
				<DeviceXY
					xValue={pitchHackRate / PITCH_HACK_PARAMS.rate.max}
					yValue={pitchHackMix}
					title="Pitch Hack"
					icon="pitchhack"
					xIcon="rate"
					yIcon="mix"
					rateLabel={PITCH_HACK_RATES[pitchHackRate]}
					isGhost={pitchHack.isGhost}
					showCurve={false}
					color={pitchHackInk}
					onTap={() => (pitchHack.isGhost ? pitchHack.loadIfGhost() : handleTap())}
					onInteraction={sendPitchHackXY}
				/>
			{/snippet}
		</BaseDeviceControl>
		<!-- Pitch: -12 / 0 / +12 across the foot of the pad, like the Pedal's
		     type switch (user, 2026-10-05). -->
		<div class="pitch-hack-row" style={pitchHack.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
			{#each PITCH_HACK_STEPS as step, i}
				<button
					class="physical-button w-full px-2 text-xs text-center font-medium"
					class:active={!pitchHack.isGhost && pitchHackStep === i}
					style="--btn-tint: {pitchHackInk.primary};"
					aria-label="Pitch Hack pitch {step.label}"
					aria-pressed={!pitchHack.isGhost && pitchHackStep === i}
					onclick={() => sendPitchHackPitch(step.value)}
				>{step.label}</button>
			{/each}
		</div>
	</div>

	<div class="device-wrapper">
		<DeviceSlider
			value={pitchHackRecycle}
			title="Feedback"
			icon="feedback"
			orientation="vertical"
			labelOrientation="horizontal"
			isGhost={pitchHack.isGhost}
			color={pitchHackInk}
			min={0}
			max={PITCH_HACK_PARAMS.recycle.max}
			onTap={() => pitchHack.loadIfGhost()}
			onInteraction={sendPitchHackRecycle}
		/>
	</div>

	<SectionDivider orientation="vertical" ink={fxInk.primary} />

	<!-- Blur's dry/wet (the `smudge` slot; virtual device - handles its own slot state) -->
	<div class="device-wrapper">
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
		<div class="stack-cell">
			<CombControl device={comb.device} icon="comb" xIcon="tune" yIcon="feedback" />
		</div>

		<SectionDivider orientation="horizontal" ink={phaserInk.primary} />

		<!-- Phaser (virtual device) — X: LFO speed, Y: feedback. Wrapped in
		     BaseDeviceControl like Blur and Comb so it carries the same
		     move-to-first / move-to-last arrows. -->
		<div class="stack-cell">
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
		/* octave | pitch hack (pad over its -12/0/+12 row) · feedback | blur
		   | comb over phaser.
		   One equal track per slider, a seam its hairline; a pad (and the
		   Octave panel, its fader and its tab) spans two tracks, so it is
		   exactly two sliders and the gap between them, and every control
		   grows with the view (user, 2026-10-05). */
		grid-template-columns:
			repeat(2, minmax(0, 1fr)) auto
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

	/* -12 · 0 · +12 under the Pitch Hack pad, one row a slider-label tall. */
	.pitch-hack-row {
		display: flex;
		flex-direction: row;
		gap: var(--spacing-xs);
		flex: 0 0 auto;
		height: 3rem;
		margin-top: var(--central-gap);
	}

	.pitch-hack-row button {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}
</style>
