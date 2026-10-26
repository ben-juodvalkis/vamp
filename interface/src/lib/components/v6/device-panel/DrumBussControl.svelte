<script lang="ts">
	/** The `drum` control (`deviceControls`) as a tile. */
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import type { PositionKey } from '$lib/config/fxGridLayout';
	import ControlTile from './ControlTile.svelte';

	interface Props {
		device: DeviceRecord | null;
		position?: PositionKey;
		disableCentralViewOnTap?: boolean;
	}

	let { device, position, disableCentralViewOnTap }: Props = $props();
</script>

<ControlTile type="drum" {device} {position} {disableCentralViewOnTap} />
