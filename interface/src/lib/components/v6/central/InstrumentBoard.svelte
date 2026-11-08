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
   * `tile` snippet), usually as a `BoardTile`: a header bar naming the
   * section over its face grid. The tiles are panels (ADR-516): each on a
   * surface a shade off the frame's, framed by a hairline, a gap between
   * two, so a board of a hundred knobs reads as its sections first. (Until
   * ADR-516 the tiles met edge to edge with a hairline between, which on
   * the dark skin was all but invisible.) A tile takes the row's width in
   * proportion to its face columns, so columns come out near one width
   * across a row, and a row takes the height in proportion to its
   * `weight`.
   */
  import type { Snippet } from 'svelte';

  interface Props {
    rows: readonly BoardRow[];
    tile: Snippet<[string]>;
    /** The device's ink: the board's own tint (`--board-ink`). */
    ink?: string;
  }

  let { rows, tile, ink }: Props = $props();
</script>

<div class="board" data-instrument-board style={ink ? `--board-ink: ${ink};` : undefined}>
  {#each rows as row, r (r)}
    <div class="board-row" style="flex-grow: {row.weight ?? 1};">
      {#each row.tiles as t (t.id)}
        <div class="board-tile" style="flex-grow: {t.cols};" data-board-tile={t.id}>{@render tile(t.id)}</div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .board {
    /* The gap between two panels, and the board's own margin. */
    --board-gap: 0.5rem;
    /* A panel's surface: between the frame's ground and a well, so a
       well (a picture, a field) still reads as sunk into it. */
    --board-panel-bg: color-mix(in oklab, var(--surface-well) 42%, var(--central-display-default-bg));
    --board-panel-line: var(--line);
    --board-head-h: 2.25rem;
    /* A pick on a board is a touch row (ChoicePicker's height). */
    --picker-h: var(--height-touch);
    display: flex;
    flex-direction: column;
    gap: var(--board-gap);
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    box-sizing: border-box;
    padding: var(--board-gap);
  }
  .board-row {
    flex: 1 1 0;
    display: flex;
    gap: var(--board-gap);
    min-width: 0;
    min-height: 0;
  }
  .board-tile {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    height: 100%;
    display: flex;
    background: var(--board-panel-bg);
    border: 1px solid var(--board-panel-line);
    border-radius: 6px;
    overflow: hidden;
  }
  .board-tile > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
</style>
