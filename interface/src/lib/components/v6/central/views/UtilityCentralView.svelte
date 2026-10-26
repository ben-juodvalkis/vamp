<script lang="ts">
  /**
   * UtilityCentralView — the Utility's view (slot `utility`, StereoGain).
   *
   * The Gain tile's one control, large: the same parameter and rail
   * `UtilityControl` drives (index 9, -1..1), as a value box (ADR-477).
   * Until the FX chain overview gave every device its own view (ADR-478)
   * the Gain tile opened the shared dynamics view, which drew no Utility
   * control at all.
   *
   * Only index 9 is drawn: it is the one Utility index the code
   * establishes. The Utility's saved parameters do not follow LOM order
   * (live-api-measurements.md), so Width, Pan and the rest wait for a
   * measurement rather than a guess.
   *
   * Self-contained: queries its own slot state, takes no props, and
   * renders through ghost/loading/active without a `{#if device}` gate.
   */

  import ControlTile from '../../device-panel/ControlTile.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

  const utility = useFxGridSlot('utility');
</script>

<!-- The `utility` control (deviceControls, ADR-479) at full size; a tap on
     a ghost loads it. -->
<div class="utility-central-layout relative">
  <div class="utility-slider">
    <ControlTile type="utility" device={utility.device} disableCentralViewOnTap tapLoads labelSize="large" />
  </div>
</div>

<style>
  .utility-central-layout {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  .utility-slider {
    min-width: 0;
    min-height: 0;
  }
</style>
