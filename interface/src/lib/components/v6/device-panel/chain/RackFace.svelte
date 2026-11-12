<script lang="ts" module>
  import type { PanelMacro } from '$lib/utils/macroLayoutUtils';

  /** A rack's macros as Live lays them out (`liveMacroSlots`). */
  export type RackMacroGrid = {
    rows: number;
    cols: number;
    /** Row-major, every visible macro in Live's place; `dim` ones Live still names "Macro N". */
    slots: (PanelMacro | null)[];
  };

  /**
   * The smallest box a macro's knob and its name hold in: a 36px knob and
   * one line of name (a macro has no value text under it, so its caption
   * keeps one line's room, `--knob-caption-h` below).
   */
  export const RACK_MACRO_MIN = { w: 48, h: 68 } as const;
  /**
   * The compact box, for a short cell (a two-row chain's) that cannot hold
   * Live's two rows at `RACK_MACRO_MIN`: a ~28px knob over a smaller name,
   * so both rows still show (Ben, 2026-11-12).
   */
  export const RACK_MACRO_MIN_COMPACT = { w: 48, h: 42 } as const;
  /** The gap between macros, px (the face's `gap`). */
  export const RACK_MACRO_GAP = 6;

  /**
   * How much of Live's macro panel a `width` x `height` face shows: its
   * first columns, as many as fit, of as many of its rows as fit (ADR-532),
   * so every macro shown stands where Live has it. `more` counts the named
   * macros left out. Unmeasured, it shows the whole panel.
   */
  export function rackMacroWindow(
    grid: RackMacroGrid,
    width: number,
    height: number,
    gap = RACK_MACRO_GAP
  ): { rows: number; cols: number; more: number; compact: boolean } {
    let rows = grid.rows;
    let cols = grid.cols;
    let compact = false;
    if (width > 0 && height > 0) {
      const fit = (h: number) => Math.max(1, Math.floor((height + gap) / (h + gap)));
      cols = Math.min(cols, Math.max(1, Math.floor((width + gap) / (RACK_MACRO_MIN.w + gap))));
      rows = Math.min(rows, fit(RACK_MACRO_MIN.h));
      // Short of Live's rows at full size: the compact knobs, if they hold them.
      if (rows < grid.rows && fit(RACK_MACRO_MIN_COMPACT.h) > rows) {
        rows = Math.min(grid.rows, fit(RACK_MACRO_MIN_COMPACT.h));
        compact = true;
      }
    }
    let more = 0;
    grid.slots.forEach((slot, k) => {
      if (slot && !slot.dim && (Math.floor(k / grid.cols) >= rows || k % grid.cols >= cols)) more++;
    });
    return { rows, cols, more, compact };
  }
</script>

<script lang="ts">
  /**
   * A rack's face in the chain overview: its macros as knobs, each named,
   * laid out as Live's macro panel (two rows, numbered row by row; ADR-530,
   * ADR-532), played here as in Live. The cell shows as much of the panel
   * as it holds, from its left, and a "+N" counts the named macros it left
   * out. A macro Live still names "Macro N" is drawn dim in its place, as
   * Live greys an unmapped one.
   */
  import DeviceSlider from '../DeviceSlider.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';
  import { useCellSize } from './cellSize';

  interface Props {
    grid: RackMacroGrid;
    /** A macro's value, 0..127, by its parameter index. */
    valueOf: (index: number) => number;
    color: DeviceColorScheme;
    onChange: (index: number, value: number) => void;
  }

  let { grid, valueOf, color, onChange }: Props = $props();

  const cellSize = useCellSize();
  // The face's own box, inside the cell's padding, as `CellSize` measures it.
  const win = $derived.by(() => {
    const size = cellSize();
    return rackMacroWindow(grid, size?.width ?? 0, size?.height ?? 0);
  });
  const shown = $derived(
    Array.from({ length: win.rows * win.cols }, (_, k) => grid.slots[Math.floor(k / win.cols) * grid.cols + (k % win.cols)] ?? null)
  );
</script>

<div
  class="rack-face"
  class:compact={win.compact}
  data-macros-shown={shown.filter((m) => m && !m.dim).length}
  data-macros-more={win.more}
  style="grid-template-columns: repeat({win.cols}, minmax(0, 1fr)); grid-template-rows: repeat({win.rows}, minmax(0, 1fr)); gap: {RACK_MACRO_GAP}px;"
>
  {#each shown as m, k (k)}
    <div class="macro" class:dim={m?.dim} data-macro-index={m?.macroIndex}>
      {#if m}
        <DeviceSlider
          face="knob"
          knobSize="s"
          knobCaptionBelow
          value={valueOf(m.macroIndex)}
          min={0}
          max={127}
          travel={160}
          title={m.name}
          {color}
          onInteraction={(v) => onChange(m.macroIndex, v)}
        />
      {/if}
    </div>
  {/each}
  {#if win.more > 0}<span class="more" aria-label="{win.more} more macros in the rack's view">+{win.more}</span>{/if}
</div>

<style>
  .rack-face {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 0;
  }
  .macro {
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .macro > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
  /* One line of name under the knob, not the two a knob keeps for a value
     under its name: a full-height cell then holds two rows (Ben, 2026-11-12). */
  .macro :global(.knob.size-s) {
    --knob-caption-h: 2rem;
  }
  /* A macro Live still names "Macro N": there, playable, greyed as Live greys it. */
  .macro.dim {
    opacity: 0.35;
  }
  /* Compact: a small knob over a one-line name in smaller type, the body's
     padding and gap pared, so a short cell holds both of Live's rows. */
  .compact .macro :global(.knob.size-s) {
    --knob-caption-h: 1.125rem;
    --knob-title-fs: 10px;
  }
  .compact .macro :global(.knob-body) {
    padding: 1px 0;
    gap: 2px;
  }
  .more {
    position: absolute;
    right: 0;
    top: 0;
    font-size: 0.6875rem;
    line-height: 1;
    padding: 2px 3px;
    color: var(--cell-ink);
    opacity: 0.8;
    pointer-events: none;
  }
</style>
