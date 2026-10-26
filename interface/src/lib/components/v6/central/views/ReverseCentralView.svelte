<script lang="ts">
	/**
	 * Pitch Hack's view, titled Reverse (the `pitchHack` slot): its Rate
	 * column and Mix (`autopan/PitchGroup`, `show="reverse"`). It sat past a
	 * seam in the Glitch view from 2026-10-24 until the FX chain overview gave
	 * every device a view of its own (2026-10-26). The group's root is
	 * `display: contents`, so its column is this grid's.
	 */

	import PitchGroup from './autopan/PitchGroup.svelte';
</script>

<div class="reverse-layout" data-view="pitchHack">
	<PitchGroup standalone show="reverse" />
</div>

<style>
	/* Pitch Hack alone. */
	.reverse-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--central-gap);
		height: 100%;
		width: 100%;
		padding: var(--central-inset);
	}
</style>
