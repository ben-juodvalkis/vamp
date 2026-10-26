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
</script>

{#if control}
	<BaseDeviceControl
		{...position ? { position } : { slotKey: type }}
		{device}
		title={DEVICE_PRESETS[type]?.defaultName ?? control.title}
		{disableCentralViewOnTap}
		showMoveToTop={true}
		showMoveToEnd={true}
	>
		{#snippet children({ device: live, sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
			{@const names = live ? selectedTrackStore.paramNamesForDevice(live) : []}
			{@const index = (ref: ParamRef) => resolveParam(ref, names)}
			{@const get = (ref: ParamRef) => (live ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(live, index(ref))) : undefined)}
			<FaceControl
				{control}
				{get}
				display={(ref) => (live ? selectedTrackStore.paramDisplay(selectedTrackStore.paramPath(live, index(ref))) : undefined)}
				{color}
				{isGhost}
				{icon}
				{orientation}
				{labelSize}
				{labelOrientation}
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
