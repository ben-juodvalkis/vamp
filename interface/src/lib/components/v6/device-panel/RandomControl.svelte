<script lang="ts">
	/** The `random` control (`deviceControls`) as a tile. */
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import type { PositionKey } from '$lib/config/fxGridLayout';
	import ControlTile from './ControlTile.svelte';

	interface Props {
		device?: DeviceRecord | null;
		position?: PositionKey;
	}

	// The device is the chain cell's: two Rand Octs on a track are two cells.
	let { device }: Props = $props();
</script>

<ControlTile type="random" {device} />
