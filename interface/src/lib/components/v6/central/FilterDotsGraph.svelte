<script lang="ts">
  /**
   * A filter pad with a dot per filter (2026-11-05): Wavetable's two
   * filters, Drift's low-pass and high-pass. Cutoff across, resonance up;
   * the caller draws the response (`utils/filterGraph`) and says what each
   * dot is. A press grabs the nearest dot and the drag moves only that one.
   * The dot the rows beside the pad edit is filled, the others a ring; a
   * filter that is off is a dashed ring.
   */
  import { drag } from '$lib/actions';
  import type { DragInfo } from '$lib/actions/drag';
  import { nearestDot, GRAPH_W, GRAPH_H } from '$lib/utils/filterGraph';

  export interface GraphDot {
    /** What the dot reads ("1", "HP"). */
    label: string;
    /** 0..1 across, 0..1 up. */
    x: number;
    y: number;
    color: string;
    on: boolean;
    /** The filter the controls beside the pad edit. */
    filled: boolean;
  }

  interface Props {
    dots: readonly GraphDot[];
    curves: readonly { d: string; color: string }[];
    /** A press landed nearest dot `i`. */
    onGrab?: (i: number) => void;
    /** Dot `i` to (x, y), both 0..1, y up. */
    onMove: (i: number, x: number, y: number) => void;
    ariaLabel: string;
  }

  let { dots, curves, onGrab, onMove, ariaLabel }: Props = $props();

  let grabbed = 0;
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
    grabbed = nearestDot(dots, p.x, p.y);
    onGrab?.(grabbed);
    onMove(grabbed, p.x, p.y);
  }

  function move(info: DragInfo) {
    const p = pointAt(info);
    onMove(grabbed, p.x, p.y);
  }

  /** The filled dot last, so it draws on top. */
  let order = $derived(dots.map((_, i) => i).sort((a, b) => Number(dots[a].filled) - Number(dots[b].filled)));
</script>

<div
  class="filter-dots-graph"
  role="slider"
  tabindex="-1"
  aria-label={ariaLabel}
  aria-valuenow={Math.round((dots.find((d) => d.filled)?.x ?? 0) * 100)}
  data-filter-graph
  use:drag={{ commit: 'immediate', onDown: down, onMove: move }}
>
  <div class="plot" bind:this={plot}>
    <svg viewBox="0 0 {GRAPH_W} {GRAPH_H}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1={GRAPH_H / 2} x2={GRAPH_W} y2={GRAPH_H / 2} class="zero-line" vector-effect="non-scaling-stroke" />
      {#each curves as curve, i (i)}
        <path d={curve.d} class="curve-echo" style="stroke: {curve.color};" vector-effect="non-scaling-stroke" />
        <path d={curve.d} class="curve-line" style="stroke: {curve.color};" vector-effect="non-scaling-stroke" />
      {/each}
    </svg>

    <!-- The dots, HTML so they stay round on a stretched pad. -->
    {#each order as i (i)}
      {@const dot = dots[i]}
      <span
        class="graph-dot"
        class:filled={dot.filled}
        class:off={!dot.on}
        class:wide={dot.label.length > 1}
        data-dot={dot.label}
        style="left: {dot.x * 100}%; bottom: {dot.y * 100}%; --dot-ink: {dot.color};"
      >{dot.label}</span>
    {/each}
  </div>
</div>

<style>
  .filter-dots-graph {
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

  /* A labelled dot, Live's: the edited filter's filled, the other a ring. */
  .graph-dot {
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
  .graph-dot.wide {
    font-size: 0.6875rem;
    letter-spacing: -0.02em;
  }
  .graph-dot.filled {
    background: var(--dot-ink);
    color: var(--flat-on-fg);
  }
  .graph-dot.off {
    border-style: dashed;
    opacity: 0.55;
  }
  .graph-dot.off.filled {
    background: var(--surface-well);
    color: var(--dot-ink);
  }
</style>
