<script lang="ts">
  /**
   * A grid of knobs (ADR-509) for a hand-laid view: it measures its own box
   * and takes the rows whose cells hold its knobs at full size (`knobGridFit`),
   * the rule an instrument panel's groups follow. Filled row by row, left to
   * right. `item` draws the knob at an index, usually a `DeviceSlider
   * face="knob"`, and is handed the knob's size: by how many knobs a column
   * stacks (`knobSizeFor`), counted at `fullest` where a mode shows fewer
   * than the most, so a mode switch never resizes a knob. The grid draws
   * nothing of its own. Where no row count holds that size, it steps down
   * rather than clamp.
   */
  import type { Snippet } from 'svelte';
  import { knobGridFit, type KnobSize } from './knobLayout';

  interface Props {
    count: number;
    item: Snippet<[number, KnobSize]>;
    /** At most this many rows, where a view wants a single row or two. */
    maxRows?: number;
    /** The most knobs this grid ever shows, where a mode shows fewer: sizes them. */
    fullest?: number;
    /** The largest size its knobs may draw, where the view names one; unset, by the rows. */
    ceiling?: KnobSize;
    class?: string;
  }

  let { count, item, maxRows, fullest, ceiling, class: className = '' }: Props = $props();

  let box = $state<HTMLDivElement>();
  let size = $state({ w: 0, h: 0 });
  $effect(() => {
    if (!box || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      size = { w: entry.contentRect.width, h: entry.contentRect.height };
    });
    observer.observe(box);
    return () => observer.disconnect();
  });
  let gap = $derived(box ? parseFloat(getComputedStyle(box).columnGap) || 16 : 16);
  // Sized for the fullest grid this box would lay out, then laid out so every
  // knob holds that size (`knobGridFit`).
  let knobSize = $derived<KnobSize>(
    size.w > 0
      ? knobGridFit(Math.max(count, fullest ?? 0), size.w, size.h, gap, ceiling, true, maxRows ?? Infinity).size
      : (ceiling ?? 'm')
  );
  let rows = $derived(
    count > 0 && size.w > 0 ? knobGridFit(count, size.w, size.h, gap, knobSize, true, maxRows ?? Infinity).rows : 1
  );
  let cols = $derived(Math.max(1, Math.ceil(count / rows)));
</script>

<div
  class="knob-grid {className}"
  bind:this={box}
  data-knob-rows={rows}
  data-knob-size={knobSize}
  style="grid-template-columns: repeat({cols}, minmax(0, 1fr)); grid-template-rows: repeat({rows}, minmax(0, 1fr));"
>
  {#each { length: count } as _, i (i)}
    <div class="knob-cell">{@render item(i, knobSize)}</div>
  {/each}
</div>

<style>
  .knob-grid {
    flex: 1 1 0;
    display: grid;
    gap: var(--central-gap);
    min-width: 0;
    min-height: 0;
  }
  .knob-cell {
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .knob-cell > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
</style>
