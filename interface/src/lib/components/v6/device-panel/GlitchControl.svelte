<script lang="ts">
	/**
	 * GlitchControl — the Glitch tile (2026-10-15, the user's design): an XY
	 * over GlitchLoop (`glitchLoop` slot). X is Clock, the device's coupled
	 * pitch / length / fidelity macro, in its eleven detents; Y is Dry/Wet.
	 * A tap opens the Glitch view (GlitchLoop and the Variation). No layout
	 * entry: `slotKey` resolves its own slot, as Squash does.
	 *
	 * Parameters resolve by name on the loaded device (`glitchLoopParams.ts`);
	 * a pending write before it loads uses the measured index.
	 */

	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import BaseDeviceControl from './BaseDeviceControl.svelte';
	import DeviceXY from './DeviceXY.svelte';
	import { GLITCH_LOOP_PARAMS, glitchLoopIndex } from './glitchLoopParams';

	interface Props {
		device: DeviceRecord | null;
	}

	let { device }: Props = $props();

	const { clock, mix } = GLITCH_LOOP_PARAMS;

	let names = $derived(device ? selectedTrackStore.paramNamesForDevice(device) : []);
	let clockIndex = $derived(glitchLoopIndex(names, 'clock'));
	let mixIndex = $derived(glitchLoopIndex(names, 'mix'));

	function read(index: number): number | undefined {
		return device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, index)) : undefined;
	}

	// A detent's value, not a continuous one: Clock is quantized.
	function clockAt(x: number): number {
		return Math.round(Math.min(1, Math.max(0, x)) * (clock.max - clock.min)) + clock.min;
	}

	// The device opens with Clock at its middle detent and Dry/Wet at 0 on
	// an unloaded slot, which adds nothing.
	let xValue = $derived(((read(clockIndex) ?? 5) - clock.min) / (clock.max - clock.min));
	let yValue = $derived((read(mixIndex) ?? 0) / mix.max);
</script>

<BaseDeviceControl slotKey="glitchLoop" {device} title="Glitch" showMoveToTop={true} showMoveToEnd={true}>
	{#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
		<DeviceXY
			{xValue}
			{yValue}
			title="Glitch"
			{isGhost}
			{color}
			showCurve={false}
			onTap={handleTap}
			onInteraction={(x, y) => {
				openView();
				const clockValue = clockAt(x);
				const mixValue = Math.min(1, Math.max(0, y)) * mix.max;
				if (isGhost || isLoading) {
					if (isGhost) triggerLoad();
					storePendingParam(clockIndex, clockValue);
					storePendingParam(mixIndex, mixValue);
				} else {
					if (clockValue !== Math.round(read(clockIndex) ?? -1)) sendParam(clockIndex, clockValue);
					sendParam(mixIndex, mixValue);
				}
			}}
		/>
	{/snippet}
</BaseDeviceControl>
