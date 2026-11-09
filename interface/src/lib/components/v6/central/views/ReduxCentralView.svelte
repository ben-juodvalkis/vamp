<script lang="ts">
  import { press } from '$lib/actions/press';
  /**
   * Redux's view (Live's Redux, the `redux` slot): the rest of
   * the device (user, 2026-10-26: "add more of redux's controls").
   *
   *   Crush [Jitter] [Bit Depth] [Shape] | [Pre-Filter · Post-Filter ·
   *   DC Shift] | Mix [Dry/Wet]
   *
   * On the face grid (ADR-510), sections [3, 1, 1], in Live's order: the
   * downsampler's Jitter, the bit reduction, the switches, then Dry/Wet,
   * the played level, past a seam at the right edge as Reverb's (ADR-509).
   * Every knob one to a column, so large.
   *
   * Sample Rate and Post-Filter are the chain cell's pad (the `redux`
   * control, `deviceControls`, ADR-479), drawn above this view, so the view
   * no longer draws that pad too (user, 2026-11-06). The rest are knobs,
   * a value box and switches, Live's own parameters as measured
   * on the rig (2026-10-26, the Redux preset loaded and dumped): 2 Jitter
   * 0..1, 3 Bit Depth 1..16, 4 Quantizer Shape 0..1, 5 DC Shift, 6
   * Pre-Filter On, 7 Post-Filter On (switches), 9 Dry/Wet 0..1. A ghost
   * draws Live's defaults, and its first write loads it.
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';

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

  type Slider = { index: number; title: string; min: number; max: number; icon?: 'mix' };
  const CRUSH: Slider[] = [
    { index: REDUX.jitter, title: 'Jitter', min: 0, max: 1 },
    { index: REDUX.bitDepth, title: 'Bit Depth', min: BIT_DEPTH_MIN, max: BIT_DEPTH_MAX },
    { index: REDUX.shape, title: 'Shape', min: 0, max: 1 }
  ];
  const DRY_WET: Slider = { index: REDUX.dryWet, title: 'Dry/Wet', min: 0, max: 1, icon: 'mix' };
  const SWITCHES = [
    { index: REDUX.preFilter, label: 'Pre-Filter' },
    { index: REDUX.postFilterOn, label: 'Post-Filter' },
    { index: REDUX.dcShift, label: 'DC Shift' }
  ];
</script>

{#snippet control(s: Slider)}
  <div class="box" class:slot-ghost={redux.isGhost}>
    <DeviceSlider
      value={value(s.index)}
      title={s.title}
      face={s.index === REDUX.dryWet ? 'slider' : 'knob'}
      knobSize="l"
      icon={s.icon}
      orientation="vertical"
      min={s.min}
      max={s.max}
      isGhost={redux.isGhost}
      color={reduxInk}
      readout={redux.paramDisplay(s.index)}
      onInteraction={(v) => redux.sendParam(s.index, v)}
    />
  </div>
{/snippet}

<div class="redux-layout" data-view="redux" style="--btn-tint: {reduxInk.primary};">
  <FaceGrid sections={[3, 1, 1]}>
    <FaceSection span={3}>
      {#snippet head()}<PanelEyebrow title="Crush" color={reduxInk.primary} />{/snippet}
      {#each CRUSH as s (s.index)}{@render control(s)}{/each}
    </FaceSection>
    <FaceSeam ink={reduxInk.primary} />

    <FaceSection span={1}>
      {#snippet head()}<PanelEyebrow color={reduxInk.primary} />{/snippet}
      <div class="switches" class:slot-ghost={redux.isGhost}>
        {#each SWITCHES as s (s.index)}
          <button class="physical-button btn-toggle redux-switch w-full" class:active={on(s.index)} aria-pressed={on(s.index)} use:press={{ onPress: () => toggle(s.index) }}>
            {s.label}
          </button>
        {/each}
      </div>
    </FaceSection>
    <FaceSeam ink={reduxInk.primary} />

    <FaceSection span={1}>
      {#snippet head()}<PanelEyebrow title="Mix" color={reduxInk.primary} />{/snippet}
      {@render control(DRY_WET)}
    </FaceSection>
  </FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510): five equal columns. */
  .redux-layout {
    height: 100%;
    width: 100%;
  }

  .box,
  .switches {
    display: flex;
    flex-direction: column;
    gap: var(--face-gutter);
    min-width: 0;
    min-height: 0;
  }

  .box > :global(*) {
    flex: 1 1 0;
    min-height: 0;
  }

  /* The switches: one touch row each, centred in their column (ADR-509). */
  .switches {
    justify-content: center;
  }
  .redux-switch {
    flex: 0 0 var(--height-touch);
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
