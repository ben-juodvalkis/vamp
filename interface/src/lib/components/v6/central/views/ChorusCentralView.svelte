<script lang="ts">
	/**
	 * ChorusCentralView - Slot-Aware Version
	 *
	 * Self-contained central view that queries its own slot state.
	 * Renders immediately with ghost/loading/active states.
	 * Displays Smudge, Comb, Comb LFO, Phaser and Pitch Hack controls.
	 *
	 * Contains virtual devices (smudge, comb, phaser, pitchHack) which have
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

	// Initial UI state before the first param echo lands. This was a lookup
	// into data/device-configs.json with 0.5 as the `?? fallback` — but that
	// file's AuPluginDevice:Zebrify entry only carries params 1-3, so param 4
	// missed and the fallback was the only value it ever produced.
	const lfoParam1Default = 0.5;
	const lfoParam2Default = 0.5;

	let lfoParam1 = $derived(comb.paramValue(4) ?? lfoParam1Default);
	let lfoParam2 = $derived(((comb.paramValue(5) ?? lfoParam2Default) - 0.5) * 2);

	// Y-axis maps the 0-1 UI range to the device's 0.5-1 parameter range.
	function mapYToParam(yValue: number): number {
		return 0.5 + (yValue * 0.5);
	}

	// ── Phaser (Phaser-Flanger) ────────────────────────────────────────────
	// X = LFO speed (param 3), Y = feedback (param 25). Both indices and
	// both ranges were read off the shipped preset
	// (Effect Patches/Phaser.adv → PhaserNew, each parameter's
	// MidiControllerRange), not from device docs: Speed is 0.01–40 Hz in
	// Live's own units and Feedback tops out at 0.99, so neither axis is a
	// pass-through the way the Comb LFO's AU params are.
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
	// Pad: X = Rate, Y = Recycle. Pitch and Mix are sliders of their own —
	// Mix was on Y with Recycle at first; the user split it out (2026-09-23).
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
	let pitchHackRecycle = $derived(
		(pitchHack.paramValue(PITCH_HACK_PARAMS.recycle.index) ?? PITCH_HACK_PARAMS.recycle.default) /
			PITCH_HACK_PARAMS.recycle.max
	);
	let pitchHackMix = $derived(
		pitchHack.paramValue(PITCH_HACK_PARAMS.mix.index) ?? PITCH_HACK_PARAMS.mix.default
	);
	let pitchHackPitch = $derived(
		pitchHack.paramValue(PITCH_HACK_PARAMS.pitch.index) ?? PITCH_HACK_PARAMS.pitch.default
	);
	let pitchHackPitchLabel = $derived.by(() => {
		const n = Math.round(pitchHackPitch);
		return n === 0 ? 'Pitch 0' : `Pitch ${n > 0 ? '+' : ''}${n}`;
	});

	function sendPitchHackXY(x: number, y: number) {
		const { rate, recycle } = PITCH_HACK_PARAMS;
		pitchHack.sendParam(rate.index, Math.round(Math.max(0, Math.min(1, x)) * rate.max));
		pitchHack.sendParam(recycle.index, Math.round(Math.max(0, Math.min(1, y)) * recycle.max));
	}

	function sendPitchHackPitch(semitones: number) {
		const { index, min, max } = PITCH_HACK_PARAMS.pitch;
		pitchHack.sendParam(index, Math.max(min, Math.min(max, Math.round(semitones))));
	}

	function sendPitchHackMix(percent: number) {
		const { index, max } = PITCH_HACK_PARAMS.mix;
		pitchHack.sendParam(index, Math.max(0, Math.min(max, Math.round(percent))));
	}
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="chorus-central-layout relative">
	<!-- Smudge Control (virtual device - handles its own slot state) -->
	<div class="device-wrapper">
		<SmudgeControl device={smudge.device} />
	</div>

	<!-- Seams fall on the DEVICE boundaries, not between every pad: Smudge |
	     Comb + its LFO | Phaser. The four pads are the same size and three
	     wear the same ink, so without them the two Comb pads read as two
	     devices and the Phaser as a third Comb (2026-09-13, ADR-433). -->
	<SectionDivider orientation="vertical" ink={fxInk.primary} />

	<!-- Main Comb Control (virtual device - handles its own slot state) -->
	<div class="device-wrapper">
		<CombControl device={comb.device} />
	</div>

	<!-- Comb LFO Control (additional parameters) -->
	<div class="device-wrapper">
		<DeviceXY
			xValue={lfoParam1}
			yValue={lfoParam2}
			title="Comb LFO"
			isGhost={comb.isGhost}
			showCurve={false}
			color={fxInk}
			onTap={() => comb.loadIfGhost()}
			onInteraction={(x, y) => {
				comb.sendParam(4, x);
				comb.sendParam(5, mapYToParam(y));
			}}
		/>
	</div>

	<SectionDivider orientation="vertical" ink={phaserInk.primary} />

	<!-- Phaser (virtual device) — X: LFO speed, Y: feedback. Wrapped in
	     BaseDeviceControl like Smudge and Comb so it carries the same
	     move-to-first / move-to-last arrows. -->
	<div class="device-wrapper">
		<BaseDeviceControl slotKey="phaser" device={phaser.device} title="Phaser" disableCentralViewOnTap={true} showMoveToTop={true} showMoveToEnd={true}>
			{#snippet children({ handleTap })}
				<DeviceXY
					xValue={phaserSpeed}
					yValue={phaserFeedback}
					title="Phaser"
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

	<SectionDivider orientation="vertical" ink={pitchHackInk.primary} />

	<!-- Pitch Hack (virtual device) — X: Rate (24 steps, the division is the
	     pad's readout), Y: Recycle. The two sliders beside it are the same
	     device's Coarse shift and Dry / Wet. -->
	<div class="device-wrapper">
		<BaseDeviceControl slotKey="pitchHack" device={pitchHack.device} title="Pitch Hack" disableCentralViewOnTap={true} showMoveToTop={true} showMoveToEnd={true}>
			{#snippet children({ handleTap })}
				<DeviceXY
					xValue={pitchHackRate / PITCH_HACK_PARAMS.rate.max}
					yValue={pitchHackRecycle}
					title="Pitch Hack"
					rateLabel={PITCH_HACK_RATES[pitchHackRate]}
					isGhost={pitchHack.isGhost}
					showCurve={false}
					color={pitchHackInk}
					onTap={() => (pitchHack.isGhost ? pitchHack.loadIfGhost() : handleTap())}
					onInteraction={sendPitchHackXY}
				/>
			{/snippet}
		</BaseDeviceControl>
	</div>

	<div class="device-wrapper">
		<DeviceSlider
			value={pitchHackPitch}
			title={pitchHackPitchLabel}
			orientation="vertical"
			labelOrientation="horizontal"
			isGhost={pitchHack.isGhost}
			color={pitchHackInk}
			min={PITCH_HACK_PARAMS.pitch.min}
			max={PITCH_HACK_PARAMS.pitch.max}
			centerOrigin={true}
			centerValue={0}
			onTap={() => pitchHack.loadIfGhost()}
			onInteraction={sendPitchHackPitch}
		/>
	</div>

	<div class="device-wrapper">
		<DeviceSlider
			value={pitchHackMix}
			title="Mix"
			orientation="vertical"
			labelOrientation="horizontal"
			isGhost={pitchHack.isGhost}
			color={pitchHackInk}
			min={0}
			max={PITCH_HACK_PARAMS.mix.max}
			onTap={() => pitchHack.loadIfGhost()}
			onInteraction={sendPitchHackMix}
		/>
	</div>

</div>

<style>
	.chorus-central-layout {
		display: grid;
		/* smudge | comb · comb LFO | phaser | pitch hack · pitch · mix.
		   Each seam is an `auto` track as wide as its hairline, so the five
		   pads still share the rest evenly; each slider is a third of a pad. */
		grid-template-columns: 1fr auto 1fr 1fr auto 1fr auto 1fr 0.35fr 0.35fr;
		height: 100%;
		width: 100%;
		padding: var(--central-inset);
		gap: var(--central-gap);
	}

	.device-wrapper {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
</style>
