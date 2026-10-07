<script lang="ts">
	import type { ControlGlyphName } from './ControlGlyph.svelte';
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import BaseDeviceControl from './BaseDeviceControl.svelte';
	import DeviceXY from './DeviceXY.svelte';

	interface Props {
		device: DeviceRecord | null;
		// Marks for what the control does (the central views pass them; the
		// grid tile draws none).
		icon?: ControlGlyphName;
	}

	let { device, icon }: Props = $props();

	// Comb (`Vamp Devices/Comb/Comb.amxd`), a Max rebuild of the owner's
	// Zebrify "Dissonant" comb patch (2026-10-05). Its parameters, in Live's
	// order: 0 Device On, 1 Tune -24..24 st, 2 Mix 0..100, 3 Feedback -100..100.
	// The pad keeps what the Zebrify tile did: X is Tune, Y raises Feedback
	// and brings the comb up with it (the Zebrify preset's Mix was wired
	// opposite to its Feedback; this device's Mix is 100 = all comb, so the
	// two now move the same way). Only the positive half of Feedback is
	// reachable from the pad, as before.
	const PARAMS = {
		tune: { index: 1, min: -24, max: 24 },
		mix: { index: 2, min: 0, max: 100 },
		feedback: { index: 3, min: 0, max: 100 }
	};
	// The device saves Tune 0, Mix 17.58 and Feedback 17.58 (the preset's
	// rest), so a fresh load sits where the pad draws it.
	const TUNE_REST = 0;
	const FEEDBACK_REST = 17.58;

	function paramValue(index: number, rest: number): number {
		return device
			? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, index)) ?? rest
			: rest;
	}

	// Visual position is a pure derivation of armed/store state.
	let xValue = $derived((paramValue(PARAMS.tune.index, TUNE_REST) - PARAMS.tune.min) / (PARAMS.tune.max - PARAMS.tune.min));
	let yValue = $derived(Math.max(0, Math.min(1, paramValue(PARAMS.feedback.index, FEEDBACK_REST) / PARAMS.feedback.max)));

	function sends(x: number, y: number): Array<[number, number]> {
		return [
			[PARAMS.tune.index, PARAMS.tune.min + x * (PARAMS.tune.max - PARAMS.tune.min)],
			[PARAMS.mix.index, y * PARAMS.mix.max],
			[PARAMS.feedback.index, y * PARAMS.feedback.max]
		];
	}
</script>

<BaseDeviceControl slotKey="comb" {device} title="Comb" disableCentralViewOnTap={true} showMoveToTop={true} showMoveToEnd={true}>
	{#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color })}
		<DeviceXY
			{xValue}
			{yValue}
			title="Comb"
			{icon}
			{isGhost}
			{color}
			showCurve={false}
			onTap={handleTap}
			onInteraction={(x, y) => {
				// CRITICAL: Do NOT call centralDisplayStore.setView() for virtual devices
				// User is already in the correct central view (SmudgeCentralView)

				if (isGhost || isLoading) {
					// Trigger load on first ghost interaction
					if (isGhost) {
						triggerLoad();
					}
					// Store as pending - will be applied when device loads
					for (const [index, value] of sends(x, y)) storePendingParam(index, value);
				} else {
					// Device is active - send immediately and update cache optimistically
					for (const [index, value] of sends(x, y)) sendParam(index, value);
				}
			}}
		/>
	{/snippet}
</BaseDeviceControl>
