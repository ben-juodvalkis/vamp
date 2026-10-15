<script lang="ts">
	/**
	 * PitchControl — the Pitch tile (2026-10-15, the user's design): an XY
	 * over the Octave device (`octave` slot). X is the interval, snapped to
	 * the Octave panel's four stops, low to high left to right (-12, -5, +7,
	 * +12); Y is Mix. A tap opens the Pitch view (Octave and Pitch Hack). It
	 * has no layout entry: `slotKey` resolves its own slot, as Squash does.
	 *
	 * A browser load lands at the END of the chain and an octave pedal
	 * belongs at its head, so a gesture that may load arms the same one-shot
	 * move the Octave panel arms (`useBassChainPosition`).
	 */

	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import BaseDeviceControl from './BaseDeviceControl.svelte';
	import DeviceXY from './DeviceXY.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { useBassChainPosition } from '$lib/components/v6/central/useBassChainPosition.svelte';
	import { OCTAVE_PITCH_PARAM, OCTAVE_MIX_PARAM, OCTAVE_MIX_MAX, OCTAVE_PITCH_STEPS } from './octaveParams';

	interface Props {
		device: DeviceRecord | null;
	}

	let { device }: Props = $props();

	// Low to high across the pad.
	const STOPS = [...OCTAVE_PITCH_STEPS].map((s) => s.value).sort((a, b) => a - b);

	const octaveChain = useBassChainPosition(useFxGridSlot('octave'), 'PitchControl');

	function stopAt(x: number): number {
		return STOPS[Math.min(STOPS.length - 1, Math.max(0, Math.floor(x * STOPS.length)))];
	}

	let pitch = $derived(
		device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, OCTAVE_PITCH_PARAM)) : undefined
	);
	// The dot sits in the middle of the nearest stop's band.
	let xValue = $derived.by(() => {
		if (pitch === undefined) return 1 - 0.5 / STOPS.length;
		const i = STOPS.reduce((best, v, k) => (Math.abs(v - pitch!) < Math.abs(STOPS[best] - pitch!) ? k : best), 0);
		return (i + 0.5) / STOPS.length;
	});
	let yValue = $derived(
		device
			? (selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, OCTAVE_MIX_PARAM)) ?? 0) / OCTAVE_MIX_MAX
			: 0
	);
</script>

<BaseDeviceControl slotKey="octave" {device} title="Pitch" showMoveToTop={true} showMoveToEnd={true}>
	{#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
		<DeviceXY
			{xValue}
			{yValue}
			title="Pitch"
			{isGhost}
			{color}
			showCurve={false}
			onTap={handleTap}
			onInteraction={(x, y) => {
				openView();
				const semitones = stopAt(x);
				const mix = y * OCTAVE_MIX_MAX;
				if (isGhost || isLoading) {
					if (isGhost) {
						octaveChain.arm();
						triggerLoad();
					}
					storePendingParam(OCTAVE_PITCH_PARAM, semitones);
					storePendingParam(OCTAVE_MIX_PARAM, mix);
				} else {
					if (semitones !== pitch) sendParam(OCTAVE_PITCH_PARAM, semitones);
					sendParam(OCTAVE_MIX_PARAM, mix);
				}
			}}
		/>
	{/snippet}
</BaseDeviceControl>
