<script lang="ts" module>
  /** A macro the rack's face can draw: its parameter index, Live's name for it, its value 0..127. */
  export type RackMacro = { index: number; name: string; value: number };

  /** The smallest box a macro's knob and its name hold in (a 36px knob, its caption). */
  export const RACK_MACRO_MIN = { w: 48, h: 76 } as const;
  /** The gap between macros, px (the face's `gap`). */
  export const RACK_MACRO_GAP = 6;

  /**
   * How many of `count` macros a `width` x `height` face holds, and in how
   * many rows: as many columns and rows of `RACK_MACRO_MIN` boxes as fit, the
   * rows as few as hold what is shown. 0 before the face is measured.
   */
  export function rackMacroFit(count: number, width: number, height: number, gap = RACK_MACRO_GAP): { shown: number; rows: number; cols: number } {
    if (count <= 0 || !(width > 0) || !(height > 0)) return { shown: 0, rows: 1, cols: 1 };
    const maxCols = Math.max(1, Math.floor((width + gap) / (RACK_MACRO_MIN.w + gap)));
    const maxRows = Math.max(1, Math.floor((height + gap) / (RACK_MACRO_MIN.h + gap)));
    const shown = Math.min(count, maxCols * maxRows);
    const rows = Math.min(maxRows, Math.ceil(shown / maxCols));
    return { shown, rows, cols: Math.ceil(shown / rows) };
  }
</script>

<script lang="ts">
  /**
   * A rack's face in the chain overview: its visible macros as knobs, each
   * named, played here as in Live (2026-11-12). Live's macro count button
   * says how many are visible; the cell's size says how many of those fit,
   * the first ones in Live's order, and a "+N" says how many more the rack
   * shows. Macros still named "Macro N" are left out, as every rack view
   * does. Outside a chain cell (no size) it draws them all.
   */
  import DeviceSlider from '../DeviceSlider.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';
  import { useCellSize } from './cellSize';

  interface Props {
    macros: RackMacro[];
    color: DeviceColorScheme;
    onChange: (index: number, value: number) => void;
  }

  let { macros, color, onChange }: Props = $props();

  const cellSize = useCellSize();
  // The face's own box, less the cell's padding; measured by the cell.
  const fit = $derived.by(() => {
    const size = cellSize();
    if (!size) return { shown: macros.length, rows: 1, cols: macros.length };
    return rackMacroFit(macros.length, size.width - 12, size.height - 12);
  });
  const shown = $derived(macros.slice(0, fit.shown));
  const more = $derived(macros.length - shown.length);
</script>

<div
  class="rack-face"
  data-macros-shown={shown.length}
  data-macros-more={more}
  style="grid-template-columns: repeat({fit.cols}, minmax(0, 1fr)); grid-template-rows: repeat({fit.rows}, minmax(0, 1fr)); gap: {RACK_MACRO_GAP}px;"
>
  {#each shown as m (m.index)}
    <div class="macro" data-macro-index={m.index}>
      <DeviceSlider
        face="knob"
        knobSize="s"
        knobCaptionBelow
        value={m.value}
        min={0}
        max={127}
        travel={160}
        title={m.name}
        {color}
        onInteraction={(v) => onChange(m.index, v)}
      />
    </div>
  {/each}
  {#if more > 0}<span class="more" aria-label="{more} more macros">+{more}</span>{/if}
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
  .more {
    position: absolute;
    right: 0;
    bottom: 0;
    font-size: 0.6875rem;
    line-height: 1;
    padding: 2px 3px;
    color: var(--cell-ink);
    opacity: 0.8;
    pointer-events: none;
  }
</style>
