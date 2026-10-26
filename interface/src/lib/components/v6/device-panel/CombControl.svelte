<script lang="ts">
	/** The `comb` control (`deviceControls`) as a tile. */
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import type { ControlGlyphName } from './ControlGlyph.svelte';
	import ControlTile from './ControlTile.svelte';

	interface Props {
		device: DeviceRecord | null;
		icon?: ControlGlyphName;
	}

	let { device, icon }: Props = $props();
</script>

<ControlTile type="comb" {device} {icon} disableCentralViewOnTap />
