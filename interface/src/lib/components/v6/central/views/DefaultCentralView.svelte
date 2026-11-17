<script lang="ts">
	/**
	 * The view the registry falls back to when nothing names one: the shared
	 * empty state, in plain ink (a sparkle emoji at a fifth of its strength
	 * until the ADR-544 rollout).
	 */
	import DeviceEmptyState from '../DeviceEmptyState.svelte';
</script>

<DeviceEmptyState message="Select a track or a device" />
