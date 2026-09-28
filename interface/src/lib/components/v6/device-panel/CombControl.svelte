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
		},
		param3: {
			index: 3,
			min: 0.5,
			max: 1,
			type: 'float' as const
		}
	};

	// Visual position is a pure derivation of armed/store state. Param 3
	// has a non-1:1 mapping: stored 0.5..1 → visual 0..1 (the bottom half
	// of the parameter range maps to the bottom of the XY pad).
	let param1Value = $derived(
		device
			? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.param1.index)) ?? 0.5
			: 0.5
	);
	let param3Value = $derived.by(() => {
		if (!device) return 0;
		const p3 =
			selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.param3.index)) ?? 0.5;
		return (p3 - 0.5) / 0.5;
	});
</script>

<BaseDeviceControl slotKey="comb" {device} title="Comb" disableCentralViewOnTap={true} showMoveToTop={true} showMoveToEnd={true}>
	{#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color })}
		<DeviceXY
			xValue={param1Value}
			yValue={param3Value}
			title="Comb"
			{isGhost}
			{color}
			showCurve={false}
			onTap={handleTap}
			onInteraction={(x, y) => {
				// Calculate param2 value (inverted: Y=0 → param2=1, Y=1 → param2=0)
				const param2SendValue = 1 - y;
				// Calculate param3 send value (maps Y from 0-1 to 0.5-1)
				const param3SendValue = 0.5 + (y * 0.5);

				// CRITICAL: Do NOT call centralDisplayStore.setView() for virtual devices
				// User is already in the correct central view (SmudgeCentralView)

				if (isGhost || isLoading) {
					// Trigger load on first ghost interaction
					if (isGhost) {
						triggerLoad();
					}
					// Store as pending - will be applied when device loads
					storePendingParam(PARAM_CONFIG.param1.index, x);
					storePendingParam(PARAM_CONFIG.param2.index, param2SendValue);
					storePendingParam(PARAM_CONFIG.param3.index, param3SendValue);
				} else {
					// Device is active - send immediately and update cache optimistically
					sendParam(PARAM_CONFIG.param1.index, x);
					sendParam(PARAM_CONFIG.param2.index, param2SendValue);
					sendParam(PARAM_CONFIG.param3.index, param3SendValue);
				}
			}}
		/>
	{/snippet}
</BaseDeviceControl>
