<script lang="ts">
  /**
   * GlueCentralView — the Glue Compressor's view (slot `squash`).
   *
   * The half `SquashControl` cannot reach. That tile (the top of the FX
   * grid's Gain column) is one finger over threshold+makeup together,
   * which is the performance gesture. Threshold and output are the
   * settings behind it, each set outright here (Threshold added beside
   * Output, user, 2026-09-16). Two value boxes (ADR-477), Threshold over
   * Output.
   *
   * Split out of the shared dynamics view (`SquashCentralView`, which also
   * held the Gate, the Multiband and the Compressor) when the FX chain
   * overview gave every device its own view (ADR-478).
   *
   * Self-contained: queries its own slot state, takes no props, and
   * renders through ghost/loading/active without a `{#if device}` gate.
   */

  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

  // The disabled/idle scheme is the neutral utility family (deviceInk-safe greys).
  const IDLE_SCHEME = { primary: '#a2acb7', secondary: 'color-mix(in oklab, var(--signal-dim) 10%, transparent)', accent: '#bbc5d1' };

  // Indices and rails measured off `Glue Compressor.adv`: the preset's
  // element order IS LOM order with Device On at 0. Its two nested
  // containers (<SideChain>, <SideChainEq>) sit after every flat param,
  // so unlike Compressor2 nothing here drifts.
  //   1 = Threshold -40..0 dB — SquashControl drives it too
  //   3 = Makeup  0..20 dB   — "Output"; SquashControl drives it too
  const squash = useFxGridSlot('squash');

  const GLUE_THRESHOLD_PARAM = 1;
  const GLUE_THRESHOLD_MIN = -40;
  const GLUE_THRESHOLD_MAX = 0;
  const GLUE_OUTPUT_PARAM = 3;
  const GLUE_OUTPUT_MIN = 0;
  const GLUE_OUTPUT_MAX = 20;

  // Pre-echo fallbacks are the .adv's own stored defaults, so a ghost
  // draws the preset it would load rather than a wrong zero.
  const squashDefaults = { threshold: 0, output: 0 };

  // ADR-400: these controls drive the Glue Compressor, so they wear its ink.
  let squashInk = $derived(squash.color);

  let glueThreshold = $derived(squash.paramValue(GLUE_THRESHOLD_PARAM) ?? squashDefaults.threshold);
  let glueOutput = $derived(squash.paramValue(GLUE_OUTPUT_PARAM) ?? squashDefaults.output);
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states.
     `sendParam` is fire-and-forget on a ghost — it queues and triggers
     the load. -->
<div class="glue-central-layout relative">
  <!-- Live's own direction: up is a higher threshold, i.e. less
       squash — the opposite of the tile, whose up is MORE. -->
  <div class="glue-slider" class:slot-ghost={squash.isGhost}>
    <DeviceSlider
      value={glueThreshold}
      title="Threshold"
      icon="threshold"
      orientation="vertical"
      min={GLUE_THRESHOLD_MIN}
      max={GLUE_THRESHOLD_MAX}
      isGhost={squash.isGhost}
      color={squash.isGhost ? IDLE_SCHEME : squashInk}
      readout={squash.paramDisplay(GLUE_THRESHOLD_PARAM)}
      onTap={() => squash.loadIfGhost()}
      onInteraction={(value) => squash.sendParam(GLUE_THRESHOLD_PARAM, value)}
    />
  </div>
  <div class="glue-slider" class:slot-ghost={squash.isGhost}>
    <DeviceSlider
      value={glueOutput}
      title="Output"
      icon="output"
      orientation="vertical"
      min={GLUE_OUTPUT_MIN}
      max={GLUE_OUTPUT_MAX}
      isGhost={squash.isGhost}
      color={squash.isGhost ? IDLE_SCHEME : squashInk}
      readout={squash.paramDisplay(GLUE_OUTPUT_PARAM)}
      onTap={() => squash.loadIfGhost()}
      onInteraction={(value) => squash.sendParam(GLUE_OUTPUT_PARAM, value)}
    />
  </div>
</div>

<style>
  /* threshold over output */
  .glue-central-layout {
    display: grid;
    grid-template-rows: repeat(2, minmax(0, 1fr));
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  .glue-slider {
    min-width: 0;
    min-height: 0;
  }
</style>
