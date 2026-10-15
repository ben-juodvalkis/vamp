<script lang="ts">
	/**
	 * ChorusCentralView - Slot-Aware Version
	 *
	 * Self-contained central view that queries its own slot state.
	 * Renders immediately with ghost/loading/active states.
	 * Displays Blur, Comb and Phaser controls. Octave and Pitch Hack moved
	 * to the Pitch view, GlitchLoop to the Glitch view (2026-10-15).
	 *
	 * Contains virtual devices (smudge, comb, phaser) which have their own
	 * ghost states.
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
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="chorus-central-layout relative">
	<!-- Blur's dry/wet (the `smudge` slot; virtual device - handles its own slot state) -->
	<div class="device-wrapper" class:slot-ghost={smudge.isGhost}>
		<SmudgeControl device={smudge.device} icon="blur" />
	</div>

	<!-- Seams fall on the DEVICE boundaries: Blur | Comb | Phaser. The pads
	     are the same size and two wear the same ink, so without them the
	     Phaser reads as a second Comb (2026-09-13, ADR-433). -->
	<SectionDivider orientation="vertical" ink={fxInk.primary} />

	<!-- Comb, then Phaser, side by side since 2026-10-15: stacked (user,
	     2026-10-05) while the view also held the pitch devices, which moved to
	     the Pitch and Glitch views. -->
	<div class="device-wrapper pad">
		<!-- Comb (virtual device - handles its own slot state). The Zebrify
		     preset's second pad, "Comb LFO", went with the plug-in (2026-10-05):
		     the Max device has no LFO. -->
		<div class="stack-cell" class:slot-ghost={comb.isGhost}>
			<CombControl device={comb.device} icon="comb" />
		</div>

	</div>

	<SectionDivider orientation="vertical" ink={phaserInk.primary} />

	<div class="device-wrapper pad">
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
		/* blur | comb | phaser, one track per slider, a seam its hairline, a
		   pad two tracks, across the whole view. */
		grid-template-columns:
			minmax(0, 1fr) auto
			repeat(2, minmax(0, 1fr)) auto
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

	.stack-cell {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}


</style>
