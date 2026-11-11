<script lang="ts">
  import { press } from '$lib/actions/press';
  /**
   * Grain Delay's view (Live's Grain Delay, the `grainDelay` type; the user,
   * 2026-11-11: "a custom view, not generic"): the rest of the device.
   *
   *   Grain [Frequency] [Spray] [Random] | Delay [Sync · Time] [Swing] |
   *   Mix [Dry/Wet]
   *
   * On the face grid (ADR-510), sections [3, 2, 1], in Live's order. Pitch
   * and Feedback are the chain cell's XY (`deviceControls.grainDelay`),
   * drawn above this view, so the view does not draw them again. The delay
   * time is a beat count while Sync is on and milliseconds while it is off,
   * one knob in the same place either way, as Live's own panel swaps them.
   *
   * Live's parameters, measured on the rig's own Grain Delay (2026-11-11,
   * device_dump.js): 1 Spray 0..1 (0–500 ms), 2 Frequency 0..1 (1–150 Hz),
   * 4 Random 0..1, 6 DryWet 0..1, 7 Delay Mode 0..1 (Sync off/on), 8 Beat
   * Delay 0..7 (1 2 3 4 5 6 8 16), 9 Beat Swing ±0.333, 10 Time Delay
   * 1..128 ms. A ghost draws Live's defaults, and its first write loads it.
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

  const grain = useFxGridSlot('grainDelay');

  const GRAIN = { spray: 1, frequency: 2, random: 4, dryWet: 6, sync: 7, beats: 8, swing: 9, time: 10 } as const;
  /** Live's values on a freshly inserted Grain Delay, what a ghost shows. */
  const REST: Record<number, number> = { 1: 0, 2: 0.817, 4: 0, 6: 1, 7: 1, 8: 1, 9: 0, 10: 40 };

  let ink = $derived({
    primary: trackInk(grain.color.primary, paintModeReactive()),
    secondary: grain.color.secondary,
    accent: trackInk(grain.color.accent, paintModeReactive())
  });

  const value = (index: number) => grain.paramValue(index) ?? REST[index];
  const synced = $derived(value(GRAIN.sync) >= 0.5);

  type Knob = { index: number; title: string; min: number; max: number; face?: 'knob' | 'slider'; icon?: 'mix' };
  const GRAINS: Knob[] = [
    { index: GRAIN.frequency, title: 'Frequency', min: 0, max: 1 },
    { index: GRAIN.spray, title: 'Spray', min: 0, max: 1 },
    { index: GRAIN.random, title: 'Random', min: 0, max: 1 }
  ];
  const BEATS: Knob = { index: GRAIN.beats, title: 'Beats', min: 0, max: 7 };
  const TIME: Knob = { index: GRAIN.time, title: 'Time', min: 1, max: 128 };
  const SWING: Knob = { index: GRAIN.swing, title: 'Swing', min: -0.333, max: 0.333 };
  const DRY_WET: Knob = { index: GRAIN.dryWet, title: 'Dry/Wet', min: 0, max: 1, face: 'slider', icon: 'mix' };
</script>

{#snippet control(k: Knob)}
  <div class="box" class:slot-ghost={grain.isGhost}>
    <DeviceSlider
      value={value(k.index)}
      title={k.title}
      face={k.face ?? 'knob'}
      knobSize="l"
      icon={k.icon}
      orientation="vertical"
      min={k.min}
      max={k.max}
      isGhost={grain.isGhost}
      color={ink}
      readout={grain.paramDisplay(k.index)}
      onInteraction={(v) => grain.sendParam(k.index, k.index === GRAIN.beats ? Math.round(v) : v)}
    />
  </div>
{/snippet}

<div class="grain-layout" data-view="grainDelay" style="--btn-tint: {ink.primary};">
  <FaceGrid sections={[3, 2, 1]}>
    <FaceSection span={3}>
      {#snippet head()}<PanelEyebrow title="Grain" color={ink.primary} />{/snippet}
      {#each GRAINS as k (k.index)}{@render control(k)}{/each}
    </FaceSection>
    <FaceSeam ink={ink.primary} />

    <FaceSection span={2}>
      {#snippet head()}<PanelEyebrow title="Delay" color={ink.primary} />{/snippet}
      <div class="time-col">
        <button
          class="physical-button btn-toggle grain-switch w-full"
          class:active={synced}
          class:slot-ghost={grain.isGhost}
          aria-pressed={synced}
          use:press={{ onPress: () => grain.sendParam(GRAIN.sync, synced ? 0 : 1) }}
        >Sync</button>
        {@render control(synced ? BEATS : TIME)}
      </div>
      {@render control(SWING)}
    </FaceSection>
    <FaceSeam ink={ink.primary} />

    <FaceSection span={1}>
      {#snippet head()}<PanelEyebrow title="Mix" color={ink.primary} />{/snippet}
      {@render control(DRY_WET)}
    </FaceSection>
  </FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510): six equal columns. */
  .grain-layout {
    height: 100%;
    width: 100%;
  }

  .box,
  .time-col {
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

  /* Sync: one touch row over the time knob it switches (ADR-509). */
  .grain-switch {
    flex: 0 0 var(--height-touch);
    font-size: 1rem;
    font-weight: 600;
  }

  /* Flat grammar: the device's own ink when on, as Redux's switches. */
  :global([data-grammar="flat"]) .grain-switch {
    font-weight: var(--font-weight-medium);
  }
  :global([data-grammar="flat"]) .grain-switch.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }
  :global([data-grammar="flat"]) .grain-switch:not(.active) {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
</style>
