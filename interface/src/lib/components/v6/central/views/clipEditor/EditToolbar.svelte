<script lang="ts">
	/**
	 * The MIDI editor's toolbar: a column beside the roll, so the roll
	 * takes the full height. Own pointer surface, outside the pan/zoom
	 * canvas. Fold, the snap grid (1/4·1/8·1/16·1/32 and a triplet toggle,
	 * driving snap, draw length, quantize and the gridlines — UI-chosen,
	 * not mirrored from Live's grid_quantization, ADR-382) and Quantize.
	 */

	const GRID_DENOMS = [4, 8, 16, 32] as const;

	interface Props {
		width: number;
		fold: boolean;
		/** The note value of one grid cell (4 = 1/4, 8 = 1/8, …). */
		gridDenom: number;
		gridTriplet: boolean;
		canQuantize: boolean;
		onQuantize: () => void;
	}

	let {
		width,
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

<div class="edit-toolbar" style:width="{width}px">
	<button
		class="edit-chip"
		class:active={fold}
		onclick={() => (fold = !fold)}
		title="Fold: show only the pitches this clip plays"
	>
		Fold
	</button>

	<span class="toolbar-sep"></span>

	<button class="edit-chip grid-chip" onclick={cycleGrid} title="Snap grid (tap to cycle)">
		{gridLabel}
	</button>
	<button
		class="edit-chip"
		class:active={gridTriplet}
		onclick={() => (gridTriplet = !gridTriplet)}
		title="Triplet grid"
	>
		Triplet
	</button>

	<span class="toolbar-sep"></span>

	<button
		class="edit-chip"
		disabled={!canQuantize}
		onclick={onQuantize}
		title="Quantize every note in the clip to the grid"
	>
		Quantize
	</button>
</div>

<style>
	/* Its own column beside the roll (the canvas stops TOOLBAR_W short of
	   the right edge), so the roll keeps the full height. Chips share the
	   height, up to 72px each. There is no 44px floor (ADR-476): the four
	   need ~242px at it, which a smaller iPad's editor, or the 12.9-inch's
	   with four sections, does not have, and the floor pushed Quantize out
	   of the column; a short chip beats a missing one. The top is padded
	   clear of ClipCentralView's editor-toggle chip, which floats over this
	   corner. */
	.edit-toolbar {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		display: flex;
		flex-direction: column;
		flex-wrap: nowrap;
		gap: var(--spacing-xs);
		padding: 32px 0 0 8px;
		z-index: 20;
		pointer-events: none; /* chips opt back in; gaps pass through */
	}
	.edit-toolbar > * {
		pointer-events: auto;
	}
	.toolbar-sep {
		height: 1px;
		flex: none;
		margin: 3px 0;
		background: var(--line);
		pointer-events: none;
	}
	/* Not `.grid`: that is Tailwind's display:grid utility, and it pinned
	   the label to the top of the chip. */
	.edit-chip.grid-chip {
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.edit-chip {
		flex: 1 1 0;
		min-height: 0;
		max-height: 72px;
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
	:global([data-grammar="flat"]) .toolbar-sep {
		background: var(--line-strong);
	}
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
