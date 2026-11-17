<script lang="ts">
  import { press } from '$lib/actions/press';
	/**
	 * The MIDI editor's toolbar, at the right end of the clip view's
	 * full-screen strip (ADR-527). Own pointer surface, outside the pan/zoom
	 * canvas. The snap grid (1/4·1/8·1/16·1/32, driving snap, draw length,
	 * quantize and the gridlines — UI-chosen, not mirrored from Live's
	 * grid_quantization, ADR-382) across the top; under it Fold, the grid's
	 * Triplet and Quantize.
	 *
	 * Each is its control type (ADR-544): the grid's four values are a tab,
	 * the chosen one ON's block (until then one chip that stepped through
	 * them on each tap, which said which value was set but not which were
	 * there); Fold and Triplet are switches, a rectangle with a lamp;
	 * Quantize does its work once and is round.
	 */
	import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';

	const GRID_DENOMS = [4, 8, 16, 32] as const;

	interface Props {
		fold: boolean;
		/** The note value of one grid cell (4 = 1/4, 8 = 1/8, …). */
		gridDenom: number;
		gridTriplet: boolean;
		canQuantize: boolean;
		onQuantize: () => void;
	}

	let {
		fold = $bindable(),
		gridDenom = $bindable(),
		gridTriplet = $bindable(),
		canQuantize,
		onQuantize
	}: Props = $props();
</script>

<div class="edit-toolbar">
	<div class="grid-tab" title="Snap grid">
		<ScrubTabs
			options={GRID_DENOMS}
			selected={GRID_DENOMS.indexOf(gridDenom as (typeof GRID_DENOMS)[number])}
			onSelect={(_, denom) => (gridDenom = denom)}
			cols={GRID_DENOMS.length}
			label={(denom) => `1/${denom}`}
			groupLabel="Snap grid"
			name="clip-grid"
			style="height: 100%; --scrub-font-size: 0.8125rem;"
		/>
	</div>

	<button
		class="physical-button btn-toggle edit-chip"
		class:active={fold}
		aria-pressed={fold}
		use:press={{ onPress: () => (fold = !fold) }}
		title="Fold: show only the pitches this clip plays"
	>
		Fold
	</button>
	<button
		class="physical-button btn-toggle edit-chip"
		class:active={gridTriplet}
		aria-pressed={gridTriplet}
		use:press={{ onPress: () => (gridTriplet = !gridTriplet) }}
		title="Triplet grid"
	>
		Triplet
	</button>
	<button
		class="physical-button btn-action edit-chip"
		disabled={!canQuantize}
		use:press={{ onPress: () => onQuantize(), disabled: !canQuantize }}
		title="Quantize every note in the clip to the grid"
	>
		Quantize
	</button>
</div>

<style>
	/* The grid's tab across the top, a touch row; Fold, Triplet and
	   Quantize under it, filling the strip's slot beside the clip controls
	   (ADR-527). */
	.edit-toolbar {
		display: grid;
		/* Quantize's word is the longest: its pill takes a little more. */
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.3fr);
		grid-template-rows: repeat(2, minmax(0, 1fr));
		gap: var(--spacing-xs);
		width: 100%;
		height: 100%;
	}
	.grid-tab {
		grid-column: 1 / -1;
		min-width: 0;
		min-height: 0;
		font-variant-numeric: tabular-nums;
	}
	/* A switch's word sits under its lamp; a one-shot's in its middle. */
	.edit-chip {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		min-height: 0;
		white-space: nowrap;
		font-size: 0.8125rem;
		line-height: 1;
		padding: 0 2px;
	}
	.edit-chip.btn-toggle {
		padding-top: 0.5rem;
	}
	.edit-chip:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* Flat grammar: the chips are app.css's buttons (a field when off, ON's
	   block when lit, a label for a word); disabled is the disabled
	   foreground on the same field, never opacity. */
	:global([data-grammar="flat"]) .edit-chip {
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .edit-chip:disabled {
		opacity: 1;
		color: var(--flat-disabled-fg);
	}
</style>
