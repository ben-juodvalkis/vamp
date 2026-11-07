<script lang="ts">
  /**
   * ShaperCurve — a Roar stage's shaper as Live draws it (ADR-515): its
   * transfer curve on a dark display, input across and output up, over the
   * straight line of no shaping. Dragged as Live's is (manual 29.33.2: drag
   * the shaper waveform to set its amount): up and down set Amount, and
   * left and right set Bias, relative to where the finger lands. The curves
   * are `roarShaperCurve`'s pictures of each type, not measured off Live.
   */
  import type { PanelParams } from '../panel/usePanelParams.svelte';
  import { roarShaperCurve } from '../../../device-panel/roarParams';

  interface Props {
    params: PanelParams;
    /** The stage, 1..3. */
    n: number;
    ink: string;
  }

  let { params, n, ink }: Props = $props();

  let amountName = $derived(`Shaper ${n} Amt`);
  let biasName = $derived(`Shaper ${n} Bias`);
  let typeName = $derived(`Shaper ${n} Type`);
  let switchName = $derived(`Shaper ${n} On`);

  let w = $state(0);
  let h = $state(0);
  const PAD = 6;

  let amount = $derived(params.raw(amountName) ?? 0);
  let bias = $derived(params.raw(biasName) ?? 0.5);
  let type = $derived(Math.round(params.raw(typeName) ?? 0));
  let on = $derived(params.isOn(switchName));

  let path = $derived.by(() => {
    if (w <= 0 || h <= 0) return '';
    const fn = roarShaperCurve(type, amount, bias);
    const n = 200;
    let d = '';
    for (let i = 0; i <= n; i++) {
      const x = -1 + (2 * i) / n;
      const px = PAD + ((x + 1) / 2) * (w - 2 * PAD);
      const py = PAD + ((1 - fn(x)) / 2) * (h - 2 * PAD);
      d += `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`;
    }
    return d;
  });

  let drag: { pointer: number; x0: number; y0: number; a: number; b: number } | null = null;
  let hot = $state(false);

  function down(e: PointerEvent) {
    if (drag) return;
    drag = { pointer: e.pointerId, x0: e.clientX, y0: e.clientY, a: amount, b: bias };
    hot = true;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const a = Math.min(1, Math.max(0, drag.a - (e.clientY - drag.y0) / Math.max(120, h)));
    const b = Math.min(1, Math.max(0, drag.b + (e.clientX - drag.x0) / Math.max(160, w)));
    params.write(amountName, a, switchName);
    params.write(biasName, b, switchName);
  }

  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    drag = null;
    hot = false;
  }

  let readout = $derived([params.display(amountName), params.display(biasName)].filter(Boolean).join(' · '));
</script>

<div
  class="shaper"
  class:off={!on}
  class:hot
  bind:clientWidth={w}
  bind:clientHeight={h}
  role="slider"
  aria-label="Shaper {n} amount"
  aria-valuemin={0}
  aria-valuemax={1}
  aria-valuenow={amount}
  tabindex="-1"
  data-roar-shaper={n}
  style="--ink: {ink};"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
>
  {#if w > 0 && h > 0}
    <svg width={w} height={h} aria-hidden="true">
      <line class="axis" x1={PAD} x2={w - PAD} y1={h / 2} y2={h / 2} />
      <line class="axis" x1={w / 2} x2={w / 2} y1={PAD} y2={h - PAD} />
      <line class="unity" x1={PAD} y1={h - PAD} x2={w - PAD} y2={PAD} />
      <path d={path} />
    </svg>
    {#if hot && readout}<span class="readout">{readout}</span>{/if}
  {/if}
</div>

<style>
  .shaper {
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
    cursor: ns-resize;
  }
  .shaper.off {
    opacity: var(--opacity-ghost);
  }
  svg {
    position: absolute;
    inset: 0;
  }
  .axis {
    stroke: var(--line-strong);
    stroke-width: 1;
    opacity: 0.5;
  }
  .unity {
    stroke: var(--line-strong);
    stroke-dasharray: 2 4;
  }
  path {
    fill: none;
    stroke: var(--ink);
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .readout {
    position: absolute;
    left: 6px;
    top: 4px;
    font-size: 0.6875rem;
    color: var(--ink);
    pointer-events: none;
    font-variant-numeric: tabular-nums;
  }
</style>
