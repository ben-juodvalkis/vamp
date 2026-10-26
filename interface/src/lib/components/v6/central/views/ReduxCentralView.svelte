<script lang="ts">
  /**
   * Redux's view (Live's Redux, the `redux` slot). Its pad, full size: the
   * one the Saturator tile's view carried at full height until the FX chain
   * overview gave every device a view of its own (2026-10-26). Before that
   * this file was a placeholder nothing opened.
   *
   * NO {#if device} gate - ReduxControl handles its own ghost state.
   */

  import ReduxControl from '$lib/components/v6/device-panel/ReduxControl.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

  const redux = useFxGridSlot('redux');
</script>

<div class="redux-layout" data-view="redux">
  <div class="pad" class:slot-ghost={redux.isGhost}>
    <ReduxControl device={redux.device} icon="redux" />
  </div>
</div>

<style>
  .redux-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  .pad {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
</style>
