<script lang="ts">
  /**
   * The knob face (ADR-509): a value drawn as an arc, nothing else.
   *
   * Drawing only. `DeviceSlider face="knob"` owns the gesture (the same
   * relative drag as a value box, over the same travel) and mounts this in
   * place of its fill, so a knob and a box differ in what they draw and in
   * nothing a finger can feel. The whole cell is the touch target, not the
   * circle.
   *
   * A 270-degree arc in the device ink, filled from its start, or from its top
   * for a bipolar control. A short mark outside the ring at the start (or at
   * the top) says where zero is, since an arc at zero is otherwise an empty
   * ring. The control's glyph sits in the middle at rest and Live's value
   * while a finger drags it; the name sits under the knob, and the value at
   * rest under the name when the host passes one. The glyph goes on a knob
   * under 56px across, where it is too small to read. A stepped control
   * (`steps`, up to 24) wears a detent for each value in place of the zero
   * mark, the one it rests on in the ink.
   */
  import ControlGlyph, { type ControlGlyphName } from './ControlGlyph.svelte';

  interface Props {
    /** The value's position along the arc, 0..1. */
    position: number;
    /** Where a bipolar arc fills from, 0..1 (its zero); unset, from the start. */
    origin?: number;
    title?: string;
    /** Shown under the name at rest: the value in Live's words. */
    valueText?: string;
    /** Shown in the middle while dragged: Live's value as it is written. */
    readout?: string;
    icon?: ControlGlyphName;
    dragging?: boolean;
    ink: string;
    /** How many values a stepped control has: a detent each, up to 24. */
    steps?: number;
  }

  let { position, origin, title = '', valueText, readout, icon, dragging = false, ink, steps }: Props = $props();

  const MAX_DETENTS = 24;

  const START = 135; // degrees in SVG's frame: 0 = right, clockwise
  const SWEEP = 270;
  const R = 38;

  function polar(deg: number, r: number): [number, number] {
    const a = (deg * Math.PI) / 180;
    return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
  }

  function arc(fromDeg: number, toDeg: number): string {
    if (toDeg < fromDeg) [fromDeg, toDeg] = [toDeg, fromDeg];
    if (toDeg - fromDeg < 0.01) return '';
    const [x0, y0] = polar(fromDeg, R);
    const [x1, y1] = polar(toDeg, R);
    return `M ${x0} ${y0} A ${R} ${R} 0 ${toDeg - fromDeg > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  }

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  let angle = $derived(START + SWEEP * clamp01(position));
  let zero = $derived(START + SWEEP * clamp01(origin ?? 0));
  let mark = $derived([polar(zero, 46), polar(zero, 51)]);
  let centreText = $derived(dragging && readout ? readout : '');

  // One detent a value, the one the knob rests on lit.
  let detents = $derived.by(() => {
    if (!steps || steps < 2 || steps > MAX_DETENTS) return [];
    const at = Math.round(clamp01(position) * (steps - 1));
    return Array.from({ length: steps }, (_, i) => {
      const a = START + (SWEEP * i) / (steps - 1);
      return { from: polar(a, 46), to: polar(a, 51), on: i === at };
    });
  });
</script>

<div class="knob" class:dragging style="--knob-ink: {ink};">
  <div class="knob-body">
  <div class="knob-face">
    <svg class="knob-svg" viewBox="0 0 100 100" aria-hidden="true">
      <path class="knob-track" d={arc(START, START + SWEEP)} />
      {#if detents.length}
        {#each detents as d, i (i)}
          <line class="knob-detent" class:on={d.on} x1={d.from[0]} y1={d.from[1]} x2={d.to[0]} y2={d.to[1]} />
        {/each}
      {:else}
        <line class="knob-zero" x1={mark[0][0]} y1={mark[0][1]} x2={mark[1][0]} y2={mark[1][1]} />
      {/if}
      <path class="knob-value" d={arc(zero, angle)} />
    </svg>
    {#if centreText}
      <span class="knob-centre knob-readout">{centreText}</span>
    {:else if icon}
      <span class="knob-centre knob-icon" aria-hidden="true"><ControlGlyph name={icon} /></span>
    {/if}
  </div>
  {#if title || valueText}
    <div class="knob-caption">
      {#if title}<span class="knob-title">{title}</span>{/if}
      {#if valueText}<span class="knob-value-text">{valueText}</span>{/if}
    </div>
  {/if}
  </div>
</div>

<style>
  /* The cell is the query container; the body lays the knob and its
     caption out inside it, centred together. */
  .knob {
    width: 100%;
    height: 100%;
    container-type: size;
    pointer-events: none;
  }
  .knob-body {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    display: grid;
    grid-template-rows: auto auto;
    align-content: center;
    justify-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.25rem;
  }
  /* A wide, short cell puts the caption beside the knob. */
  @container (min-aspect-ratio: 6/5) {
    .knob-body {
      grid-template-rows: auto;
      grid-template-columns: auto auto;
      justify-content: center;
      align-items: center;
      gap: 0.625rem;
    }
  }

  /* Sized off the cell's short side, less the caption under it. */
  .knob-face {
    position: relative;
    container-type: size;
    --knob-d: max(28px, min(100cqw - 0.5rem, 100cqh - 3.25rem, 150px));
    width: var(--knob-d);
    height: var(--knob-d);
  }
  @container (min-aspect-ratio: 6/5) {
    .knob-face {
      --knob-d: max(28px, min(100cqh - 0.75rem, 50cqw, 150px));
    }
  }
  .knob-svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .knob-track,
  .knob-value {
    fill: none;
    stroke-width: 12;
    stroke-linecap: butt;
    transition: stroke-width 0.1s ease-out;
  }
  .knob-track {
    stroke: var(--surface-well);
  }
  .knob-value {
    stroke: var(--knob-ink);
  }
  .dragging .knob-value {
    stroke-width: 14;
  }
  .knob-zero,
  .knob-detent {
    stroke: var(--signal-dim);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .knob-detent.on {
    stroke: var(--knob-ink);
    stroke-width: 3;
  }

  .knob-centre {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    color: var(--knob-ink);
  }
  .knob-icon {
    display: flex;
    width: 40%;
    height: 40%;
  }
  .knob-icon :global(svg) {
    width: 100%;
    height: 100%;
  }
  @container (max-width: 56px) {
    .knob-icon {
      display: none;
    }
  }
  .knob-readout {
    max-width: 62%;
    font-size: clamp(10px, 15cqw, 22px);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: center;
    line-height: 1.05;
    overflow-wrap: anywhere;
  }

  .knob-caption {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    max-width: 100%;
    line-height: 1.15;
    text-align: center;
  }
  @container (min-aspect-ratio: 6/5) {
    .knob-caption {
      align-items: flex-start;
      text-align: left;
    }
  }
  .knob-title {
    max-width: 100%;
    /* Shrinks in a narrow cell rather than breaking a word. */
    font-size: clamp(10px, 15cqw, 15px);
    font-weight: 500;
    color: var(--knob-ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Beside the knob the name has the cell's width less the knob's. */
  @container (min-aspect-ratio: 6/5) {
    .knob-title {
      font-size: clamp(10px, 9.5cqw, 15px);
    }
  }
  .knob-value-text {
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: var(--signal-dim);
    white-space: nowrap;
  }

  /* Light: the ink's fill envelope is too pale for text on paper. */
  /* Light: the well is near white on paper, so the empty ring would vanish. */
  :global(.light) .knob-track {
    stroke: color-mix(in oklab, var(--foreground) 14%, var(--surface-well));
  }
  :global(.light) .knob-title,
  :global(.light) .knob-readout,
  :global(.light) .knob-icon {
    color: color-mix(in oklab, var(--knob-ink) 55%, var(--foreground));
  }
</style>
