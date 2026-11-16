<script lang="ts">
	/**
	 * Draws nothing: holds a device's gain-reduction watch while mounted and
	 * reports the reading as 0–1 of Live's 0–20 dB scale, or undefined while
	 * there is no fresh one (ADR-541). Mounted inside a chain cell's snippet,
	 * where the device it shows (a pad's, under a pad scope) is known.
	 */
	import { useReduction, REDUCTION_MAX_DB } from '$lib/components/v6/central/views/panel/useReduction.svelte';

	interface Props {
		devicePath: string | undefined;
		level?: number | undefined;
	}

	let { devicePath, level = $bindable() }: Props = $props();
	const reduction = useReduction(() => devicePath);

	$effect(() => {
		level = reduction.ok ? Math.min(reduction.db, REDUCTION_MAX_DB) / REDUCTION_MAX_DB : undefined;
	});
</script>
