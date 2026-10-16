<script lang="ts">
	/**
	 * ChorusGroup — the Chorus family inside the Auto Pan view (2026-10-15,
	 * the user's call): the Chorus XY that was the grid tile, then Blur's
	 * dry/wet, Comb and Phaser, which were the Chorus view.
	 *
	 * Its root is `display: contents`, so every control and seam is a grid
	 * item of AutoPanCentralView, which owns the tracks.
	 *
	 * Contains virtual devices (smudge, comb, phaser) which have their own
	 * ghost states. NO {#if device} gate - always renders, handles its own
	 * state.
	 */

	import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
	import ChorusControl from '$lib/components/v6/device-panel/ChorusControl.svelte';
	import SmudgeControl from '$lib/components/v6/device-panel/SmudgeControl.svelte';
	import CombControl from '$lib/components/v6/device-panel/CombControl.svelte';
	import BaseDeviceControl from '$lib/components/v6/device-panel/BaseDeviceControl.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { getSlotByDeviceType } from '$lib/config/fxGridLayout';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import SectionDivider from '../../SectionDivider.svelte';

	const chorus = useFxGridSlot('chorus');
	const comb = useFxGridSlot('comb');
	const smudge = useFxGridSlot('smudge');
	const phaser = useFxGridSlot('phaser');

	// The Chorus keeps its layout entry (hidden from the grid) so its slot
	// still resolves by position.
	const chorusPosition = getSlotByDeviceType('chorus')!.position;

	// GRATICULE (§5.5): calibrate the slot palette through trackInk at injection.
	let chorusInk = $derived(trackInk(chorus.color.primary, paintModeReactive()));
	let smudgeInk = $derived(trackInk(smudge.color.primary, paintModeReactive()));
	let combInk = $derived(trackInk(comb.color.primary, paintModeReactive()));
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

<div class="chorus-group">
	<!-- Seams fall on the DEVICE boundaries: Chorus | Blur | Comb | Phaser.
	     The pads are the same size and two wear the same ink, so without
	     them the Phaser reads as a second Comb (2026-09-13, ADR-433). -->
	<SectionDivider orientation="vertical" ink={chorusInk} />

	<!-- The Chorus XY, the grid tile until 2026-10-15. -->
	<div class="cell" class:slot-ghost={chorus.isGhost}>
		<ChorusControl device={chorus.device} position={chorusPosition} />
	</div>

	<SectionDivider orientation="vertical" ink={smudgeInk} />

	<!-- Blur's dry/wet (the `smudge` slot; virtual device - handles its own slot state) -->
	<div class="cell" class:slot-ghost={smudge.isGhost}>
		<SmudgeControl device={smudge.device} icon="blur" />
	</div>

	<SectionDivider orientation="vertical" ink={combInk} />

	<!-- Comb (virtual device - handles its own slot state). The Max device
	     has no LFO. -->
	<div class="cell" class:slot-ghost={comb.isGhost}>
		<CombControl device={comb.device} icon="comb" />
	</div>

	<SectionDivider orientation="vertical" ink={phaserInk.primary} />

	<!-- Phaser (virtual device) — X: LFO speed, Y: feedback. Wrapped in
	     BaseDeviceControl like Blur and Comb so it carries the same
	     move-to-first / move-to-last arrows. -->
	<div class="cell" class:slot-ghost={phaser.isGhost}>
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

<style>
	.chorus-group {
		display: contents;
	}

	.cell {
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
	}
</style>
