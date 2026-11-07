<script lang="ts" module>
  /** One page on the board: its id, and its width in face columns. */
  export interface BoardTile {
    id: string;
    cols: number;
  }

  /** A row of pages, side by side; `weight` its share of the height (1). */
  export interface BoardRow {
    tiles: readonly BoardTile[];
    weight?: number;
  }

  /** A board's columns per row, the widest row first: what a layout is checked by. */
  export function boardRowColumns(rows: readonly BoardRow[]): number[] {
    return rows.map((r) => r.tiles.reduce((n, t) => n + t.cols, 0));
  }
</script>

<script lang="ts">
  /**
   * InstrumentBoard — an instrument at full screen (ADR-512): every section
   * page it opens one at a time on the band, on screen at once, in rows.
   *
   * Each tile is one of the instrument's own pages, drawn by the view (the
   * `tile` snippet) exactly as the band draws it, its face grid and its
   * inset its own. Tiles sit edge to edge with a hairline between, so two
   * tiles' controls are an inset, the hairline and an inset apart: the
   * distance a seam keeps inside a page (ADR-510). A tile takes the row's
   * width in proportion to its face columns, so columns come out near one
   * width across a row, and a row takes the height in proportion to its
   * `weight`.
   */
  import type { Snippet } from 'svelte';
  import SectionDivider from './SectionDivider.svelte';

  interface Props {
    rows: readonly BoardRow[];
    tile: Snippet<[string]>;
    /** The hairlines' ink: the device's. */
    ink?: string;
  }

  let { rows, tile, ink }: Props = $props();
</script>

<div class="board" data-instrument-board>
  {#each rows as row, r (r)}
    {#if r > 0}<div class="board-rule" aria-hidden="true"><SectionDivider orientation="horizontal" {ink} /></div>{/if}
    <div class="board-row" style="flex: {row.weight ?? 1} 1 0;">
      {#each row.tiles as t, i (t.id)}
        {#if i > 0}<div class="board-seam" aria-hidden="true"><SectionDivider orientation="vertical" {ink} /></div>{/if}
        <div class="board-tile" style="flex: {t.cols} 1 0;" data-board-tile={t.id}>{@render tile(t.id)}</div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .board {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .board-row {
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .board-tile {
    min-width: 0;
    min-height: 0;
    height: 100%;
    display: flex;
  }
  .board-tile > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
  .board-seam {
    flex: none;
    width: 1px;
    display: flex;
  }
  .board-rule {
    flex: none;
    height: 1px;
    display: flex;
    padding-inline: var(--central-inset);
  }
  .board-rule > :global(*),
  .board-seam > :global(*) {
    flex: 1 1 auto;
  }
</style>
