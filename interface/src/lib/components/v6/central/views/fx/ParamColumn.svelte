<script lang="ts">
  /**
   * A column of value boxes (ADR-477), or knobs (ADR-509), on one effect's parameters, top to
   * bottom, for the effect views built on Live's own panels (2026-11-06:
   * Auto Pan-Tremolo, EQ Eight, Delay, Limiter, Phaser, Chorus). Each box
   * is a parameter by LOM index in its own range, its readout Live's label;
   * a ghost draws `rest`, and its first write loads the device.
   *
   * On a face grid (ADR-510) a view names its knobs' `knobSize`, the size
   * its column count was picked to hold, and the knobs stack at that size
   * with the face's gutter between them; `span` lays them on that many of
   * the face's columns, row by row (the column must then be a direct child
   * of the `FaceSection`). Without a `knobSize` the knobs take the grid
   * that gives each the most room (`KnobGrid`). `across` lays them on that
   * many columns of their own, row by row, inside a wrapper that spans as
   * many face columns (its gutter is the face's, so they land on the
   * face's columns), for a column that shares its section with a switch
   * row under it; `after` is drawn in the cell after the last knob (a
   * switch that belongs to the group).
   */
  import type { Snippet } from 'svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import KnobGrid from '$lib/components/v6/device-panel/KnobGrid.svelte';
  import type { KnobSize } from '$lib/components/v6/device-panel/knobLayout';
  import type { FxGridSlotHandle } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';

  export interface ParamBox {
    index: number;
    title: string;
    /** Live's value on a fresh insert, what a ghost shows. */
    rest: number;
    min?: number;
    max?: number;
    /** The neutral value the fill grows from (a ±% or ±dB parameter's 0). */
    center?: number;
    /** A captionless knob's letter (`caption` false): what it is at a glance. */
    mark?: string;
  }

  interface Props {
    fx: FxGridSlotHandle;
    ink: DeviceColorScheme;
    boxes: readonly ParamBox[];
    /**
     * Knobs (ADR-509) for a column of tone and motion, in the grid that
     * gives each the most room; boxes, the default, for a column of levels.
     */
    face?: 'slider' | 'knob';
    /** The most knobs this column ever shows, where a mode drops some: sizes them (ADR-509). */
    fullest?: number;
    /** The knobs' size on a face grid (ADR-510): stacked at it, not fitted by `KnobGrid`. */
    knobSize?: KnobSize;
    /** The face columns the knobs lay across, row by row (with `knobSize`). */
    span?: number;
    /** False: no name under or beside a knob; its `mark` says which. */
    caption?: boolean;
    /** The knobs' own columns, row by row (with `knobSize`), inside a wrapper `across` face columns wide. */
    across?: number;
    /** Drawn in the cell after the last knob, on the same grid (with `knobSize`). */
    after?: Snippet;
  }

  let { fx, ink, boxes, face = 'slider', fullest, knobSize, span = 1, caption = true, across = 1, after }: Props = $props();

  /** The columns the knobs lay across: the face's own (`span`) or their own (`across`). */
  let cols = $derived(Math.max(span, across));
  /** The rows a fixed-size column keeps: its fullest state, so a mode never resizes one. */
  let rows = $derived(Math.max(1, Math.ceil((Math.max(boxes.length, fullest ?? 0) + (after ? 1 : 0)) / cols)));
</script>

{#snippet control(box: ParamBox, size: KnobSize = 'm')}
  <DeviceSlider
    value={fx.paramValue(box.index) ?? box.rest}
    title={box.title}
    {face}
    knobSize={size}
    knobCaption={caption}
    knobMark={box.mark}
    orientation="vertical"
    min={box.min ?? 0}
    max={box.max ?? 1}
    centerOrigin={face === 'knob' && box.center !== undefined}
    centerValue={box.center}
    isGhost={fx.isGhost}
    color={ink}
    readout={fx.paramDisplay(box.index)}
    onInteraction={(v) => fx.sendParam(box.index, v)}
  />
{/snippet}

{#if face === 'knob' && knobSize}
  <div
    class="param-column param-face"
    class:slot-ghost={fx.isGhost}
    class:on-columns={span > 1}
    data-knob-size={knobSize}
    style="--param-rows: {rows}; --param-cols: {across};{span > 1 ? ` grid-column: span ${span};` : ''}"
  >
    {#each boxes as box (box.index)}
      <div class="param-cell">{@render control(box, knobSize)}</div>
    {/each}
    {#if after}<div class="param-cell param-after">{@render after()}</div>{/if}
  </div>
{:else if face === 'knob'}
  <div class="param-column param-knobs" class:slot-ghost={fx.isGhost}>
    <KnobGrid count={boxes.length} {fullest}>
      {#snippet item(i, size)}{@render control(boxes[i], size)}{/snippet}
    </KnobGrid>
  </div>
{:else}
  <div class="param-column" class:slot-ghost={fx.isGhost}>
    {#each boxes as box (box.index)}
      {@render control(box)}
    {/each}
  </div>
{/if}

<style>
  .param-column {
    display: flex;
    flex-direction: column;
    /* On a face, the face's gutter (ADR-510); elsewhere a central gap. */
    gap: var(--face-gutter, var(--central-gap));
    min-width: 0;
    min-height: 0;
  }

  .param-column > :global(*) {
    flex: 1 1 0;
    min-height: 0;
  }

  /* Fixed-size knobs: equal rows for the column's fullest state, one
     column, or the face's own columns (subgrid) when it spans more. */
  .param-face {
    display: grid;
    grid-template-columns: repeat(var(--param-cols, 1), minmax(0, 1fr));
    grid-template-rows: repeat(var(--param-rows), minmax(0, 1fr));
    gap: var(--face-gutter, var(--spacing-sm));
  }
  .param-face.on-columns {
    grid-template-columns: subgrid;
  }
  .param-cell {
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .param-cell > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
  /* A switch after the knobs: one touch row, centred in its cell (ADR-509). */
  .param-after {
    flex-direction: column;
    justify-content: center;
  }
  .param-after > :global(*) {
    flex: 0 0 var(--height-touch);
  }
</style>
