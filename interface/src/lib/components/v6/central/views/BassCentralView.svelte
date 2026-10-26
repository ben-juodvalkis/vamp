<script lang="ts">
  /**
   * The Bass Amp's view (`Bass Amp.adg`, the `bass` slot). The rack has one
   * visible macro, the mix, so the view is the Bass tile itself at full
   * size (`BassControl`, which keeps its load-to-the-head latch). The tile
   * opened the Guitar rack's view until the FX chain overview gave every
   * device a view of its own (2026-10-26).
   */

  import BassControl from '$lib/components/v6/device-panel/BassControl.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

  const bass = useFxGridSlot('bass');
</script>

<div class="bass-layout" data-view="bass">
  <div class="slider-col" class:slot-ghost={bass.isGhost}>
    <BassControl device={bass.device} />
  </div>
</div>

<style>
  .bass-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  .slider-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
</style>
