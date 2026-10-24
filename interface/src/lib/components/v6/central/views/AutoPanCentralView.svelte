<script lang="ts">
  /**
   * Auto Pan Legacy in the Tremolo slot (2026-10-01): the rate on one
   * full-rail slider under a small Sync / Free switch, and beside it the
   * LFO's shape as a vertical tab of four drawn waveforms. Amount is the grid tile's Y.
   * Parameters and labels are in `autoPanParams.ts`, measured on the rig.
   *
   * Since 2026-10-15 (the user's call) the view also holds the Chorus and
   * Pitch families, whose tiles left the grid: the Chorus XY, Blur, Comb
   * and Phaser (`autopan/ChorusGroup`), then the Octave's interval column
   * and Mix slider (the Pitch XY, split in two) and Pitch Hack's Mix,
   * Coarse and Rate (`autopan/PitchGroup`). Every family is a column,
   * its controls stacked so none is narrow; the groups' roots are
   * `display: contents`, so one grid here holds every column and seam.
   *
   * Only on a drum track (2026-10-23): elsewhere the Chorus XY is the FX
   * grid's tile in the Drum cell and Blur, Comb and Phaser are the Chorus
   * view's (`ChorusCentralView`), so the Chorus group and its two columns
   * leave this view.
   */
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { drag } from '$lib/actions';
  import type { DragInfo } from '$lib/actions/drag';
  import { segmentIndex, scrubBoxOf, type ScrubBox } from '$lib/utils/segmentScrub';
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
  import ChorusGroup from './autopan/ChorusGroup.svelte';
  import { drumCellHoldsChorus } from '$lib/components/v6/device-panel/drumCell.svelte';
  import PitchGroup from './autopan/PitchGroup.svelte';

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

  /**
   * The tab scrubs on Y like the Drum Buss's drive type: the column owns
   * the pointer and resolves the step from geometry, and only a step edge
   * reaches Live.
   */
  let shapeStrip = $state<HTMLElement | null>(null);
  let shapeBox: ScrubBox | null = null;

  function shapeAt(clientY: number) {
    if (!shapeBox) return;
    writeShape(segmentIndex(clientY, shapeBox.top, shapeBox.height, SHAPES.length));
  }

  function shapeDown(info: DragInfo) {
    shapeBox = scrubBoxOf(shapeStrip);
    shapeAt(info.y);
  }

  /** One cycle each, Drift's glyph grammar: peak y=2, floor y=10, midline 6. */
  const GLYPHS: Record<ShapeKey, string> = {
    saw: 'M2 10 L2 2 L22 10',
    square: 'M0 10 L0 2 L12 2 L12 10 L24 10',
    sine: 'M0 6 Q6 -1 12 6 T24 6',
    triangle: 'M0 6 L6 2 L18 10 L24 6'
  };

  // The Chorus family is drawn here only where the grid has no Chorus tile.
  const withChorus = $derived(!drumCellHoldsChorus());
</script>

<div class="autopan-layout" class:no-chorus={!withChorus}>
  <!-- Auto Pan: rate, shape and Sync stacked in one column (2026-10-15).
       Only this column dims while Auto Pan is a ghost; the other families
       keep their own ghost states. -->
  <div class="stack autopan-col" class:slot-ghost={fx.isGhost} style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
    <span class="col-title" style="color: {fxInk.primary};">Auto Pan</span>
    <div class="pair">
      <!-- Sync, small, over the rate it switches. -->
      <div class="rate-col">
        <button
          class="physical-button sync-toggle w-full font-bold"
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
            labelOrientation="horizontal"
            isGhost={fx.isGhost}
            color={fxInk}
            onInteraction={writeRate}
          />
        </div>
      </div>

      <div
        class="device-segmented shape-tab"
        style="--btn-tint: {fxInk.primary}; grid-template-rows: repeat({SHAPES.length}, 1fr);"
        bind:this={shapeStrip}
        use:drag={{ commit: 'immediate', onDown: shapeDown, onMove: (i) => shapeAt(i.y) }}
      >
        {#each SHAPES as s, step}
          <button
            class="device-segment shape-step"
            class:active={currentShape === step}
            title={s.label}
            aria-label="Shape {s.label}"
            aria-pressed={currentShape === step}
            onclick={() => writeShape(step)}
          >
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
          </button>
        {/each}
      </div>
    </div>
  </div>

  {#if withChorus}<ChorusGroup />{/if}
  <PitchGroup />
</div>

<style>
  /* Five columns, each a device family stacked top to bottom (2026-10-15,
     the user's call: no control so narrow): Auto Pan | Chorus over Blur |
     Comb over Phaser | the Octave | Pitch Hack. A seam is its hairline. */
  .autopan-layout {
    display: grid;
    grid-template-columns:
      minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr)
      auto minmax(0, 1fr) auto minmax(0, 1fr);
    gap: var(--central-gap);
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
  }
  /* Off a drum track the Chorus group's two columns and seams are the
     Chorus view's: Auto Pan | the Octave | Pitch Hack. */
  .autopan-layout.no-chorus {
    grid-template-columns:
      minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    min-height: 0;
    min-width: 0;
  }

  /* Under the title, the rate and the shape stand upright side by side. */
  .pair {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    display: flex;
    gap: var(--central-gap);
  }

  .rate-col {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm, 8px);
  }

  .rate-slider {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* The house eyebrow, naming the column's device. */
  .col-title {
    flex: 0 0 auto;
    font-size: 0.75rem;
    line-height: 1rem;
    letter-spacing: 0.05em;
    font-weight: 700;
    text-align: center;
  }
  :global([data-grammar="flat"]) .col-title {
    text-transform: none;
    letter-spacing: normal;
  }

  /* Small: one touch row over the slider. */
  .sync-toggle {
    flex: 0 0 var(--height-touch, 44px);
    min-height: 0;
    font-size: 0.875rem;
    text-transform: uppercase;
  }

  .shape-tab {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    display: grid;
  }
  /* The row owns the pointer; the steps are its face. Keyboard focus
     and Enter still activate one. */
  .shape-step {
    pointer-events: none;
    min-width: 0;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
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
  :global([data-grammar="flat"]) .sync-toggle.active,
  :global([data-grammar="flat"]) .shape-tab .device-segment.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }
  :global([data-grammar="flat"]) .shape-tab .device-segment:not(.active),
  :global([data-grammar="flat"]) .sync-toggle:not(.active) {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
</style>
