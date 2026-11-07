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
   * while a finger drags it. The caption (the name, and the value at rest
   * under it when the host passes one) sits under the knob, or beside it,
   * left-aligned, in a cell wider than 6:5: a short, wide cell has no height
   * to spare for a caption under it.
   * A knob is one of three sizes (`size`), set by how many knobs its column
   * stacks (`knobSizeFor`): 'l' 96px across for one or two, 'm' 70px for
   * three, 's' 48px for four or more; it is that size centred in its cell, and
   * shrinks (to a 28px floor) only in a cell too small to hold it with its
   * caption. Its caption's type is fixed by the size, not the cell.
   * The glyph goes on a knob under 56px across, where it is too small to
   * read. A stepped control
   * (`steps`, up to 24) wears a detent for each value in place of the zero
   * mark, the one it rests on in the ink.
   */
  import ControlGlyph, { type ControlGlyphName } from './ControlGlyph.svelte';
  import { knobSizeFits } from './knobLayout';

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
    /** The knob's size, by its column's count (`knobSizeFor`): s 48px, m 70px, l 96px. */
    size?: 's' | 'm' | 'l' | 'xl';
    /**
     * False draws no caption: the knob takes the cell's height, and `centreMark`
     * or the glyph alone says what it is (Drift's level knobs, 2026-11-06).
     * The name still reaches assistive tech through the host's aria-label.
     */
    caption?: boolean;
    /** A short text drawn in the middle at rest in place of the glyph ("1", "2"). */
    centreMark?: string;
    /**
     * Treat `size` as a ceiling: draw the largest size the cell holds at its
     * full diameter (`knobSizeFits`), never a clamped one. For hosts whose
     * cells come from data, not a hand layout: the instrument panels.
     */
    fit?: boolean;
  }

  let { position, origin, title = '', valueText, readout, icon, dragging = false, ink, steps, size = 'm', caption = true, centreMark, fit = false }: Props = $props();

  let cell = $state<HTMLDivElement>();
  let box = $state({ w: 0, h: 0 });
  $effect(() => {
    if (!fit || !cell || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      box = { w: entry.contentRect.width, h: entry.contentRect.height };
    });
    observer.observe(cell);
    return () => observer.disconnect();
  });
  let drawn = $derived<'s' | 'm' | 'l' | 'xl'>(fit && box.w > 0 ? knobSizeFits(size, box.w, box.h, caption) : size);

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
  let mark = $derived([polar(zero, 46), polar(zero, 49.5)]);
  let centreText = $derived(dragging && readout ? readout : '');

  // One detent a value, the one the knob rests on lit.
  let detents = $derived.by(() => {
    if (!steps || steps < 2 || steps > MAX_DETENTS) return [];
    const at = Math.round(clamp01(position) * (steps - 1));
    return Array.from({ length: steps }, (_, i) => {
      const a = START + (SWEEP * i) / (steps - 1);
      return { from: polar(a, 46), to: polar(a, 49.5), on: i === at };
    });
  });
</script>

<div class="knob size-{drawn}" bind:this={cell} class:dragging class:no-caption={!caption} data-knob-size={drawn} style="--knob-ink: {ink};">
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
    {:else if centreMark}
      <span class="knob-centre knob-mark" aria-hidden="true">{centreMark}</span>
    {:else if icon}
      <span class="knob-centre knob-icon" aria-hidden="true"><ControlGlyph name={icon} /></span>
    {/if}
  </div>
  {#if caption && (title || valueText)}
    <div class="knob-caption">
      {#if title}<span class="knob-title">{title}</span>{/if}
      {#if valueText}<span class="knob-value-text">{valueText}</span>{/if}
    </div>
  {/if}
  </div>
</div>

<style>
  /* The cell is the query container; the body lays the knob and its
     caption under it out inside it, centred together. Each size fixes the
     knob's diameter, its caption's type, and the height that caption takes
     (gap and padding included) for the guard against a small cell. */
  .knob {
    width: 100%;
    height: 100%;
    container-type: size;
    pointer-events: none;
    --knob-want: 70px;
    --knob-title-fs: 15px;
    --knob-value-fs: 12px;
    --knob-caption-h: 3.125rem;
  }
  .knob.size-s {
    --knob-want: 48px;
    --knob-title-fs: 12px;
    --knob-value-fs: 10px;
    --knob-caption-h: 2.75rem;
  }
  .knob.size-l {
    --knob-want: 96px;
    --knob-title-fs: 17px;
    --knob-value-fs: 14px;
    --knob-caption-h: 3.375rem;
  }
  /* A full-screen board's lead controls (ADR-515). */
  .knob.size-xl {
    --knob-want: 128px;
    --knob-title-fs: 18px;
    --knob-value-fs: 15px;
    --knob-caption-h: 3.625rem;
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
  /* A short, wide cell puts the caption beside the knob. */
  @container (min-aspect-ratio: 6/5) {
    .knob-body {
      grid-template-rows: auto;
      grid-template-columns: auto minmax(0, max-content);
      justify-content: center;
      align-items: center;
      gap: 0.625rem;
    }
  }
  /* Its size's diameter, less only what a small cell cannot hold: the
     cell's width, and its height less the caption under it. Never wider
     than the cell, even at the 28px floor. */
  .knob-face {
    position: relative;
    container-type: size;
    --knob-d: min(100cqw - 0.5rem, max(28px, min(var(--knob-want), 100cqw - 0.5rem, 100cqh - var(--knob-caption-h))));
    width: var(--knob-d);
    height: var(--knob-d);
  }
  /* Beside: the cell's height, and half its width for the caption. */
  @container (min-aspect-ratio: 6/5) {
    .knob-face {
      --knob-d: min(50cqw, max(28px, min(var(--knob-want), 50cqw, 100cqh - 0.75rem)));
    }
  }
  /* No caption: the knob alone, centred (no room kept for a caption beside
     it), and the cell's height is all the knob's. */
  .knob.no-caption .knob-body {
    grid-template-columns: auto;
    grid-template-rows: auto;
    justify-content: center;
    gap: 0;
  }
  .knob.no-caption .knob-face {
    --knob-d: min(100cqw - 0.5rem, max(28px, min(var(--knob-want), 100cqw - 0.5rem, 100cqh - 0.75rem)));
  }
  .knob-mark {
    font-size: clamp(12px, 34cqw, 30px);
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
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
  @container (width < 56px) {
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
    /* Fixed by the size; a name too long for the cell ends in an ellipsis. */
    font-size: var(--knob-title-fs);
    font-weight: 500;
    color: var(--knob-ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .knob-value-text {
    font-size: var(--knob-value-fs);
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
