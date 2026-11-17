<script lang="ts">
  /**
   * The scale behind an EQ's curve (ADR-544 rollout, 2026-11-17): hairlines
   * at 100 Hz, 1 kHz and 10 kHz and at ±12 dB, each named at the pad's
   * edge, so a flat EQ still reads as a graph and a dot's place as a
   * frequency. The Channel EQ's and EQ Eight's views wrap their
   * `FilterDotsGraph` in it; the Tone Shaper's graph draws the same lines
   * itself.
   *
   * It draws the pad's ground and lays the graph over it with the graph's
   * own ground cleared (`FilterDotsGraph` has no backdrop of its own), on
   * the graph's plot box: its border and its dot-radius inset. `backdrop`
   * is drawn on that box too, under the lines: a live spectrum (ADR-542).
   */
  import type { Snippet } from 'svelte';
  import { axisX, type GraphAxis } from '$lib/utils/filterGraph';

  interface Props {
    /** The graph's frequency ends, Hz. */
    axis: GraphAxis;
    /** The graph's dB from its middle line to an edge. */
    span?: number;
    /** Drawn behind the lines, across the plot's width and the pad's height. */
    backdrop?: Snippet;
    /** The graph itself. */
    children: Snippet;
  }

  let { axis, span = 24, backdrop, children }: Props = $props();

  const HZ_TICKS = [
    { hz: 100, label: '100' },
    { hz: 1000, label: '1k' },
    { hz: 10000, label: '10k' }
  ];
  const DB_TICKS = [12, -12];
  const dbLabel = (db: number) => (db > 0 ? `+${db}` : `${db}`);
</script>

<div class="graph-scale">
  <div class="scale-plot" aria-hidden="true">
    {#if backdrop}<div class="scale-backdrop">{@render backdrop()}</div>{/if}
    {#each HZ_TICKS as tick (tick.hz)}
      <span class="hz-line" style="left: {axisX(axis, tick.hz) * 100}%;"></span>
      <span class="hz-label" style="left: {axisX(axis, tick.hz) * 100}%;">{tick.label}</span>
    {/each}
  </div>
  <div class="scale-rows" aria-hidden="true">
    {#each DB_TICKS as db (db)}
      <span class="db-line" style="bottom: {(0.5 + db / (2 * span)) * 100}%;"></span>
      <span class="db-label" style="bottom: {(0.5 + db / (2 * span)) * 100}%;">{dbLabel(db)}</span>
    {/each}
  </div>
  {@render children()}
</div>

<style>
  .graph-scale {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--surface-well);
    border-radius: var(--radius-sm);
    /* FilterDotsGraph's plot: its 1px border and its 0.875rem inset. */
    --plot-inset: calc(0.875rem + 1px);
  }
  /* The graph draws over the scale: its own ground gives way. */
  .graph-scale > :global(.filter-dots-graph) {
    background: transparent;
  }

  /* Across: the plot's width, the pad's whole height. */
  .scale-plot {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--plot-inset);
    right: var(--plot-inset);
    pointer-events: none;
  }
  /* Up: the plot's height, the pad's whole width. */
  .scale-rows {
    position: absolute;
    top: var(--plot-inset);
    bottom: var(--plot-inset);
    left: 0;
    right: 0;
    pointer-events: none;
  }
  .scale-backdrop {
    position: absolute;
    inset: 0;
  }

  .hz-line,
  .db-line {
    position: absolute;
    background: var(--line-strong);
    opacity: 0.5;
  }
  .hz-line {
    top: 0;
    bottom: 0;
    width: 1px;
  }
  .db-line {
    left: 0;
    right: 0;
    height: 1px;
  }

  /* The Tone Shaper graph's labels: small, tertiary, inside the pad. */
  .hz-label,
  .db-label {
    position: absolute;
    font-size: 0.6875rem;
    line-height: 1;
    color: var(--fg-tertiary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .hz-label {
    bottom: 0.25rem;
    padding-left: 0.25rem;
  }
  .db-label {
    left: 0.375rem;
    padding-bottom: 0.1875rem;
  }
</style>
