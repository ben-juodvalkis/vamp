<script lang="ts">
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import BaseDeviceControl from './BaseDeviceControl.svelte';
	import DeviceXY from './DeviceXY.svelte';

	interface Props {
		device: DeviceRecord | null;
	}

	let { device }: Props = $props();

	// Parameter configuration for Digital effect
	const PARAM_CONFIG = {
		param1: {
			index: 1,
			min: 0,
			max: 127,
			type: 'int' as const
		},
		param2: {
			index: 2,
			min: 0,
			max: 127,
			type: 'int' as const
		}
	};

	// Reactive view of armed/store state. Wire values are 0..127; the
	// XY pad displays normalized 0..1 — the conversion is part of the
	// derivation, applied to whichever side wins (UI-armed value during
	// drag, surface value otherwise).
	let param1Value = $derived.by(() => {
		if (!device) return 0;
		const raw = selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.param1.index)) ?? 0;
		return raw / 127;
	});
	let param2Value = $derived.by(() => {
		if (!device) return 0;
		const raw = selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.param2.index)) ?? 0;
		return raw / 127;
	});
</script>

<BaseDeviceControl slotKey="digital" {device} title="Digital" disableCentralViewOnTap={true} showMoveToTop={true} showMoveToEnd={true}>
	{#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color })}
		<DeviceXY
			xValue={param1Value}
			yValue={param2Value}
			title="Digital"
			{isGhost}
			{color}
			showCurve={false}
			onTap={handleTap}
			onInteraction={(x, y) => {
				// Convert 0-1 UI values to 0-127 parameter values
				const param1Send = Math.round(x * 127);
				const param2Send = Math.round(y * 127);
				
				if (isGhost || isLoading) {
					// Trigger load on first ghost interaction
					if (isGhost) {
						triggerLoad();
					}
					// Store as pending - will be applied when device loads
					storePendingParam(PARAM_CONFIG.param1.index, param1Send);
					storePendingParam(PARAM_CONFIG.param2.index, param2Send);
				} else {
					// Device is active - send immediately and update cache optimistically
					sendParam(PARAM_CONFIG.param1.index, param1Send);
					sendParam(PARAM_CONFIG.param2.index, param2Send);
				}
			}}
		/>
	{/snippet}
</BaseDeviceControl>