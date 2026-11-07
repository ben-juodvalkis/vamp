<script lang="ts">
  /**
   * Auto Pan Legacy in the Tremolo slot (2026-10-01): the rate on one
   * full-rail slider under a small Sync / Free switch, and beside it the
   * LFO's shape as a vertical tab of four drawn waveforms. Amount is the grid tile's Y.
   * Parameters and labels are in `autoPanParams.ts`, measured on the rig.
   *
   * From 2026-10-15 to 2026-10-24 the view also held the Pitch family; it
   * is the Pitch view now (`PitchCentralView`). Until 2026-10-26 it held
   * the Chorus family on a drum track; since the FX chain overview gave
   * every device a view of its own, the Chorus, Blur, Comb and Phaser each
   * open theirs, and this view is Auto Pan's alone.
   */
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import LfoGraph from '../LfoGraph.svelte';
  import { pictureParams } from './panel/usePanelParams.svelte';
  import {
    AUTO_PAN,
    SYNC_RATE_MAX,
    SHAPES,
    shapeWrites,
    shapeIndex,
    syncRateLabel,
    frequencyLabel,
    type ShapeKey
  } from '$lib/components/v6/device-panel/autoPanParams';

  const fx = useFxGridSlot('tremolo');

  let fxInk = $derived({
    primary: trackInk(fx.color.primary, paintModeReactive()),
    secondary: fx.color.secondary,
    accent: trackInk(fx.color.accent, paintModeReactive())
  });

  let isSynced = $derived((fx.paramValue(AUTO_PAN.lfoType) ?? 1) >= 0.5);
  let syncRate = $derived(Math.round(fx.paramValue(AUTO_PAN.syncRate) ?? 6));
  let frequency = $derived(fx.paramValue(AUTO_PAN.frequency) ?? 0.5);
  let currentShape = $derived(
    shapeIndex(fx.paramValue(AUTO_PAN.waveform) ?? 2, fx.paramValue(AUTO_PAN.shape) ?? 0)
  );

  /** The slider is whichever rate Sync has on: all 22 steps, or the whole Hz rail. */
  let rateValue = $derived(isSynced ? syncRate / SYNC_RATE_MAX : frequency);
  let rateLabel = $derived(isSynced ? syncRateLabel(syncRate) : frequencyLabel(frequency));

  /** The tremolo as a picture (ADR-514): its rate in cycles, its amount (the chain tile's Y) as its depth. */
  const picture = pictureParams(() => ({ Rate: rateValue, Amount: fx.paramValue(AUTO_PAN.amount) ?? 1 }));

  function writeRate(t: number) {
    if (isSynced) {
      const step = Math.round(t * SYNC_RATE_MAX);
      if (step !== syncRate) fx.sendParam(AUTO_PAN.syncRate, step);
    } else {
      fx.sendParam(AUTO_PAN.frequency, t);
    }
  }

  function toggleSync() {
    fx.sendParam(AUTO_PAN.lfoType, isSynced ? 0 : 1);
  }

  function writeShape(step: number) {
    if (step === currentShape) return;
    for (const [i, v] of shapeWrites(SHAPES[step].key)) fx.sendParam(i, v);
  }


  /** One cycle each, Drift's glyph grammar: peak y=2, floor y=10, midline 6. */
  const GLYPHS: Record<ShapeKey, string> = {
    saw: 'M2 10 L2 2 L22 10',
    square: 'M0 10 L0 2 L12 2 L12 10 L24 10',
    sine: 'M0 6 Q6 -1 12 6 T24 6',
    triangle: 'M0 6 L6 2 L18 10 L24 6'
  };
</script>

<!-- One face grid (ADR-510): the rate under its Sync switch, the wave
     drawn across two columns (ADR-514), then the shape tab. -->
<div class="autopan-layout" class:slot-ghost={fx.isGhost} style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
  <FaceGrid sections={[1, 2, 1]}>
    <FaceSection span={1}>
      {#snippet head()}<PanelEyebrow title="Rate" color={fxInk.primary} />{/snippet}
      <!-- Sync, small, over the rate it switches. -->
      <div class="rate-col">
        <button
          class="physical-button btn-toggle sync-toggle w-full font-bold"
          class:active={isSynced}
          style="--btn-tint: {fxInk.primary};"
          onclick={toggleSync}
        >
          {isSynced ? 'Sync' : 'Free'}
        </button>
        <div class="rate-slider">
          <DeviceSlider
            value={rateValue}
            title={rateLabel}
            orientation="vertical"
            isGhost={fx.isGhost}
            color={fxInk}
            onInteraction={writeRate}
          />
        </div>
      </div>

    </FaceSection>
    <FaceSeam />
    <FaceSection span={2}>
      {#snippet head()}<PanelEyebrow title="Tremolo" color={fxInk.primary} />{/snippet}
      <div class="face-span-all">
        <LfoGraph params={picture} shape={SHAPES[currentShape ?? 0]?.key} rate="Rate" amount="Amount" ink={fxInk.primary} interactive={false} />
      </div>
    </FaceSection>
    <FaceSeam />
    <FaceSection span={1}>
      {#snippet head()}<PanelEyebrow title="Shape" color={fxInk.primary} />{/snippet}
      <!-- The shape tab scrubs on Y, as the Drum Buss's drive type. -->
      <ScrubTabs
        options={SHAPES}
        selected={currentShape ?? -1}
        onSelect={(step) => writeShape(step)}
        cols={1}
        tint={fxInk.primary}
        inked
        label={(s) => `Shape ${s.label}`}
        name="shape"
      >
        {#snippet item(s)}
          <svg class="shape-glyph" viewBox="0 0 24 12" aria-hidden="true" focusable="false">
                  <path
                    d={GLYPHS[s.key]}
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    vector-effect="non-scaling-stroke"
                  />
                </svg>
        {/snippet}
      </ScrubTabs>
    </FaceSection>
  </FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510). */
  .autopan-layout {
    height: 100%;
    width: 100%;
    min-height: 0;
  }

  .rate-col {
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--face-gutter);
  }

  .rate-slider {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* Small: one touch row over the slider. */
  .sync-toggle {
    flex: 0 0 var(--height-touch, 44px);
    min-height: 0;
    font-size: 0.875rem;
    text-transform: uppercase;
  }

  .shape-glyph {
    width: min(70%, 3rem);
    height: auto;
    overflow: visible;
  }

  :global([data-grammar="flat"]) .sync-toggle {
    font-weight: var(--font-weight-medium);
    text-transform: none;
  }

  /* One ink for the device, as the Drum Buss does: the lit switch and the
     lit shape take the device's ink rather than the house --phosphor. */
  :global([data-grammar="flat"]) .sync-toggle.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }
  :global([data-grammar="flat"]) .sync-toggle:not(.active) {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
</style>
