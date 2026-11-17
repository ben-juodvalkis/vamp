<script lang="ts">
	/**
	 * A device's control from `deviceControls` as a live tile (2026-10-26):
	 * the grid's tile, a chain cell's control and a central view's mount of
	 * it are all this, so they draw and write the same. The tile behavior is
	 * `BaseDeviceControl`'s: a ghost loads on its first drag (ADR-167) with
	 * the writes held until it lands, a touch opens the view and appoints the
	 * device, and under a pad scope it is the pad's device.
	 */
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { DEVICE_PRESETS } from '$lib/config/devicePresets';
	import type { DeviceTypeKey, PositionKey } from '$lib/config/fxGridLayout';
	import BaseDeviceControl from './BaseDeviceControl.svelte';
	import FaceControl from '$lib/components/v6/browser/FaceControl.svelte';
	import type { ControlGlyphName } from './ControlGlyph.svelte';
	import { controlFor, resolveParam, type Get, type ParamRef, type Writes } from './deviceControls';
	import { isViewRegistered } from '$lib/components/v6/central/viewRegistry';
	import ReductionNeedle from './ReductionNeedle.svelte';
	import SpectrumFill from '$lib/components/v6/central/views/panel/SpectrumFill.svelte';
	import ActivityTrace from '$lib/components/v6/central/views/panel/ActivityTrace.svelte';
	import { METERED_CLASSES } from '$lib/stores/v6/liveMeterStore.svelte';

	interface Props {
		/** The device type, a `DEVICE_PRESETS` key with a `deviceControls` entry. */
		type: DeviceTypeKey;
		device?: DeviceRecord | null;
		/** The grid cell, for a grid tile; otherwise the slot is the type's. */
		position?: PositionKey;
		icon?: ControlGlyphName;
		orientation?: 'vertical' | 'horizontal';
		disableCentralViewOnTap?: boolean;
		/** Each drag frame, before its writes: the Pitch and Bass tiles arm their move to the chain's head. */
		onGesture?: () => void;
		/**
		 * A tap on a ghost loads it, at the control's rest values: a central
		 * view's mount, where there is no grid tile to drag (the Shifter,
		 * Note Chance, Phaser). A grid tile's tap never loads (ADR-167).
		 */
		tapLoads?: boolean;
		/** A slider's label, where a central view keeps the slider's own (`FaceControl`). */
		labelSize?: 'small' | 'large';
		labelOrientation?: 'vertical' | 'horizontal' | 'auto';
	}

	let { type, device, position, icon, orientation, disableCentralViewOnTap = false, onGesture, tapLoads = false, labelSize, labelOrientation }: Props = $props();
	// A type with no view of its own (Grain Delay) opens none from here: the
	// chain cell around it opens the generic view, on a tap and a drag alike,
	// and a drag asking for the type's view swapped that for an empty one.
	const hasView = $derived(isViewRegistered('device', type));

	/** What the control writes where it rests now: a tap's load carries it. */
	function restWrites(c: NonNullable<typeof control>, get: Get): Writes {
		if (c.kind === 'slider') return c.write(c.read(get), get);
		if (c.kind === 'xy') {
			const at = c.read(get);
			return c.write(at.x, at.y, get);
		}
		return [];
	}

	const control = $derived(controlFor(type));
	/** The Glue's needle swings with the gain reduction Live shows, while there is a reading (ADR-541). */
	let reduction = $state<number | undefined>();
	/** The Compressor's activity has a reading: it stands in for the device's picture (ADR-543). */
	let activityLive = $state(false);
</script>

{#if control}
	<BaseDeviceControl
		{...position ? { position } : { slotKey: type }}
		{device}
		title={DEVICE_PRESETS[type]?.defaultName ?? control.title}
		disableCentralViewOnTap={disableCentralViewOnTap || !hasView}
	>
		{#snippet children({ device: live, sendParam, storePendingParam, pendingValue, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
			{@const names = live ? selectedTrackStore.paramNamesForDevice(live) : []}
			{@const index = (ref: ParamRef) => resolveParam(ref, names)}
			<!-- Before the device lands, what was written to it while it loaded. -->
			{@const get = (ref: ParamRef) => (live ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(live, index(ref))) : pendingValue(index(ref)))}
			{#if type === 'squash'}<ReductionNeedle devicePath={isGhost ? undefined : live?.devicePath} bind:level={reduction} />{/if}
			{@const spectrumPath = !isGhost && live && METERED_CLASSES.get(live.className) === 'spectrum' ? live.devicePath : undefined}
			{#snippet spectrum()}<SpectrumFill devicePath={spectrumPath} ink={color.primary} />{/snippet}
			{@const activityPath = !isGhost && live && METERED_CLASSES.get(live.className) === 'activity' ? live.devicePath : undefined}
			{#snippet activity()}<ActivityTrace devicePath={activityPath} ink={color.primary} bind:live={activityLive} />{/snippet}
			<FaceControl
				{control}
				{get}
				display={(ref) => (live ? selectedTrackStore.paramDisplay(selectedTrackStore.paramPath(live, index(ref))) : undefined)}
				{color}
				isGhost={isGhost || isLoading}
				{icon}
				{orientation}
				{labelSize}
				{labelOrientation}
				pictureLevel={type === 'squash' ? reduction : undefined}
				backdrop={spectrumPath ? spectrum : activityPath ? activity : undefined}
				pictureHidden={activityPath !== undefined && activityLive}
				onTap={() => {
					if (!(tapLoads && isGhost)) return handleTap();
					triggerLoad();
					for (const [ref, value] of restWrites(control, get)) storePendingParam(index(ref), value);
				}}
				onMove={(writes: Writes) => {
					onGesture?.();
					openView();
					if (isGhost || isLoading) {
						if (isGhost) triggerLoad();
						for (const [ref, value] of writes) storePendingParam(index(ref), value);
					} else {
						for (const [ref, value] of writes) sendParam(index(ref), value);
					}
				}}
			/>
		{/snippet}
	</BaseDeviceControl>
{/if}
