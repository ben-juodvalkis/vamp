<script lang="ts" module>
  import { ratioFromSlider, sliderFromRatio } from '../../../device-panel/multibandParams';

  /**
   * Where a ratio sits in its block, 0..1 up the block, and back. The
   * middle is 1 : 1 in both. Above runs -1 (1 : Inf, downward compression)
   * at the floor to 1 (1 : 0.50, upward expansion) at the top; Below runs
   * -3 (1 : 0.25, downward expansion) at the floor to 1 (1 : Inf, upward
   * compression) at the top, each half linear on its own scale (the chain
   * cell's rail, `sliderFromRatio`). Up is louder in both, as on Live's
   * display (Live 12 manual, 29.26.2).
   */
  export function ratioUnit(block: 'above' | 'below', ratio: number): number {
    return block === 'above' ? Math.min(1, Math.max(0, (ratio + 1) / 2)) : sliderFromRatio(ratio);
  }

  export function ratioFromUnit(block: 'above' | 'below', u: number): number {
    const t = Math.min(1, Math.max(0, u));
    return block === 'above' ? 2 * t - 1 : ratioFromSlider(t);
  }

  /** What a press at `x` (px from the display's left) takes: a threshold's edge within `reach`, else the block it is in. */
  export function bandTarget(
    x: number,
    belowX: number,
    aboveX: number,
    reach: number
  ): 'below-threshold' | 'above-threshold' | 'below-ratio' | 'above-ratio' | null {
    const dBelow = Math.abs(x - belowX);
    const dAbove = Math.abs(x - aboveX);
    if (Math.min(dBelow, dAbove) <= reach) return dBelow <= dAbove ? 'below-threshold' : 'above-threshold';
    if (x < belowX) return 'below-ratio';
    if (x > aboveX) return 'above-ratio';
    return null;
  }
</script>

<script lang="ts">
  /**
   * BandDynamicsDisplay — one band of Multiband Dynamics as Live draws it
   * (ADR-515; Live 12 manual, 29.26.2): a dB scale across, the Below block
   * on the left up to the Below threshold and the Above block on the right
   * from the Above threshold. A finger on a block's edge drags its
   * threshold across; inside a block it drags that block's ratio up or
   * down, up louder (raising Below is upward compression, lowering Above
   * downward compression). Drags are relative and own their pointer, as
   * the envelope and LFO pictures do (ADR-514). The line in each block
   * reads its ratio, filled from 1 : 1 to where it stands.
   */
  import type { PanelParams } from '../panel/usePanelParams.svelte';

  interface Props {
    params: PanelParams;
    /** Live's band name in the parameter names: Low, Mid, High. */
    band: 'Low' | 'Mid' | 'High';
    ink: string;
    /** `Band Activator (<band>)`: an off band ghosts and turns on at the first drag. */
    sw?: string;
  }

  let { params, band, ink, sw }: Props = $props();

  const MIN_DB = -80;
  const MAX_DB = 0;
  const REACH = 22;
  const name = $derived({
    belowThreshold: `Below Threshold (${band})`,
    aboveThreshold: `Above Threshold (${band})`,
    belowRatio: `Below Ratio (${band})`,
    aboveRatio: `Above Ratio (${band})`
  });

  let w = $state(0);
  let h = $state(0);
  const xOf = (dB: number) => ((Math.min(MAX_DB, Math.max(MIN_DB, dB)) - MIN_DB) / (MAX_DB - MIN_DB)) * w;

  let belowDb = $derived(params.raw(name.belowThreshold) ?? -60);
  let aboveDb = $derived(params.raw(name.aboveThreshold) ?? -20);
  let belowX = $derived(xOf(belowDb));
  let aboveX = $derived(xOf(aboveDb));
  let belowU = $derived(ratioUnit('below', params.raw(name.belowRatio) ?? 0));
  let aboveU = $derived(ratioUnit('above', params.raw(name.aboveRatio) ?? 0));
  let on = $derived(!sw || params.isOn(sw));
  const yOf = (u: number) => h - u * h;

  type Target = NonNullable<ReturnType<typeof bandTarget>>;
  let drag: { pointer: number; x0: number; y0: number; target: Target; start: number } | null = null;
  let hot = $state<Target | null>(null);

  function down(e: PointerEvent) {
    if (drag) return;
    const box = (e.currentTarget as Element).getBoundingClientRect();
    const target = bandTarget(e.clientX - box.left, belowX, aboveX, REACH);
    if (!target) return;
    const start =
      target === 'below-threshold' ? belowDb : target === 'above-threshold' ? aboveDb : target === 'below-ratio' ? belowU : aboveU;
    drag = { pointer: e.pointerId, x0: e.clientX, y0: e.clientY, target, start };
    hot = target;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const { target, start } = drag;
    if (target === 'below-threshold' || target === 'above-threshold') {
      const dB = start + ((e.clientX - drag.x0) / Math.max(1, w)) * (MAX_DB - MIN_DB);
      // A threshold stops at the other: Below never passes Above.
      const clamped =
        target === 'below-threshold' ? Math.min(aboveDb, Math.max(MIN_DB, dB)) : Math.max(belowDb, Math.min(MAX_DB, dB));
      params.write(target === 'below-threshold' ? name.belowThreshold : name.aboveThreshold, clamped, sw);
    } else {
      const u = start - (e.clientY - drag.y0) / Math.max(120, h);
      const block = target === 'below-ratio' ? 'below' : 'above';
      params.write(block === 'below' ? name.belowRatio : name.aboveRatio, ratioFromUnit(block, u), sw);
    }
  }

  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    drag = null;
    hot = null;
  }

  const TICKS = [-60, -40, -20];
