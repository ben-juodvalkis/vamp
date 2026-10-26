<script lang="ts">
	/** The `random` control (`deviceControls`) as a tile. */
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import type { PositionKey } from '$lib/config/fxGridLayout';
	import ControlTile from './ControlTile.svelte';

	interface Props {
		device?: DeviceRecord | null;
		position?: PositionKey;
	}

	let { device: _device, position: _position }: Props = $props();
	// The `random` slot, wherever it is drawn: the grid's fx1 on MIDI passes a cell it does not need.
</script>

<ControlTile type="random" />
