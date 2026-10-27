<script lang="ts">
  /**
   * EQCentralView - Slot-Aware Version
   *
   * Self-contained central view that queries its own slot state.
   * Renders immediately with ghost/loading/active states.
   * Displays Channel EQ's Low Cut beside its output gain, two tall boxes. Ben's
   * Adaptive Tone Shaper's graph sat beside them from 2026-10-07 until the
   * FX chain overview gave every device a view of its own (2026-10-26); it
   * is `ToneShaperCentralView` now.
   *
   * NO {#if device} gate - always renders, handles its own state.
   * NO props required - queries selectedTrackStore directly.
   */

  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { deviceInk } from '$lib/utils/formatters/trackFormatters';
  import { familyScheme } from '$lib/config/devicePresets';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';

  const fx = useFxGridSlot('eq');

  // GRATICULE (§5.5): calibrated slot ink for live controls (deviceInk —
  // neutral-safe, byte no-op on the chokepoint's already-inked scheme).
  let fxInk = $derived({
    primary: deviceInk(fx.color.primary, paintModeReactive()),
    secondary: fx.color.secondary,
    accent: deviceInk(fx.color.accent, paintModeReactive())
  });
  // Ghost slider ink — the neutral utility family (ADR-400). Previously fed
  // grey through trackInk, whose chroma floor boosted it onto the act-pitch
  // hue — the exact miscalibration deviceInk exists to prevent.
  let ghostInk = $derived({
    primary: deviceInk(familyScheme('utility').primary, paintModeReactive()),
    secondary: 'color-mix(in oklab, var(--signal-dim) 10%, transparent)',
    accent: deviceInk(familyScheme('utility').accent, paintModeReactive())
  });

  const PARAM_CONFIG = {
    lowCut: 1,
    lowGain: 2,
    midGain: 3,
    midFreq: 4,
    highGain: 5,
    outputGain: 6
  };

  // Initial UI state before the first param echo lands. These were looked up
  // in data/device-configs.json with these same numbers as the `?? fallback`,
  // and that file's ChannelEq block carried exactly these values — so the
  // lookup and the fallback could never disagree.
  const defaults = {
    lowCut: 0,
    lowGain: 0.5,
    midGain: 0.5,
    midFreq: 0.5,
    highGain: 0.5,
    outputGain: 0.5
  };

  let lowCutValue = $derived(fx.paramValue(PARAM_CONFIG.lowCut) ?? defaults.lowCut);
  let outputGainValue = $derived(fx.paramValue(PARAM_CONFIG.outputGain) ?? defaults.outputGain);

  let lowCutEnabled = $derived(lowCutValue >= 0.5);

  function toggleLowCut() {
    fx.sendParam(PARAM_CONFIG.lowCut, lowCutEnabled ? 0 : 1);
  }
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<!-- Channel EQ: Low Cut beside Output, two tall boxes side by side (the Glue
     view's shape). They were two full-width rows (ADR-477's first cut), a
     1000 x 120 switch over a 1000 x 120 slider that swept sideways. -->
<div class="eq-layout" class:slot-ghost={fx.isGhost}>
  <!-- A switch: one cell, lit while the low cut is on. -->
  <button
    onclick={toggleLowCut}
    class="physical-button eq-switch text-lg font-bold"
    class:active={lowCutEnabled}
    aria-pressed={lowCutEnabled}
    style="--btn-tint: {fxInk.primary};"
  >
    Low Cut
  </button>
  <div class="eq-cell">
    <DeviceSlider
      value={outputGainValue}
      title="Output"
      icon="output"
      isGhost={fx.isGhost}
      color={fx.isGhost ? ghostInk : fxInk}
      readout={fx.paramDisplay(PARAM_CONFIG.outputGain)}
      onInteraction={(val) => {
        fx.sendParam(PARAM_CONFIG.outputGain, val);
      }}
    />
  </div>
</div>

<style>
  /* low cut | output */
  .eq-layout {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }
  .eq-switch {
    min-width: 0;
    min-height: 0;
  }
  .eq-cell {
    min-width: 0;
    min-height: 0;
    display: flex;
  }
  .eq-cell > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }

  /* ---- Live skin (flat grammar): the LOW CUT switch drops bold (app.css
     already gives .physical-button its flat field + ChosenDefault ON fill).
     Nothing else here paints chrome: the OUTPUT box is DeviceSlider
     (already flat) in a bare flex wrapper, so no frame / shadow is re-added
     around it. Graticule is untouched — every rule sits under
     [data-grammar="flat"]. */
  :global([data-grammar="flat"]) .physical-button {
    font-weight: var(--font-weight-medium);
  }
</style>
