<script lang="ts">
	/** The `glitchLoop` control (`deviceControls`) as a tile. */
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import ControlTile from './ControlTile.svelte';

	interface Props {
		device: DeviceRecord | null;
	}

	let { device }: Props = $props();
</script>

<ControlTile type="glitchLoop" {device} />
