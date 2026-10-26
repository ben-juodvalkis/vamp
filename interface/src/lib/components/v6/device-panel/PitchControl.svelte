<script lang="ts">
	/**
	 * PitchControl — the Pitch tile (2026-10-24, the user's call): the
	 * `octave` control (`deviceControls`), the Octave's Mix, in column 2 over
	 * the Saturator. A tap opens the Pitch view. No layout entry: the tile
	 * resolves the `octave` slot, as Squash does.
	 *
	 * A browser load lands at the END of the chain and an octave pedal
	 * belongs at its head, so a drag that may load arms the one-shot move
	 * (`useBassChainPosition`), as the Pitch view's controls do.
	 */
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import ControlTile from './ControlTile.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { useBassChainPosition } from '$lib/components/v6/central/useBassChainPosition.svelte';

	interface Props {
		device: DeviceRecord | null;
	}

	let { device }: Props = $props();

	const octave = useFxGridSlot('octave');
	const octaveChain = useBassChainPosition(octave, 'PitchControl');
</script>

<ControlTile type="octave" {device} onGesture={() => octave.isGhost && octaveChain.arm()} />
