<script lang="ts">
	/**
	 * GlitchControl — the Glitch tile over GlitchLoop (`glitchLoop` slot): a
	 * slider on its Dry/Wet in column 9 since 2026-10-24 (the user's call;
	 * an XY with Clock across from 2026-10-15, and Clock is in the view now).
	 * A tap opens the Glitch view. No layout entry: `slotKey` resolves its
	 * own slot, as Squash does.
	 *
	 * Parameters resolve by name on the loaded device (`glitchLoopParams.ts`);
	 * a pending write before it loads uses the measured index.
	 */

	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import BaseDeviceControl from './BaseDeviceControl.svelte';
	import DeviceSlider from './DeviceSlider.svelte';
	import { GLITCH_LOOP_PARAMS, glitchLoopIndex } from './glitchLoopParams';

	interface Props {
		device: DeviceRecord | null;
	}

	let { device }: Props = $props();

	const { mix } = GLITCH_LOOP_PARAMS;

	let names = $derived(device ? selectedTrackStore.paramNamesForDevice(device) : []);
	let mixIndex = $derived(glitchLoopIndex(names, 'mix'));

	function read(index: number): number | undefined {
		return device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, index)) : undefined;
	}

	// Dry/Wet at 0 on an unloaded slot, which adds nothing.
	let value = $derived((read(mixIndex) ?? 0) / mix.max);
</script>

<BaseDeviceControl slotKey="glitchLoop" {device} title="Glitch" showMoveToTop={true} showMoveToEnd={true}>
	{#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
		<DeviceSlider
			{value}
			title="Glitch"
			labelOrientation="horizontal"
			labelSize="small"
			{isGhost}
			{color}
			min={0}
			max={1}
			onTap={handleTap}
			onInteraction={(y) => {
				openView();
				const mixValue = Math.min(1, Math.max(0, y)) * mix.max;
				if (isGhost || isLoading) {
					if (isGhost) triggerLoad();
					storePendingParam(mixIndex, mixValue);
				} else {
					sendParam(mixIndex, mixValue);
				}
			}}
		/>
	{/snippet}
</BaseDeviceControl>
