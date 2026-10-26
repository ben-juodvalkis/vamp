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

  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

  const utility = useFxGridSlot('utility');

  // Mirrors `UtilityControl`'s PARAM_CONFIG.
  const GAIN_PARAM = 9;
  const GAIN_MIN = -1;
  const GAIN_MAX = 1;

  let gainValue = $derived(utility.paramValue(GAIN_PARAM) ?? 0);
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states.
     `sendParam` is fire-and-forget on a ghost — it queues and triggers
     the load. -->
<div class="utility-central-layout relative">
  <div class="utility-slider" class:slot-ghost={utility.isGhost}>
    <DeviceSlider
      value={gainValue}
      title="Gain"
      orientation="vertical"
      min={GAIN_MIN}
      max={GAIN_MAX}
      isGhost={utility.isGhost}
      color={utility.color}
      readout={utility.paramDisplay(GAIN_PARAM)}
      onTap={() => utility.loadIfGhost()}
      onInteraction={(value) => utility.sendParam(GAIN_PARAM, value)}
    />
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
