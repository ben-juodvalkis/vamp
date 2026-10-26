<script lang="ts">
  /**
   * The Shifter's view (Live's Shifter, the `shifter` slot). Its own file
   * since the FX chain overview took over from the grid (2026-10-26); it
   * was the first column of the Saturator tile's view.
   *
   * One fader, the `shifter` control (`deviceControls`, ADR-479): RM Coarse
   * to 1 kHz, heard only in Ring mode, so a gesture that loads the Shifter
   * also sets Ring. A tap on a ghost loads it at 1 Hz (user, 2026-10-05).
   */
  import ControlTile from '$lib/components/v6/device-panel/ControlTile.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

  const shifter = useFxGridSlot('shifter');
</script>

<div class="shifter-layout" data-view="shifter">
  <div class="slider-col">
    <ControlTile type="shifter" device={shifter.device} icon="ringmod" disableCentralViewOnTap tapLoads labelSize="large" />
  </div>
</div>

<style>
  .shifter-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  .slider-col {
    min-width: 0;
    min-height: 0;
  }
</style>
