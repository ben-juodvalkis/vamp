<script lang="ts">
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import BaseDeviceControl from './BaseDeviceControl.svelte';
	import DeviceXY from './DeviceXY.svelte';

	interface Props {
		device: DeviceRecord | null;
		position: import('$lib/config/fxGridLayout').PositionKey;
	}

	let { device, position }: Props = $props();

	// Parameter configuration for Chorus - param 3 (X) and Dry/Wet (15, Y)
	const PARAM_CONFIG = {
		param1: {
			index: 3,
			min: 0,
			max: 1,
			type: 'float' as const
		},
		param2: {
			index: 15,
			min: 0,
			max: 1,
			type: 'float' as const
		}
	};

	// Read directly from the store's armed-aware reader. The arm in
	// setParamValue suppresses lossy round-trip echoes during a drag,
	// and pre-load gestures land in the store via the FX-grid new-device
	// hook — both fixed at the store level so this component is a pure
	// view of state.
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

<BaseDeviceControl {position} {device} title="Chorus" showMoveToTop={true} showMoveToEnd={true}>
	{#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
		<DeviceXY
			xValue={param1Value}
			yValue={param2Value}
			title="Chorus"
			{isGhost}
			{color}
			showCurve={false}
			onTap={handleTap}
			onInteraction={(x, y) => {
				// Update central display immediately on interaction
				openView();

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