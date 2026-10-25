<script lang="ts">
  /**
   * The FX section's tiny switch: the grid, or the track's chain in order.
   * Two segments in the section's top-right corner, out of flow so it takes
   * no cell from either face. The lit segment is the face on screen.
   */
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import GalleryHorizontalEnd from '@lucide/svelte/icons/gallery-horizontal-end';
  import { press } from '$lib/actions/press';
  import { fxChainStore, type FxPanelMode } from '$lib/stores/v6/fxChainStore.svelte';

  const SEGMENTS: { mode: FxPanelMode; label: string; Icon: typeof LayoutGrid }[] = [
    { mode: 'grid', label: 'FX grid', Icon: LayoutGrid },
    { mode: 'chain', label: 'Device chain', Icon: GalleryHorizontalEnd }
  ];
</script>

<div class="fx-panel-switch" role="group" aria-label="FX section">
  {#each SEGMENTS as seg (seg.mode)}
    <button
      type="button"
      class="seg"
      class:on={fxChainStore.mode === seg.mode}
      aria-label={seg.label}
      aria-pressed={fxChainStore.mode === seg.mode}
      data-fx-mode={seg.mode}
      use:press={{ onPress: () => fxChainStore.setMode(seg.mode), fireOn: 'down', touchAction: 'none' }}
    >
      <seg.Icon />
    </button>
  {/each}
</div>

<style>
  .fx-panel-switch {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 4;
    display: flex;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--card);
    overflow: hidden;
  }
  .seg {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 26px;
    color: var(--muted-foreground);
    background: transparent;
  }
  .seg + .seg {
    border-left: 1px solid var(--line-strong);
  }
  .seg.on {
    background: var(--phosphor);
    color: var(--flat-on-fg, var(--background));
  }
  .seg :global(svg) {
    width: 16px;
    height: 16px;
  }
</style>
