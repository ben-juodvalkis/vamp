<script lang="ts">
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import BaseDeviceControl from './BaseDeviceControl.svelte';
	import DeviceSlider from './DeviceSlider.svelte';

	interface Props {
		device: DeviceRecord | null;
	}

	let { device }: Props = $props();

	// Blur (`Vamp Devices/Blur/Blur.amxd`), read off the running device on
	// 2026-10-03 (parameters.*name/min/max): 0 Device On, 1 Drive 0–100,
	// 2 Rate 4–200, 3 Seam 6–90, 4 Mix 0–100, 5 Clip, 6 Restart, 7 Width 0–100.
	// The device saves Drive at 100 and Mix at 0, so the one control it needs
	// here is the dry/wet.
	const MIX_PARAM = 4;
	const MIX_MIN = 0;
	const MIX_MAX = 100;
	// The floor, like every other fill tile: dry until it is reached for.
	const MIX_REST = 0;

	let mixValue = $derived(
		device
			? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, MIX_PARAM)) ?? MIX_REST
			: MIX_REST
	);
</script>

<BaseDeviceControl slotKey="smudge" {device} title="Blur" disableCentralViewOnTap={true} showMoveToTop={true} showMoveToEnd={true}>
	{#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color })}
		<DeviceSlider
			value={mixValue}
			title="Blur"
			orientation="vertical"
			labelOrientation="horizontal"
			{isGhost}
			{color}
			min={MIX_MIN}
			max={MIX_MAX}
			onTap={handleTap}
			onInteraction={(value) => {
				if (isGhost || isLoading) {
					// Trigger load on first ghost interaction
					if (isGhost) {
						triggerLoad();
					}
					// Store as pending - will be applied when device loads
					storePendingParam(MIX_PARAM, value);
				} else {
					// Device is active - send immediately (cache updates optimistically)
					sendParam(MIX_PARAM, value);
				}
			}}
		/>
	{/snippet}
</BaseDeviceControl>
