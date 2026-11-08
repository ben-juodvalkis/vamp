<script lang="ts" module>
  /**
   * One cycle of an LFO's shape, by the name Live gives it, as a function of
   * phase 0..1 to -1..1. Names are matched loosely, since every instrument
   * spells its list its own way ("Rect", "Square", "Pulse"; "S&H", "Noise",
   * "Random"). An unknown name draws a sine.
   */
  export function lfoShape(name: string | undefined): (t: number) => number {
    const n = (name ?? '').toLowerCase();
    const frac = (t: number) => t - Math.floor(t);
    // A fixed staircase, so a noise wave draws the same every frame.
    const steps = [0.2, -0.7, 0.9, -0.1, 0.5, -0.9, 0.3, -0.4];
    if (/tri/.test(n)) return (t) => 1 - 4 * Math.abs(frac(t + 0.25) - 0.5);
    if (/saw.*up|ramp.*up|up/.test(n)) return (t) => 2 * frac(t) - 1;
    if (/saw|ramp/.test(n)) return (t) => 1 - 2 * frac(t);
    if (/rect|squ|puls/.test(n)) return (t) => (frac(t) < 0.5 ? 1 : -1);
    if (/noise|s ?& ?h|s\+h|rand|sample/.test(n)) return (t) => steps[Math.floor(frac(t) * steps.length)];
    if (/wander|smooth/.test(n)) return (t) => 0.6 * Math.sin(2 * Math.PI * t) + 0.3 * Math.sin(6 * Math.PI * t + 1);
    if (/exp|env/.test(n)) return (t) => 2 * Math.exp(-5 * frac(t)) - 1;
    return (t) => Math.sin(2 * Math.PI * t);
  }
</script>

<script lang="ts">
  /**
   * LfoGraph — an LFO as Live draws it (ADR-514): its wave on a dark
   * display, as many cycles as its rate asks for, as tall as its amount.
   * Up and down sets the amount, left and right the rate, relative to where
   * the finger lands, so the picture is the LFO's XY. Either may be left
   * out; then the picture draws it at a middle value and the axis moves
   * nothing.
   */
  import type { PanelParams } from './views/panel/usePanelParams.svelte';

  interface Props {
    params: PanelParams;
    /** The shape's name, as the instrument's wave list labels it. */
    shape: string | undefined;
    rate?: string;
    amount?: string;
    ink: string;
    sw?: string;
    label?: string;
    /**
     * False draws the picture alone: an effect whose chain cell already
     * moves its rate and amount on an XY (ADR-510: no view repeats it).
     */
    interactive?: boolean;
    /** The wave's horizontal shift, 0..1 of a cycle (an effect's phase or offset). */
    phase?: number;
  }

  let { params, shape, rate, amount, ink, sw, label, interactive = true, phase = 0 }: Props = $props();

  /** The cell's size; the picture keeps a landscape shape inside it (ADR-514: a tall, narrow one reads badly). */
  let cw = $state(0);
  let ch = $state(0);
  const MAX_ASPECT = 0.6;
  let w = $derived(cw);
  let h = $derived(Math.min(ch, Math.round(cw * MAX_ASPECT)));
  const PAD = 8;

  let fn = $derived(lfoShape(shape));
  // With no rate to read, as many cycles as the picture's shape suits.
  let cycles = $derived(
    rate ? 1 + Math.round((params.unit(rate) ?? 0.4) * 6) : Math.max(1, Math.min(4, Math.round((w / Math.max(1, h)) * 1.2)))
  );
  let depth = $derived(amount ? (params.unit(amount) ?? 1) : 1);
  let path = $derived.by(() => {
    if (w <= 0 || h <= 0) return '';
    const n = 160;
    const mid = h / 2;
    const amp = (h / 2 - PAD) * Math.max(0.04, depth);
    let d = '';
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = PAD + t * (w - 2 * PAD);
      const y = mid - fn(t * cycles + phase) * amp;
      d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return d;
  });

  let on = $derived(!sw || params.isOn(sw));
  let drag: { pointer: number; x0: number; y0: number; r?: number; a?: number } | null = null;
  let hot = $state(false);

  function down(e: PointerEvent) {
    if (drag || !interactive) return;
    drag = { pointer: e.pointerId, x0: e.clientX, y0: e.clientY, r: rate ? params.unit(rate) : undefined, a: amount ? params.unit(amount) : undefined };
    hot = true;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }
  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (rate && drag.r !== undefined) params.writeUnit(rate, drag.r + (e.clientX - drag.x0) / Math.max(120, w), sw);
    if (amount && drag.a !== undefined) params.writeUnit(amount, drag.a - (e.clientY - drag.y0) / Math.max(120, h), sw);
  }
  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    drag = null;
    hot = false;
  }
  let readout = $derived(
    [rate ? params.display(rate) : undefined, amount ? params.display(amount) : undefined].filter(Boolean).join(' · ')
  );
</script>

<div class="graph-cell" bind:clientWidth={cw} bind:clientHeight={ch}>
<div class="lfo-graph"
  style:height={cw > 0 ? `${h}px` : '100%'} class:off={!on} style="--lfo-ink: {ink};" data-lfo-graph={shape ?? ''}>
  <svg
    width={w}
    height={h}
    role={interactive ? 'slider' : 'img'}
    tabindex="-1"
    aria-label={interactive ? `${label ?? 'LFO'}: rate across, amount up` : `${label ?? 'LFO'}: ${shape ?? ''}`}
    aria-valuenow={interactive ? Math.round(depth * 100) : undefined}
    aria-valuetext={interactive ? `rate ${Math.round((rate ? (params.unit(rate) ?? 0) : 0) * 100)}%, amount ${Math.round(depth * 100)}%` : undefined}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    style="touch-action: {interactive ? 'none' : 'auto'}; cursor: {interactive ? 'grab' : 'default'};"
  >
    {#if w > 0 && h > 0}
      <line class="axis" x1={PAD} x2={w - PAD} y1={h / 2} y2={h / 2} />
      <path class="wave" class:hot d={path} />
    {/if}
  </svg>
  {#if label}<span class="label">{label}</span>{/if}
  {#if hot && readout}<span class="readout">{readout}</span>{/if}
</div>
</div>

<style>
  .graph-cell {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    display: flex;
    align-items: center;
  }
  .lfo-graph {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    background: var(--surface-well);
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    overflow: hidden;
  }
  .lfo-graph.off {
    opacity: var(--opacity-ghost);
  }
  svg {
    position: absolute;
    inset: 0;
    display: block;
    cursor: grab;
  }
  .axis {
    stroke: var(--line-strong);
    stroke-dasharray: 2 4;
  }
  .wave {
    fill: none;
    stroke: var(--lfo-ink);
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .wave.hot {
    stroke-width: 2.5;
  }
  .label,
  .readout {
    position: absolute;
    top: 6px;
    font-size: 0.6875rem;
    font-weight: 700;
    line-height: 1;
    color: var(--lfo-ink);
    pointer-events: none;
  }
  .label {
    left: 8px;
    opacity: 0.85;
  }
  .readout {
    right: 8px;
    font-variant-numeric: tabular-nums;
  }
</style>
