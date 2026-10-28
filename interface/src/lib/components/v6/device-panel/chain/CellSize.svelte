<script lang="ts">
  /**
   * Measures the room a chain cell leaves its face and provides it
   * (`cellSize.ts`, ADR-492), so the face can pick the layout that fits.
   * `data-cell-width` and `data-cell-height` carry the steps for CSS and
   * tests.
   */
  import type { Snippet } from 'svelte';
  import { cellHeightClass, cellWidthClass, provideCellSize } from './cellSize';

  let { children }: { children: Snippet } = $props();

  let width = $state(0);
  let height = $state(0);
  const widthClass = $derived(cellWidthClass(width));
  const heightClass = $derived(cellHeightClass(height));

  provideCellSize(() => ({ width, height, widthClass, heightClass }));
</script>

<div class="cell-size" data-cell-width={widthClass} data-cell-height={heightClass} bind:clientWidth={width} bind:clientHeight={height}>
  {@render children()}
</div>

<style>
  .cell-size {
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .cell-size > :global(*) {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }
</style>
