<script lang="ts">
  import { press } from '$lib/actions/press';
  /**
   * Redux's view (Live's Redux, the `redux` slot): the rest of
   * the device (user, 2026-10-26: "add more of redux's controls").
   *
   *   Crush [Pre-Filter over Jitter] [Post-Filter over Bit Depth]
   *   [DC Shift over Shape] | Mix [Dry/Wet]
   *
   * On the face grid (ADR-510), sections [6, 1], seven equal columns: each
   * knob stands over two with its switch above it, one touch row (ADR-544:
   * a switch sits with a control, above it, as Auto Filter's Time/Sync over
   * Morph), then Dry/Wet, the played level, a box past a seam at the right
   * edge as Reverb's (ADR-509). In Live's order left to right, switches and
   * knobs alike: the downsampler's Pre-Filter and Jitter, the Post-Filter
   * between it and the bit reduction, then the quantizer's Shape and DC
   * Shift. Until the Ink rollout the three switches were a column of their
   * own with no name, floating at mid-height.
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

  // The selected track's ink, as the slot's scheme hands it over (ADR-544).
  let reduxInk = $derived(redux.color);

  const value = (index: number) => redux.paramValue(index) ?? REST[index];
  const on = (index: number) => value(index) >= 0.5;
  const toggle = (index: number) => redux.sendParam(index, on(index) ? 0 : 1);

  type Slider = { index: number; title: string; min: number; max: number; icon?: 'mix' };
  type Switch = { index: number; label: string };
  // Each knob with the switch that stands over it, in Live's order.
  const CRUSH: { knob: Slider; sw: Switch }[] = [
    { knob: { index: REDUX.jitter, title: 'Jitter', min: 0, max: 1 }, sw: { index: REDUX.preFilter, label: 'Pre-Filter' } },
    { knob: { index: REDUX.bitDepth, title: 'Bit Depth', min: BIT_DEPTH_MIN, max: BIT_DEPTH_MAX }, sw: { index: REDUX.postFilterOn, label: 'Post-Filter' } },
    { knob: { index: REDUX.shape, title: 'Shape', min: 0, max: 1 }, sw: { index: REDUX.dcShift, label: 'DC Shift' } }
  ];
  const DRY_WET: Slider = { index: REDUX.dryWet, title: 'Dry/Wet', min: 0, max: 1, icon: 'mix' };
</script>

{#snippet control(s: Slider)}
  <div class="box" class:slot-ghost={redux.isGhost}>
    <DeviceSlider
      value={value(s.index)}
      title={s.title}
      face={s.index === REDUX.dryWet ? 'slider' : 'knob'}
      knobSize="l"
      knobCaptionBelow
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

<div class="redux-layout" data-view="redux">
  <FaceGrid sections={[6, 1]}>
    <FaceSection span={6}>
      {#snippet head()}<PanelEyebrow title="Crush" color={reduxInk.primary} />{/snippet}
      {#each CRUSH as c (c.knob.index)}
        <div class="pair face-span-2" class:slot-ghost={redux.isGhost}>
          <button class="physical-button btn-toggle redux-switch" class:active={on(c.sw.index)} aria-pressed={on(c.sw.index)} use:press={{ onPress: () => toggle(c.sw.index) }}>
            {c.sw.label}
          </button>
          {@render control(c.knob)}
        </div>
      {/each}
    </FaceSection>
    <FaceSeam ink={reduxInk.primary} />

    <FaceSection span={1}>
      {#snippet head()}<PanelEyebrow title="Mix" color={reduxInk.primary} />{/snippet}
      {@render control(DRY_WET)}
    </FaceSection>
  </FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510): seven equal columns, a knob with
     its switch over two each, Dry/Wet one. */
  .redux-layout {
    height: 100%;
    width: 100%;
  }

  .box,
  .pair {
    display: flex;
    flex-direction: column;
    gap: var(--face-gutter);
    min-width: 0;
    min-height: 0;
  }

  .box {
    flex: 1 1 0;
  }
  .box > :global(*) {
    flex: 1 1 0;
    min-height: 0;
  }

  /* A switch over its knob: one touch row, as wide as a column of the
     face, centred over the knob (two columns of slab were wider than the
     word and the knob under it). */
  .redux-switch {
    flex: 0 0 var(--height-touch);
    align-self: center;
    width: calc((100% - var(--face-gutter)) / 2 + 1.5rem);
    max-width: 100%;
    font-size: 1rem;
    font-weight: 600;
  }

  /* Flat grammar: medium weight. On is on's block and off a label, by
     app.css's own law (ADR-544): the view passes no tint. */
  :global([data-grammar="flat"]) .redux-switch {
    font-weight: var(--font-weight-medium);
  }
</style>
