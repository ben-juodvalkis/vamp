<script lang="ts">
  /**
   * EQCentralView - Slot-Aware Version
   *
   * Self-contained central view that queries its own slot state.
   * Renders immediately with ghost/loading/active states.
   * Displays Channel EQ output gain slider, and beside it Ben's Adaptive Tone
   * Shaper's graph (2026-10-07; oeksound bloom's sliders the day before).
   *
   * NO {#if device} gate - always renders, handles its own state.
   * NO props required - queries selectedTrackStore directly.
   */

  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { deviceInk } from '$lib/utils/formatters/trackFormatters';
  import { familyScheme } from '$lib/config/devicePresets';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { toneShaperStore } from '$lib/stores/v3/toneShaper.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import ToneShaperGraph from './eq/ToneShaperGraph.svelte';
  import { TS_PARAM, TS_HANDLE } from './eq/toneShaper';

  const fx = useFxGridSlot('eq');
  const ts = useFxGridSlot('toneShaper');

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

  let tsInk = $derived({
    primary: deviceInk(ts.color.primary, paintModeReactive()),
    secondary: ts.color.secondary,
    accent: deviceInk(ts.color.accent, paintModeReactive())
  });

  // The Tone Shaper's parameters in their own units (`TS_PARAM`). Unloaded
  // it draws Amount 0 (the user's call for bloom, 2026-10-06), the handles
  // flat at their rest centers, ZERO on, as the device loads.
  let tsAmount = $derived(ts.paramValue(TS_PARAM.amount) ?? 0);
  let tsLevels = $derived(TS_HANDLE.map((_, i) => ts.paramValue(TS_PARAM.levels[i]) ?? 0));
  let tsHz = $derived(TS_HANDLE.map((h, i) => ts.paramValue(TS_PARAM.hz[i]) ?? h.rest));
  let tsZero = $derived((ts.paramValue(TS_PARAM.latency) ?? 1) >= 0.5);
  let tsEco = $derived((ts.paramValue(TS_PARAM.quality) ?? 0) >= 0.5);
  let tsFrame = $derived(ts.devicePath ? toneShaperStore.get(ts.devicePath) : undefined);

  // Tell the bridge which device's frames to relay: this one's while the
  // view is up, none when it goes.
  $effect(() => {
    toneShaperStore.watch(ts.devicePath ?? '');
    return () => toneShaperStore.watch('');
  });
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="h-full w-full flex p-(--central-inset) gap-(--central-gap)">
<!-- Channel EQ: Low Cut, the name, Output. -->
<div class="eq-group h-full flex flex-col items-center justify-center relative" class:slot-ghost={fx.isGhost}>
  <!-- Centered EQ label matching DeviceXY standard -->
  <div
    class="eq-title absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-2xl font-bold uppercase tracking-wider pointer-events-none select-none z-10 dark:text-white/90 light:text-foreground/80"
  >EQ</div>

  <div class="w-full h-full flex justify-between">
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

<SectionDivider orientation="vertical" ink={tsInk.primary} />

<!-- The Tone Shaper: its name over its graph. A tap on a ghost loads it; a
     drag loads it and writes. -->
<div class="ts-group h-full flex-1 min-w-0 flex flex-col" class:slot-ghost={ts.isGhost}>
  <span class="ts-title" style="color: {tsInk.primary};">Tone Shaper</span>
  <div class="flex-1 min-h-0">
    <ToneShaperGraph
      frame={tsFrame}
      amount={tsAmount}
      levels={tsLevels}
      hz={tsHz}
      zero={tsZero}
      eco={tsEco}
      color={ts.isGhost ? ghostInk : tsInk}
      isGhost={ts.isGhost}
      onWrite={(index, value) => ts.sendParam(index, value)}
      onTap={() => ts.loadIfGhost()}
    />
  </div>
</div>
</div>

<style>
  /* GRATICULE: control labels are authored mixed-case ("Low Cut", "Output")
     and up-cased here for the HUD voice. */
  .eq-label {
    text-transform: uppercase;
  }

  /* The Channel EQ keeps a fixed width; the graph takes the rest. */
  .eq-group {
    flex: 0 0 16rem;
  }
  .ts-group {
    gap: var(--spacing-xs);
  }
  /* The eyebrow every named group in a central view wears (EnvelopeGroup's). */
  .ts-title {
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    text-align: center;
    white-space: nowrap;
  }
  :global([data-grammar="flat"]) .ts-title {
    letter-spacing: normal;
    text-transform: none;
    font-weight: var(--font-weight-medium);
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
