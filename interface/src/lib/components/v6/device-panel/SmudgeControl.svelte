<script lang="ts">
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import BaseDeviceControl from './BaseDeviceControl.svelte';
	import DeviceXY from './DeviceXY.svelte';

	interface Props {
		device: DeviceRecord | null;
	}

	let { device }: Props = $props();

	// Parameter configuration
	const PARAM_CONFIG = {
		param1: {
			index: 1,
			min: 0,
			max: 1,
			type: 'float' as const
		},
		param2: {
			index: 2,
			min: 0,
			max: 1,
			type: 'float' as const
		}
	};

	// Reactive view of armed/store state.
	let param1Value = $derived(
		device
			? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.param1.index)) ?? 0.5
			: 0.5
	);
	let param2Value = $derived(
		device
			? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.param2.index)) ?? 0
			: 0
	);
</script>

<BaseDeviceControl slotKey="smudge" {device} title="Smudge" disableCentralViewOnTap={true} showMoveToTop={true} showMoveToEnd={true}>
	{#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color })}
		<DeviceXY
			xValue={param1Value}
			yValue={param2Value}
			title="Smudge"
			{isGhost}
			{color}
			showCurve={false}
			onTap={handleTap}
			onInteraction={(x, y) => {
				if (isGhost || isLoading) {
					// Trigger load on first ghost interaction
					if (isGhost) {
						triggerLoad();
					}
					// Store as pending - will be applied when device loads
					storePendingParam(PARAM_CONFIG.param1.index, x);
					storePendingParam(PARAM_CONFIG.param2.index, y);
				} else {
					// Device is active - send immediately (cache updates optimistically)
					sendParam(PARAM_CONFIG.param1.index, x);
					sendParam(PARAM_CONFIG.param2.index, y);
				}
			}}
		/>
	{/snippet}
</BaseDeviceControl>
