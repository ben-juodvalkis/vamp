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
		xIcon?: ControlGlyphName;
		yIcon?: ControlGlyphName;
	}

	let { device, icon, xIcon, yIcon }: Props = $props();

	// Parameter configuration for Redux2 effect
	// X axis: param 8, range 0-1, default 0.5
	// Y axis: param 1, inverted (1-0, so 1 at bottom, 0 at top)
	const PARAM_CONFIG = {
		paramX: {
			index: 8,
			min: 0,
			max: 1,
			default: 0.5,
			type: 'float' as const
		},
		paramY: {
			index: 1,
			min: 0,
			max: 1,
			default: 0.5,
			inverted: true,  // Y axis is inverted
			type: 'float' as const
		}
	};

	// Reactive view of armed/store state. Y is inverted: store value 0
	// means top of XY (display 1), store 1 means bottom (display 0).
	let xValue = $derived(
		device
			? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.paramX.index)) ?? PARAM_CONFIG.paramX.default
			: PARAM_CONFIG.paramX.default
	);
	let yValue = $derived.by(() => {
		if (!device) return 0;
		const raw = selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.paramY.index)) ?? PARAM_CONFIG.paramY.default;
		return 1 - raw;
	});
</script>

<BaseDeviceControl slotKey="redux" {device} title="Redux" disableCentralViewOnTap={true} showMoveToTop={true} showMoveToEnd={true}>
	{#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color })}
		<DeviceXY
			{xValue}
			{yValue}
			title="Redux"
			{icon}
			{xIcon}
			{yIcon}
			{isGhost}
			{color}
			showCurve={false}
			onTap={handleTap}
			onInteraction={(x, y) => {
				// X axis: direct mapping (0-1)
				const paramXSend = x;
				// Y axis: invert back (display 0 -> param 1, display 1 -> param 0)
				const paramYSend = 1 - y;

				if (isGhost || isLoading) {
					// Trigger load on first ghost interaction
					if (isGhost) {
						triggerLoad();
					}
					// Store as pending - will be applied when device loads
					storePendingParam(PARAM_CONFIG.paramX.index, paramXSend);
					storePendingParam(PARAM_CONFIG.paramY.index, paramYSend);
				} else {
					// Device is active - send immediately and update cache optimistically
					sendParam(PARAM_CONFIG.paramX.index, paramXSend);
					sendParam(PARAM_CONFIG.paramY.index, paramYSend);
				}
			}}
		/>
	{/snippet}
</BaseDeviceControl>
