<script lang="ts">
  /**
   * Redux's view (Live's Redux, the `redux` slot): its pad and the rest of
   * the device (user, 2026-10-26: "add more of redux's controls").
   *
   *   [pad: Post-Filter across, Sample Rate up] [Bit Depth / Jitter]
   *   [Shape / Dry/Wet] [Pre-Filter · Post-Filter · DC Shift]
   *
   * The pad is the `redux` control (`deviceControls`, ADR-479). The rest are
   * value boxes (ADR-477) and switches, Live's own parameters as measured
   * on the rig (2026-10-26, the Redux preset loaded and dumped): 2 Jitter
   * 0..1, 3 Bit Depth 1..16, 4 Quantizer Shape 0..1, 5 DC Shift, 6
   * Pre-Filter On, 7 Post-Filter On (switches), 9 Dry/Wet 0..1. A ghost
   * draws Live's defaults, and its first write loads it.
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */
  import ReduxControl from '$lib/components/v6/device-panel/ReduxControl.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';

  const redux = useFxGridSlot('redux');

  const REDUX = { jitter: 2, bitDepth: 3, shape: 4, dcShift: 5, preFilter: 6, postFilterOn: 7, dryWet: 9 } as const;
  const BIT_DEPTH_MIN = 1;
  const BIT_DEPTH_MAX = 16;
  /** Live's values on a freshly inserted Redux, what a ghost shows. */
  const REST: Record<number, number> = { 2: 0, 3: 16, 4: 0, 5: 0, 6: 0, 7: 1, 9: 1 };

  let reduxInk = $derived({
    primary: trackInk(redux.color.primary, paintModeReactive()),
    secondary: redux.color.secondary,
    accent: trackInk(redux.color.accent, paintModeReactive())
  });

  const value = (index: number) => redux.paramValue(index) ?? REST[index];
  const on = (index: number) => value(index) >= 0.5;
  const toggle = (index: number) => redux.sendParam(index, on(index) ? 0 : 1);

  const SLIDERS = [
    { index: REDUX.bitDepth, title: 'Bit Depth', min: BIT_DEPTH_MIN, max: BIT_DEPTH_MAX },
    { index: REDUX.jitter, title: 'Jitter', min: 0, max: 1 },
    { index: REDUX.shape, title: 'Shape', min: 0, max: 1 },
    { index: REDUX.dryWet, title: 'Dry/Wet', min: 0, max: 1, icon: 'mix' as const }
  ];
  const SWITCHES = [
    { index: REDUX.preFilter, label: 'Pre-Filter' },
    { index: REDUX.postFilterOn, label: 'Post-Filter' },
    { index: REDUX.dcShift, label: 'DC Shift' }
  ];
</script>

<div class="redux-layout" data-view="redux" style="--btn-tint: {reduxInk.primary};">
  <div class="pad" class:slot-ghost={redux.isGhost}>
    <ReduxControl device={redux.device} icon="redux" />
  </div>

  {#each [SLIDERS.slice(0, 2), SLIDERS.slice(2)] as column, c (c)}
    <div class="boxes" class:slot-ghost={redux.isGhost}>
      {#each column as s (s.index)}
        <DeviceSlider
          value={value(s.index)}
          title={s.title}
          icon={s.icon}
          orientation="vertical"
          min={s.min}
          max={s.max}
          isGhost={redux.isGhost}
          color={reduxInk}
          readout={redux.paramDisplay(s.index)}
          onInteraction={(v) => redux.sendParam(s.index, v)}
        />
      {/each}
    </div>
  {/each}

  <div class="switches" class:slot-ghost={redux.isGhost}>
    {#each SWITCHES as s (s.index)}
      <button class="physical-button redux-switch w-full" class:active={on(s.index)} aria-pressed={on(s.index)} onclick={() => toggle(s.index)}>
        {s.label}
      </button>
    {/each}
  </div>
</div>

<style>
  /* The pad two shares; two columns of value boxes and the switches one each. */
  .redux-layout {
    display: grid;
    grid-template-columns: minmax(0, 2fr) repeat(3, minmax(0, 1fr));
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  .pad,
  .boxes,
  .switches {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    min-width: 0;
    min-height: 0;
  }

  .boxes > :global(*),
  .redux-switch {
    flex: 1 1 0;
    min-height: 0;
  }

  .redux-switch {
    min-height: var(--height-touch);
    font-size: 1rem;
    font-weight: 600;
  }

  /* Flat grammar: medium weight, and the device's own ink when on (as the
     Drum Buss's Comp switch), not the house ON color beside its faders. */
  :global([data-grammar="flat"]) .redux-switch {
    font-weight: var(--font-weight-medium);
  }
  :global([data-grammar="flat"]) .redux-switch.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }
  :global([data-grammar="flat"]) .redux-switch:not(.active) {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
</style>
