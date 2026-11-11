<script lang="ts">
  import { press } from '$lib/actions/press';
	/**
	 * The MIDI editor's toolbar, two by two at the right end of the clip
	 * view's full-screen strip (ADR-527). Own pointer surface, outside the pan/zoom
	 * canvas. Fold, the snap grid (1/4·1/8·1/16·1/32 and a triplet toggle,
	 * driving snap, draw length, quantize and the gridlines — UI-chosen,
	 * not mirrored from Live's grid_quantization, ADR-382) and Quantize.
	 */

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

	let gridLabel = $derived(`1/${gridDenom}${gridTriplet ? 'T' : ''}`);

	function cycleGrid() {
		const i = GRID_DENOMS.indexOf(gridDenom as (typeof GRID_DENOMS)[number]);
		gridDenom = GRID_DENOMS[(i + 1) % GRID_DENOMS.length];
	}
</script>

<div class="edit-toolbar">
	<button
		class="edit-chip btn-toggle"
		class:active={fold}
		use:press={{ onPress: () => (fold = !fold) }}
		title="Fold: show only the pitches this clip plays"
	>
		Fold
	</button>


	<button class="edit-chip grid-chip" use:press={{ onPress: () => cycleGrid() }} title="Snap grid (tap to cycle)">
		{gridLabel}
	</button>
	<button
		class="edit-chip btn-toggle"
		class:active={gridTriplet}
		use:press={{ onPress: () => (gridTriplet = !gridTriplet) }}
		title="Triplet grid"
	>
		Triplet
	</button>


	<button
		class="edit-chip btn-action"
		disabled={!canQuantize}
		use:press={{ onPress: () => onQuantize(), disabled: !canQuantize }}
		title="Quantize every note in the clip to the grid"
	>
		Quantize
	</button>
</div>

<style>
	/* Fold and the grid over Triplet and Quantize, filling the strip's
	   slot beside the clip controls (ADR-527). */
	.edit-toolbar {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		grid-template-rows: repeat(2, minmax(0, 1fr));
		gap: var(--spacing-xs);
		width: 100%;
		height: 100%;
	}
	/* Not `.grid`: that is Tailwind's display:grid utility, and it pinned
	   the label to the top of the chip. */
	.edit-chip.grid-chip {
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.edit-chip {
		min-height: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 15px;
		line-height: 1;
		padding: 0 var(--spacing-xs);
		border-radius: var(--radius-sm);
		background: var(--secondary);
		color: var(--muted-foreground);
		border: 1px solid var(--line);
		cursor: pointer;
	}
	.edit-chip.active {
		background: color-mix(in oklab, var(--phosphor) 25%, transparent);
		color: var(--foreground);
		border-color: var(--phosphor);
	}
	.edit-chip:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* Flat grammar: chips as control fields — OFF = ControlBackground +
	   dark frame, ON = solid ChosenDefault with dark text, disabled = the
	   disabled foreground on the same field (never opacity). */
	:global([data-grammar="flat"]) .edit-chip {
		border-radius: 2px;
		border-color: var(--button-frame, var(--line-strong));
		background: var(--surface-well);
		color: var(--foreground);
	}
	:global([data-grammar="flat"]) .edit-chip.active {
		background: var(--phosphor);
		border-color: var(--phosphor);
		color: var(--flat-on-fg);
	}
	/* Light: an ON fill sits at ~1:1 luminance against the light ladder, so
	   the frame stays dark for the chip's boundary to survive. */
	:global(.light[data-grammar="flat"]) .edit-chip.active {
		border-color: var(--line-strong);
	}
	:global([data-grammar="flat"]) .edit-chip:disabled {
		opacity: 1;
		color: var(--flat-disabled-fg);
	}
</style>
