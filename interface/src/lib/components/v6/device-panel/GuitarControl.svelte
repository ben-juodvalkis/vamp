<script lang="ts">
	/** The `guitar` control (`deviceControls`) as a tile. */
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import type { PositionKey } from '$lib/config/fxGridLayout';
	import type { ControlGlyphName } from './ControlGlyph.svelte';
	import ControlTile from './ControlTile.svelte';

	interface Props {
		device?: DeviceRecord | null;
		position?: PositionKey;
		disableCentralViewOnTap?: boolean;
		icon?: ControlGlyphName;
	}

	let { device, position, disableCentralViewOnTap, icon }: Props = $props();
</script>

<ControlTile type="guitar" {device} {position} {disableCentralViewOnTap} {icon} />
