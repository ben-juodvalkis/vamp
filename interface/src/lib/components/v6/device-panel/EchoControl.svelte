<script lang="ts">
	/** The `echo` control (`deviceControls`) as a tile. */
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import type { PositionKey } from '$lib/config/fxGridLayout';
	import ControlTile from './ControlTile.svelte';

	interface Props {
		device: DeviceRecord | null;
		position: PositionKey;
	}

	let { device, position }: Props = $props();
</script>

<ControlTile type="echo" {device} {position} />
