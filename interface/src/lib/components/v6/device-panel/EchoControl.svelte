<script lang="ts">
	/**
	 * EchoControl — the Echo tile (2026-09-14, replacing the Delay XY).
	 *
	 * X is time, written to BOTH of Echo's time controls so the gesture
	 * means the same thing whether Sync is on or off: the synced sixteenths
	 * (param 4, whole steps 1..4) and the free time (param 2, 1 → 0 across
	 * the pad). Y is feedback (param 16, 0..1) with mix riding along at half
	 * (param 52, 0..0.5). Indices and spans are the user's, kept in
	 * `echoParams.ts` so the central view writes the same thing.
	 */
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import BaseDeviceControl from './BaseDeviceControl.svelte';
	import DeviceXY from './DeviceXY.svelte';
	import { ECHO } from './echoParams';

	interface Props {
		device: DeviceRecord | null;
		position: import('$lib/config/fxGridLayout').PositionKey;
	}

	let { device, position }: Props = $props();

	const read = (index: number) =>
		device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, index)) : undefined;

	let synced = $derived((read(ECHO.sync) ?? 1) >= 0.5);
	let timeX = $derived(ECHO.timeTFrom(synced, read(ECHO.sixteenths), read(ECHO.time)));
	let feedback = $derived(Math.min(1, Math.max(0, read(ECHO.feedback) ?? 0)));
	let rateLabel = $derived(
		ECHO.timeLabel(
			synced,
			read(ECHO.sixteenths),
			device ? selectedTrackStore.paramDisplay(selectedTrackStore.paramPath(device, ECHO.time)) : undefined,
			read(ECHO.time)
		)
	);
</script>

<BaseDeviceControl {position} {device} title="Echo" showMoveToTop={true} showMoveToEnd={true}>
	{#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
		<DeviceXY
			xValue={timeX}
			yValue={feedback}
			title="Echo"
			{rateLabel}
			{isGhost}
			{color}
			showCurve={false}
			onTap={handleTap}
			onInteraction={(x, y) => {
				openView();
				const writes = [...ECHO.timeWrites(x), ...ECHO.feedbackMixWrites(y)];
				if (isGhost || isLoading) {
					if (isGhost) triggerLoad();
					for (const [index, value] of writes) storePendingParam(index, value);
				} else {
					for (const [index, value] of writes) sendParam(index, value);
				}
			}}
		/>
	{/snippet}
</BaseDeviceControl>
