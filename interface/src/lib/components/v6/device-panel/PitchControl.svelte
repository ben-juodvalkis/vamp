<script lang="ts">
	/**
	 * PitchControl — the Pitch tile (2026-10-24, the user's call): a slider
	 * on the Octave's Mix in column 2, over Glitch. It was the Mix slider of
	 * the Pitch group in the Tremolo view; the group is the Pitch view now,
	 * which a tap opens. No layout entry: `slotKey` resolves the `octave`
	 * slot, as Squash does.
	 *
	 * A browser load lands at the END of the chain and an octave pedal
	 * belongs at its head, so a drag that may load arms the one-shot move
	 * (`useBassChainPosition`), as the Pitch view's controls do.
	 */

	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import BaseDeviceControl from './BaseDeviceControl.svelte';
	import DeviceSlider from './DeviceSlider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { useBassChainPosition } from '$lib/components/v6/central/useBassChainPosition.svelte';
	import { OCTAVE_MIX_PARAM, OCTAVE_MIX_MAX } from './octaveParams';

	interface Props {
		device: DeviceRecord | null;
	}

	let { device }: Props = $props();

	const octave = useFxGridSlot('octave');
	const octaveChain = useBassChainPosition(octave, 'PitchControl');

	let value = $derived((octave.paramValue(OCTAVE_MIX_PARAM) ?? 0) / OCTAVE_MIX_MAX);
</script>

<BaseDeviceControl slotKey="octave" {device} title="Pitch" showMoveToTop={true} showMoveToEnd={true}>
	{#snippet children({ handleTap, isGhost, color, openView })}
		<DeviceSlider
			{value}
			title="Pitch"
			labelOrientation="horizontal"
			labelSize="small"
			{isGhost}
			{color}
			min={0}
			max={1}
			onTap={handleTap}
			onInteraction={(v) => {
				openView();
				if (octave.isGhost) octaveChain.arm();
				octave.sendParam(OCTAVE_MIX_PARAM, Math.max(0, Math.min(1, v)) * OCTAVE_MIX_MAX);
			}}
		/>
	{/snippet}
</BaseDeviceControl>
