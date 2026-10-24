<script lang="ts">
	/**
	 * The Pitch tile's view (2026-10-24, the user's call). The grid's Pitch
	 * slider is the Octave's Mix; this view is the rest of the Pitch family,
	 * out of the Tremolo view: the Octave's interval column, then Pitch
	 * Hack (titled Reverse), its Rate column and Mix (`autopan/PitchGroup`).
	 * The group's root is `display: contents`, so its columns and seam are
	 * this grid's.
	 */

	import PitchGroup from './autopan/PitchGroup.svelte';
</script>

<div class="pitch-layout">
	<PitchGroup standalone />
</div>

<style>
	/* The Octave | seam | Pitch Hack. */
	.pitch-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 2fr);
		gap: var(--central-gap);
		height: 100%;
		width: 100%;
		padding: var(--central-inset);
	}
</style>
