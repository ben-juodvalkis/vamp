<script lang="ts">
	/**
	 * PhaserPad — the Phaser-Flanger's XY (X: LFO speed, Y: feedback),
	 * wrapped in BaseDeviceControl like Blur and Comb so it carries the same
	 * move-to-first / move-to-last arrows. Drawn by the Phaser view.
	 * A virtual device: it handles its own slot state and ghost.
	 */

	import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
	import BaseDeviceControl from '$lib/components/v6/device-panel/BaseDeviceControl.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';

	const phaser = useFxGridSlot('phaser');

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