</script>

<div
  class="band-display"
  class:off={!on}
  bind:clientWidth={w}
  bind:clientHeight={h}
  role="group"
  aria-label="{band} band dynamics"
  data-band-display={band}
  style="--ink: {ink};"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
>
  {#if w > 0 && h > 0}
    <svg width={w} height={h} aria-hidden="true">
      {#each TICKS as t (t)}
        <line class="tick" x1={xOf(t)} x2={xOf(t)} y1="0" y2={h} />
      {/each}
      <line class="unity" x1="0" x2={w} y1={h / 2} y2={h / 2} />
      <!-- Below: from the floor of the scale to its threshold. -->
      <rect class="block" class:hot={hot === 'below-ratio'} x="0" y="0" width={belowX} height={h} />
      <rect class="level" x="0" y={Math.min(yOf(belowU), h / 2)} width={belowX} height={Math.abs(yOf(belowU) - h / 2)} />
      <line class="ratio" x1="0" x2={belowX} y1={yOf(belowU)} y2={yOf(belowU)} />
      <!-- Above: from its threshold to 0 dB. -->
      <rect class="block" class:hot={hot === 'above-ratio'} x={aboveX} y="0" width={Math.max(0, w - aboveX)} height={h} />
      <rect class="level" x={aboveX} y={Math.min(yOf(aboveU), h / 2)} width={Math.max(0, w - aboveX)} height={Math.abs(yOf(aboveU) - h / 2)} />
      <line class="ratio" x1={aboveX} x2={w} y1={yOf(aboveU)} y2={yOf(aboveU)} />
      <line class="edge" class:hot={hot === 'below-threshold'} x1={belowX} x2={belowX} y1="0" y2={h} />
      <line class="edge" class:hot={hot === 'above-threshold'} x1={aboveX} x2={aboveX} y1="0" y2={h} />
    </svg>
    <span class="readout below" style="left: {Math.max(76, belowX - 4)}px;">
      {params.display(name.belowThreshold) ?? `${belowDb.toFixed(1)} dB`}<br />{params.display(name.belowRatio) ?? ''}
    </span>
    <span class="readout above" style="left: {Math.min(w - 76, aboveX + 4)}px;">
      {params.display(name.aboveThreshold) ?? `${aboveDb.toFixed(1)} dB`}<br />{params.display(name.aboveRatio) ?? ''}
    </span>
  {/if}
</div>

<style>
  .band-display {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    background: var(--surface-well);
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    overflow: hidden;
    touch-action: none;
    cursor: ew-resize;
  }
  .band-display.off {
    opacity: var(--opacity-ghost);
  }
  svg {
    position: absolute;
    inset: 0;
  }
  .tick {
    stroke: var(--line-strong);
    stroke-width: 1;
    opacity: 0.5;
  }
  .unity {
    stroke: var(--line-strong);
    stroke-dasharray: 2 4;
  }
  .block {
    fill: var(--ink);
    opacity: 0.1;
  }
  .block.hot {
    opacity: 0.2;
  }
  .level {
    fill: var(--ink);
    opacity: 0.35;
  }
  .ratio {
    stroke: var(--ink);
    stroke-width: 2;
  }
  .edge {
    stroke: var(--ink);
    stroke-width: 2;
  }
  .edge.hot {
    stroke-width: 4;
  }
  .readout {
    position: absolute;
    top: 4px;
    font-size: 0.6875rem;
    line-height: 0.875rem;
    color: var(--ink);
    white-space: nowrap;
    pointer-events: none;
    font-variant-numeric: tabular-nums;
  }
  .readout.below {
    transform: translateX(-100%);
    text-align: right;
  }
  .readout.above {
    text-align: left;
  }
</style>
