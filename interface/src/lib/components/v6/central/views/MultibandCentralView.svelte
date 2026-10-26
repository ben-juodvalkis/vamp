<script lang="ts">
  /**
   * MultibandCentralView — the Multiband Dynamics' view (slot `ott`).
   *
   * The Mid band's Below Ratio over its Below Threshold over the device's
   * Output, three value boxes (ADR-477). A ghost loads it on the first
   * drag, inserted by name with the user's own default. Indices and rails
   * live in `multibandParams.ts`.
   *
   * Split out of the shared dynamics view (`SquashCentralView`) when the
   * FX chain overview gave every device its own view (ADR-478).
   *
   * Self-contained: queries its own slot state, takes no props, and
   * renders through ghost/loading/active without a `{#if device}` gate.
   */

  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import {
    MB_BELOW_THRESHOLD_MID,
    MB_THRESHOLD_MIN,
    MB_THRESHOLD_MAX,
    MB_BELOW_RATIO_MID,
    MB_OUTPUT,
    MB_OUTPUT_MIN,
    MB_OUTPUT_MAX,
    ratioFromSlider,
    sliderFromRatio
  } from '../../device-panel/multibandParams';

  const multiband = useFxGridSlot('ott');

  // A ghost draws Live's factory defaults (the dump's `default`s).
  let mbThreshold = $derived(multiband.paramValue(MB_BELOW_THRESHOLD_MID) ?? -60);
  let mbRatioPos = $derived(sliderFromRatio(multiband.paramValue(MB_BELOW_RATIO_MID) ?? 0));
  let mbOutput = $derived(multiband.paramValue(MB_OUTPUT) ?? 0);
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="mb-central-layout relative" data-device="multiband">
  <!-- 0 sits at the middle: the bottom half is -3..0, the top 0..1. -->
  <div class="mb-slider" class:slot-ghost={multiband.isGhost}>
    <DeviceSlider
      value={mbRatioPos}
      title="Ratio"
      orientation="vertical"
      min={0}
      max={1}
      centerOrigin={true}
      centerValue={0.5}
      isGhost={multiband.isGhost}
      color={multiband.color}
      readout={multiband.paramDisplay(MB_BELOW_RATIO_MID)}
      onTap={() => multiband.loadIfGhost()}
      onInteraction={(value) => multiband.sendParam(MB_BELOW_RATIO_MID, ratioFromSlider(value))}
    />
  </div>
  <div class="mb-slider" class:slot-ghost={multiband.isGhost}>
    <DeviceSlider
      value={mbThreshold}
      title="Threshold"
      icon="threshold"
      orientation="vertical"
      min={MB_THRESHOLD_MIN}
      max={MB_THRESHOLD_MAX}
      isGhost={multiband.isGhost}
      color={multiband.color}
      readout={multiband.paramDisplay(MB_BELOW_THRESHOLD_MID)}
      onTap={() => multiband.loadIfGhost()}
      onInteraction={(value) => multiband.sendParam(MB_BELOW_THRESHOLD_MID, value)}
    />
  </div>
  <div class="mb-slider" class:slot-ghost={multiband.isGhost}>
    <DeviceSlider
      value={mbOutput}
      title="Output"
      icon="output"
      orientation="vertical"
      min={MB_OUTPUT_MIN}
      max={MB_OUTPUT_MAX}
      centerOrigin={true}
      centerValue={0}
      isGhost={multiband.isGhost}
      color={multiband.color}
      readout={multiband.paramDisplay(MB_OUTPUT)}
      onTap={() => multiband.loadIfGhost()}
      onInteraction={(value) => multiband.sendParam(MB_OUTPUT, value)}
    />
  </div>
</div>

<style>
  /* ratio over threshold over output */
  .mb-central-layout {
    display: grid;
    grid-template-rows: repeat(3, minmax(0, 1fr));
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  .mb-slider {
    min-width: 0;
    min-height: 0;
  }
</style>
