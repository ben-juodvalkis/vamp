<script lang="ts">
  /**
   * Auto Pan Legacy in the Tremolo slot (2026-10-01): the rate on one
   * full-rail slider, the Sync / Free switch, and the LFO's shape as a
   * vertical tab of four drawn waveforms. Amount is the grid tile's Y.
   * Parameters and labels are in `autoPanParams.ts`, measured on the rig.
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
</script>

<div class="autopan-layout" class:slot-ghost={fx.isGhost} style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
  <div class="col">
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

  <div class="col">
    <button
      class="physical-button sync-toggle w-full h-full font-bold"
      class:active={isSynced}
      style="--btn-tint: {fxInk.primary};"
      onclick={toggleSync}
    >
      {isSynced ? 'Sync' : 'Free'}
    </button>
  </div>

  <div
    class="col device-segmented shape-tab"
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

<style>
  .autopan-layout {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--central-gap);
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
  }

  .col {
    min-height: 0;
    min-width: 0;
    height: 100%;
  }

  .sync-toggle {
    font-size: 2.25rem;
    text-transform: uppercase;
  }

  .shape-tab {
    display: grid;
  }
  /* The column owns the pointer; the steps are its face. Keyboard focus
     and Enter still activate one. */
  .shape-step {
    pointer-events: none;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .shape-glyph {
    width: min(60%, 7rem);
    height: auto;
    overflow: visible;
  }

  :global([data-grammar="flat"]) .sync-toggle {
    font-weight: var(--font-weight-medium);
    text-transform: none;
  }

  /* One ink for the view, as the Drum Buss does: the lit switch and the
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
