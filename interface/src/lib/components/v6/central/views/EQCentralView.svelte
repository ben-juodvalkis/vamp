<script lang="ts">
  /**
   * EQCentralView - Slot-Aware Version
   *
   * Self-contained central view that queries its own slot state.
   * Renders immediately with ghost/loading/active states.
   * Displays Channel EQ output gain slider.
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
<div class="h-full w-full flex flex-col items-center justify-center p-(--central-inset) relative" class:slot-ghost={fx.isGhost}>
  <!-- Centered EQ label matching DeviceXY standard -->
  <div
    class="eq-title absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-2xl font-bold uppercase tracking-wider pointer-events-none select-none z-10 dark:text-white/90 light:text-foreground/80"
    style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}
  >EQ</div>

  <div class="w-full h-full flex justify-between" style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
    <!-- Left: Low Cut Toggle -->
    <div class="w-24 flex flex-col items-center gap-2">
      <div class="eq-label text-xs text-muted-foreground font-medium">Low Cut</div>
      <button
        onclick={toggleLowCut}
        class="physical-button flex-1 w-full text-lg font-bold"
        class:active={lowCutEnabled}
        style="--btn-tint: {fxInk.primary};"
      >
        {lowCutEnabled ? 'ON' : 'OFF'}
      </button>
    </div>

    <!-- Right: Output Gain Slider -->
    <div class="w-20 flex flex-col items-center gap-2">
      <div class="eq-label text-xs text-muted-foreground font-medium">Output</div>
      <div class="flex-1 w-full">
        <DeviceSlider
          value={outputGainValue}
          labelOrientation="horizontal"
          title={Math.round(outputGainValue * 100) + '%'}
          icon="output"
          isGhost={fx.isGhost}
          color={fx.isGhost ? ghostInk : fxInk}
          onInteraction={(val) => {
            fx.sendParam(PARAM_CONFIG.outputGain, val);
          }}
        />
      </div>
    </div>
  </div>

</div>

<style>
  /* GRATICULE: control labels are authored mixed-case ("Low Cut", "Output")
     and up-cased here for the HUD voice. */
  .eq-label {
    text-transform: uppercase;
  }

  /* ---- Live skin (flat grammar): the centred "EQ" is Live's device-name
     text — mixed case, medium weight, plain foreground — not the bold
     tracked HUD literal on a white/90 chrome colour; the LOW CUT toggle
     drops bold (app.css already gives .physical-button its flat field +
     ChosenDefault ON fill). Nothing else here paints chrome: the OUTPUT
     slider is DeviceSlider (already flat) in a bare flex wrapper, so no
     frame / shadow is re-added around it. Graticule is untouched — every
     rule sits under [data-grammar="flat"]. */
  :global([data-grammar="flat"]) .eq-title {
    text-transform: none;
    letter-spacing: 0;
    font-weight: var(--font-weight-medium);
    color: var(--foreground);
  }
  :global([data-grammar="flat"]) .eq-label {
    text-transform: none;
  }
  :global([data-grammar="flat"]) .physical-button {
    font-weight: var(--font-weight-medium);
  }
</style>