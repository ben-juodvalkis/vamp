<script lang="ts">
	/** The `smudge` control (`deviceControls`) as a tile. */
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import type { ControlGlyphName } from './ControlGlyph.svelte';
	import ControlTile from './ControlTile.svelte';

	interface Props {
		device: DeviceRecord | null;
		icon?: ControlGlyphName;
		orientation?: 'vertical' | 'horizontal';
	}

	let { device, icon, orientation }: Props = $props();
</script>

<ControlTile type="smudge" {device} {icon} {orientation} disableCentralViewOnTap labelSize="large" />
