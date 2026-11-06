<script lang="ts">
  /**
   * A grid of knobs (ADR-508) for a hand-laid view: it measures its own box
   * and takes the rows that give each knob the most room (`knobGridRows`),
   * the rule an instrument panel's groups follow. Filled row by row, left to
   * right. `item` draws the knob at an index, usually a `DeviceSlider
   * face="knob"`; the grid draws nothing of its own.
   */
  import type { Snippet } from 'svelte';
  import { knobGridRows } from './knobLayout';

  interface Props {
    count: number;
    item: Snippet<[number]>;
    /** At most this many rows, where a view wants a single row or two. */
    maxRows?: number;
    class?: string;
  }

  let { count, item, maxRows, class: className = '' }: Props = $props();

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
  let rows = $derived(
    count > 0 && size.w > 0 ? Math.min(maxRows ?? count, knobGridRows(count, size.w, size.h, gap)) : 1
  );
  let cols = $derived(Math.max(1, Math.ceil(count / rows)));
</script>

<div
  class="knob-grid {className}"
  bind:this={box}
  data-knob-rows={rows}
  style="grid-template-columns: repeat({cols}, minmax(0, 1fr)); grid-template-rows: repeat({rows}, minmax(0, 1fr));"
>
  {#each { length: count } as _, i (i)}
    <div class="knob-cell">{@render item(i)}</div>
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
