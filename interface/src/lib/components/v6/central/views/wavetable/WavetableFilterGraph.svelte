<script lang="ts">
  /**
   * Wavetable's two filters on one pad, as Live's panel draws them
   * (2026-11-05): a numbered dot a filter, cutoff across and resonance up;
   * Serial one curve, the two multiplied, Parallel and Split each filter's
   * own (`wavetableFilterGraph`). A press grabs the nearer dot and the drag
   * moves only that one; the dot of the filter the rows below edit is
   * filled, the other a ring, and a filter that is off is a dashed ring.
   */
  import { drag } from '$lib/actions';
  import type { DragInfo } from '$lib/actions/drag';
  import {
    graphCurves,
    nearerFilter,
    GRAPH_W,
    GRAPH_H,
    type GraphFilter
  } from '$lib/utils/wavetableFilterGraph';

  interface Props {
    filters: readonly [GraphFilter, GraphFilter];
    routing: number;
    /** The filter the type and slope rows edit. */
    selected: 1 | 2;
    /** Each filter's ink, and the serial curve's. */
    colors: readonly [string, string];
    serialColor: string;
    /** A press landed on filter `n`'s side of the pad. */
    onGrab: (n: 1 | 2) => void;
    /** Filter `n` to (x, y), both 0..1, y up. */
    onMove: (n: 1 | 2, x: number, y: number) => void;
  }

  let { filters, routing, selected, colors, serialColor, onGrab, onMove }: Props = $props();

  let curves = $derived(graphCurves(filters, routing));
  let grabbed: 1 | 2 = 1;
  let box: DOMRect | null = null;
  let plot = $state<HTMLElement | null>(null);

  function pointAt(info: DragInfo) {
    if (!box) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (info.x - box.left) / box.width)),
      y: Math.min(1, Math.max(0, 1 - (info.y - box.top) / box.height))
    };
  }

  function down(info: DragInfo) {
    // The plot, inset by a dot's radius so a dot at either end stays whole.
    box = plot?.getBoundingClientRect() ?? null;
    const p = pointAt(info);
    grabbed = nearerFilter(filters, p.x, p.y);
    onGrab(grabbed);
    onMove(grabbed, p.x, p.y);
  }

  function move(info: DragInfo) {
    const p = pointAt(info);
    onMove(grabbed, p.x, p.y);
  }

  const inkOf = (n: 1 | 2 | null) => (n === null ? serialColor : colors[n - 1]);
</script>

<div
  class="wt-filter-graph"
  role="slider"
  tabindex="-1"
  aria-label="Filters: 1 at {Math.round(filters[0].x * 100)}%, 2 at {Math.round(filters[1].x * 100)}%"
  aria-valuenow={Math.round(filters[selected - 1].x * 100)}
  data-wt-filter-graph
  data-routing={routing}
  use:drag={{ commit: 'immediate', onDown: down, onMove: move }}
>
  <div class="plot" bind:this={plot}>
  <svg viewBox="0 0 {GRAPH_W} {GRAPH_H}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" y1={GRAPH_H / 2} x2={GRAPH_W} y2={GRAPH_H / 2} class="zero-line" vector-effect="non-scaling-stroke" />
    {#each curves as curve (curve.filter ?? 0)}
      <path d={curve.d} class="curve-echo" style="stroke: {inkOf(curve.filter)};" vector-effect="non-scaling-stroke" />
      <path d={curve.d} class="curve-line" style="stroke: {inkOf(curve.filter)};" vector-effect="non-scaling-stroke" />
    {/each}
  </svg>

  <!-- The dots, HTML so they stay round on a stretched pad. The selected
       filter's on top. -->
  {#each (selected === 1 ? [2, 1] : [1, 2]) as n (n)}
    {@const f = filters[n - 1]}
    <span
      class="wt-filter-dot"
      class:selected={n === selected}
      class:off={!f.on}
      data-filter={n}
      style="left: {f.x * 100}%; bottom: {f.y * 100}%; --dot-ink: {colors[n - 1]};"
    >{n}</span>
  {/each}
  </div>
</div>

<style>
  .wt-filter-graph {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-well);
    cursor: crosshair;
  }

  .plot {
    position: absolute;
    inset: 0.875rem;
  }

  /* Drawn past the plot into the inset, so a curve runs to the pad's edge
     (the pad clips it). */
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }

  .zero-line {
    stroke: var(--line);
    stroke-width: 1;
    stroke-dasharray: 2 4;
  }

  .curve-echo,
  .curve-line {
    fill: none;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .curve-echo {
    stroke-width: 5;
    opacity: 0.18;
  }
  .curve-line {
    stroke-width: 2;
    opacity: 0.9;
  }

  /* A numbered dot, Live's: the selected filter's filled, the other a ring. */
  .wt-filter-dot {
    position: absolute;
    width: 1.75rem;
    height: 1.75rem;
    margin-left: -0.875rem;
    margin-bottom: -0.875rem;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
    border: 2px solid var(--dot-ink);
    color: var(--dot-ink);
    background: var(--surface-well);
  }
  .wt-filter-dot.selected {
    background: var(--dot-ink);
    color: var(--flat-on-fg);
  }
  .wt-filter-dot.off {
    border-style: dashed;
    opacity: 0.55;
  }
  .wt-filter-dot.off.selected {
    background: var(--surface-well);
    color: var(--dot-ink);
  }
</style>
