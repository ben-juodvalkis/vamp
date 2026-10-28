<script lang="ts">
	/**
	 * The Bass tile: the `bass` control (`deviceControls`), the Bass Amp
	 * rack's one macro (the mix, 0..127, resting at 0). It resolves its own
	 * `bass` slot wherever it is drawn. A load lands at the END of the chain
	 * and the Bass belongs at its head, so every drag arms the one-shot move
	 * (`useBassChainPosition`).
	 */
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import type { PositionKey } from '$lib/config/fxGridLayout';
	import ControlTile from './ControlTile.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { useBassChainPosition } from '$lib/components/v6/central/useBassChainPosition.svelte';

	interface Props {
		device?: DeviceRecord | null;
		position?: PositionKey;
	}

	let { device }: Props = $props();

	const bass = useFxGridSlot('bass');
	const chain = useBassChainPosition(bass, 'BassControl');
</script>

<ControlTile type="bass" {device} onGesture={() => chain.arm()} />
