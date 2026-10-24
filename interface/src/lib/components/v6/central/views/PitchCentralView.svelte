<script lang="ts">
	/**
	 * The Pitch tile's view (2026-10-24, the user's call). The grid's Pitch
	 * slider is the Octave's Mix; this view is the Octave's interval column
	 * (`autopan/PitchGroup`, `show="octave"`). Pitch Hack (titled Reverse)
	 * moved to the Glitch view the same day. The group's root is
	 * `display: contents`, so its column is this grid's.
	 */

	import PitchGroup from './autopan/PitchGroup.svelte';
</script>

<div class="pitch-layout">
	<PitchGroup standalone show="octave" />
</div>

<style>
	/* The Octave alone. */
	.pitch-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--central-gap);
		height: 100%;
		width: 100%;
		padding: var(--central-inset);
	}
</style>
