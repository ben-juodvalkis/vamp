<script lang="ts" module>
  import type { CellSize } from './cellSize';

  /**
   * A tall cell gives the macros the room under the rack's mark, a meter as
   * tall as the cell allows; a short one (a two-row chain), or no cell at
   * all, keeps them a strip along the bottom.
   */
  export function rackMacrosFill(size: CellSize | null): boolean {
    return size?.heightClass === 'tall';
  }
</script>

<script lang="ts">
  /**
   * A rack's face in the chain overview: its mark, then its named macros as
   * a meter each (ADR-492, 2026-10-28). In a one-row chain's tall cell the
   * strip of 22px meters left most of the cell empty; there they rise to
   * fill it, under a mark that keeps its size.
   */
  import type { Snippet } from 'svelte';
  import { useCellSize } from './cellSize';

  interface Props {
    /** The macros, 0..1, named; at most eight. */
    macros: { name: string; value: number }[];
    /** The rack's mark (its glyph). */
    children: Snippet;
  }

  let { macros, children }: Props = $props();

  const cellSize = useCellSize();
  const fill = $derived(rackMacrosFill(cellSize()));
</script>

<div class="rack-face" class:fill>
  <div class="rack-mark">{@render children()}</div>
  {#if macros.length > 0}
    <div class="macros" aria-hidden="true">
      {#each macros as m (m.name)}
        <span class="macro" style="--v: {m.value};" title={m.name}></span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .rack-face {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    min-height: 0;
  }
  .rack-mark {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }
  /* The mark keeps its own height; the meters take the rest. */
  .fill .rack-mark {
    flex: 0 0 auto;
    padding-top: 8px;
  }
  .macros {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 22px;
    flex: 0 0 auto;
  }
  .fill .macros {
    flex: 1 1 auto;
    height: auto;
    min-height: 22px;
  }
  .macro {
    flex: 1 1 0;
    height: 100%;
    background: linear-gradient(to top, var(--cell-ink) calc(var(--v) * 100%), color-mix(in oklab, var(--cell-ink) 15%, transparent) 0);
    border-radius: 1px;
  }
</style>
