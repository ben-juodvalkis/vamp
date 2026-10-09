<script lang="ts">
  /**
   * UtilityCentralView - Slot-Aware Version
   *
   * Self-contained central view that queries its own slot state.
   * Renders immediately with ghost/loading/active states.
   *
   * NO {#if device} gate - always renders, controls handle their own state.
   * NO props required - queries its slot internally.
   *
   * The Gate, then three sliders on a Multiband Dynamics (2026-10-09, the
   * user's call): the Mid band's Below Threshold and Below Ratio, and the
   * device's Output. They replaced master's OTT tile (Amount alone, master
   * only) and reach the device on every track. A ghost loads it on the
   * first drag, inserted by name with the user's own default.
   *
   * Every Compressor control this view used to carry moved to
   * `SquashCentralView` on 2026-09-11; the Glue Compressor left earlier,
   * for a full-height FX-grid column beside Gain (ADR-431 addendum).
   */

  import GateControl from '../../device-panel/GateControl.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import SectionDivider from '../SectionDivider.svelte';
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

  const gate = useFxGridSlot('gate');
  const multiband = useFxGridSlot('ott');

  // A ghost draws Live's factory defaults (the dump's `default`s).
  let threshold = $derived(multiband.paramValue(MB_BELOW_THRESHOLD_MID) ?? -60);
  let ratioPos = $derived(sliderFromRatio(multiband.paramValue(MB_BELOW_RATIO_MID) ?? 0));
  let output = $derived(multiband.paramValue(MB_OUTPUT) ?? 0);
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="utility-central-layout relative">
  <div class="device-wrapper gate-section" class:slot-ghost={gate.isGhost}>
    <GateControl device={gate.device} icon="gate" />
  </div>

  <SectionDivider orientation="vertical" />

  <div class="mb-sliders" data-device="multiband">
    <div class="mb-slider" class:slot-ghost={multiband.isGhost}>
      <DeviceSlider
        value={threshold}
        title="Threshold"
        icon="threshold"
        orientation="vertical"
        labelOrientation="horizontal"
        min={MB_THRESHOLD_MIN}
        max={MB_THRESHOLD_MAX}
        isGhost={multiband.isGhost}
        color={multiband.color}
        onTap={() => multiband.loadIfGhost()}
        onInteraction={(value) => multiband.sendParam(MB_BELOW_THRESHOLD_MID, value)}
      />
    </div>
    <!-- 0 sits at the middle: the bottom half is -3..0, the top 0..1. -->
    <div class="mb-slider" class:slot-ghost={multiband.isGhost}>
      <DeviceSlider
        value={ratioPos}
        title="Ratio"
        orientation="vertical"
        labelOrientation="horizontal"
        min={0}
        max={1}
        centerOrigin={true}
        centerValue={0.5}
        isGhost={multiband.isGhost}
        color={multiband.color}
        onTap={() => multiband.loadIfGhost()}
        onInteraction={(value) => multiband.sendParam(MB_BELOW_RATIO_MID, ratioFromSlider(value))}
      />
    </div>
    <div class="mb-slider" class:slot-ghost={multiband.isGhost}>
      <DeviceSlider
        value={output}
        title="Output"
        icon="output"
        orientation="vertical"
        labelOrientation="horizontal"
        min={MB_OUTPUT_MIN}
        max={MB_OUTPUT_MAX}
        centerOrigin={true}
        centerValue={0}
        isGhost={multiband.isGhost}
        color={multiband.color}
        onTap={() => multiband.loadIfGhost()}
        onInteraction={(value) => multiband.sendParam(MB_OUTPUT, value)}
      />
    </div>
  </div>
</div>

<style>
  .utility-central-layout {
    display: grid;
    /* The Gate keeps its 480px cap; the Multiband sliders take the rest,
       each about a Squash-view slider wide. */
    grid-template-columns: minmax(0, 480px) auto minmax(0, 1fr);
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  .device-wrapper {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0; /* Allow shrinking below content size */
  }

  .gate-section {
    min-height: 0;
    width: 100%;
  }

  .mb-sliders {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--central-gap);
    min-width: 0;
    min-height: 0;
    max-width: 480px;
  }

  .mb-slider {
    min-width: 0;
    min-height: 0;
  }
</style>
