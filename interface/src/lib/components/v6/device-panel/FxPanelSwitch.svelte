<script lang="ts">
  /**
   * The FX section's tiny switch: the grid, or the track's chain in order.
   * One button over the section's top-left corner (the Rand Oct tile's, which
   * carries no arrow there), out of flow so it takes no cell from either
   * face. It shows the face a tap goes to. It used to be two segments in the
   * top-right corner, over the Glue tile, where it took taps meant for it.
   */
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import GalleryHorizontalEnd from '@lucide/svelte/icons/gallery-horizontal-end';
  import { press } from '$lib/actions/press';
  import { fxChainStore } from '$lib/stores/v6/fxChainStore.svelte';

  const next = $derived(fxChainStore.mode === 'grid' ? 'chain' : 'grid');
</script>

<button
  type="button"
  class="fx-panel-switch"
  aria-label={next === 'chain' ? 'Show the device chain' : 'Show the FX grid'}
  data-fx-mode={next}
  use:press={{ onPress: () => fxChainStore.setMode(next), fireOn: 'down', touchAction: 'none' }}
>
  {#if next === 'chain'}
    <GalleryHorizontalEnd />
  {:else}
    <LayoutGrid />
  {/if}
</button>

<style>
  .fx-panel-switch {
    position: absolute;
    top: 4px;
    left: 4px;
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 28px;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--card);
    color: var(--muted-foreground);
  }
  .fx-panel-switch:active {
    background: var(--phosphor);
    color: var(--flat-on-fg, var(--background));
  }
  .fx-panel-switch :global(svg) {
    width: 16px;
    height: 16px;
  }
</style>
