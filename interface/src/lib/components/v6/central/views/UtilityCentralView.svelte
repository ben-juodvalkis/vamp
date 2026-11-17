<script lang="ts">
  import { press } from '$lib/actions/press';
  /**
   * UtilityCentralView — the Utility's view (slot `utility`, StereoGain).
   *
   *   Stereo [Width / Mono] [Balance / Invert L · Invert R]
   *   | Bass [Bass Freq / Bass Mono] | Channel [Left · Stereo · Right · Swap / DC Filter · Mute]
   *
   * On the face grid (ADR-510), sections [2, 1, 1]: four columns of about
   * 240px, each an amount or a pick over one touch row at its foot. The
   * three knobs are the largest the band holds, one size, on one line; a
   * switch sits under the control it belongs to (ADR-544): Mono under
   * Width, the two inverts under Balance, Bass Mono under Bass Freq. The
   * channel mode is one of four named settings, so it is a tab, two by
   * two, not four switches with lamps. (Until the rollout the six switches
   * stood apart in a column of their own, three rows of two, and the mode
   * was a column of four lamp switches.)
   *
   * No Gain: it is the Utility's chain cell (the `utility` control,
   * `deviceControls`), always beside this view (the user, 2026-11-05).
   * Live's own parameters as measured on the rig (2026-11-05,
   * `device_dump.js` on a Utility, 12.4 beta): 1 Left Inv, 2 Right Inv
   * (switches), 3 Channel Mode 0..3 (Left · Stereo · Right · Swap), 4 Stereo
   * Width 0..2 (1 = 100 %, 2 = 400 %), 5 Mono, 6 Bass Mono (switches), 7 Bass
   * Freq 0..1 (50..500 Hz), 8 Balance -1..1, 10 Mute, 11 DC Filter
   * (switches). The LOM indices, not the saved order (live-api-measurements.md).
   * A ghost draws Live's defaults, and its first write loads it.
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */

  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';

  const utility = useFxGridSlot('utility');

  const UTIL = {
    leftInv: 1, rightInv: 2, channelMode: 3, width: 4, mono: 5,
    bassMono: 6, bassFreq: 7, balance: 8, mute: 10, dcFilter: 11
  } as const;
  /** Live's values on a freshly inserted Utility, what a ghost shows. */
  const REST: Record<number, number> = { 1: 0, 2: 0, 3: 1, 4: 1, 5: 0, 6: 0, 7: 0.3802112340927124, 8: 0, 10: 0, 11: 0 };

  // One ink (ADR-544): the selected track's, as the slot hands it over.
  let ink = $derived(utility.color);

  const value = (index: number) => utility.paramValue(index) ?? REST[index];
  const on = (index: number) => value(index) >= 0.5;
  const toggle = (index: number) => utility.sendParam(index, on(index) ? 0 : 1);

  const CHANNEL_MODES = ['Left', 'Stereo', 'Right', 'Swap'];
  const channelMode = $derived(Math.round(value(UTIL.channelMode)));
</script>

<!-- A knob in its parameter's own range, the largest its cell holds. -->
{#snippet knob(index: number, title: string, min: number, max: number, center?: number)}
  <div class="knob">
    <DeviceSlider
      value={value(index)}
      {title}
      face="knob"
      knobSize="xl"
      knobFit
      knobCaptionBelow
      orientation="vertical"
      {min}
      {max}
      centerOrigin={center !== undefined}
      centerValue={center}
      isGhost={utility.isGhost}
      color={ink}
      readout={utility.paramDisplay(index)}
      onInteraction={(v) => utility.sendParam(index, v)}
    />
  </div>
{/snippet}

{#snippet sw(index: number, label: string)}
  <button class="physical-button btn-toggle utility-switch" class:active={on(index)} aria-pressed={on(index)} use:press={{ onPress: () => toggle(index) }}>
    {label}
  </button>
{/snippet}

<div class="utility-layout" data-view="utility">
  <FaceGrid sections={[2, 1, 1]}>
  <FaceSection span={2}>
  {#snippet head()}<PanelEyebrow title="Stereo" color={ink.primary} />{/snippet}
  <div class="column" class:slot-ghost={utility.isGhost}>
    {@render knob(UTIL.width, 'Width', 0, 2, 1)}
    <div class="foot">{@render sw(UTIL.mono, 'Mono')}</div>
  </div>

  <div class="column" class:slot-ghost={utility.isGhost}>
    {@render knob(UTIL.balance, 'Balance', -1, 1, 0)}
    <div class="foot">
      {@render sw(UTIL.leftInv, 'Invert L')}
      {@render sw(UTIL.rightInv, 'Invert R')}
    </div>
  </div>
  </FaceSection>
  <FaceSeam ink={ink.primary} />

  <FaceSection span={1}>
  {#snippet head()}<PanelEyebrow title="Bass" color={ink.primary} />{/snippet}
  <div class="column" class:slot-ghost={utility.isGhost}>
    {@render knob(UTIL.bassFreq, 'Bass Freq', 0, 1)}
    <div class="foot">{@render sw(UTIL.bassMono, 'Bass Mono')}</div>
  </div>
  </FaceSection>
  <FaceSeam ink={ink.primary} />

  <FaceSection span={1}>
  {#snippet head()}<PanelEyebrow title="Channel" color={ink.primary} />{/snippet}
  <div class="column" class:slot-ghost={utility.isGhost}>
    <!-- One of four named settings: a tab, two by two. -->
    <div class="device-segmented seg-grid channel" role="radiogroup" aria-label="Channel">
      {#each CHANNEL_MODES as label, i (label)}
        <button
          class="device-segment utility-mode"
          class:active={channelMode === i}
          role="radio"
          aria-checked={channelMode === i}
          use:press={{ onPress: () => utility.sendParam(UTIL.channelMode, i) }}
        >
          {label}
        </button>
      {/each}
    </div>
    <div class="foot">
      {@render sw(UTIL.dcFilter, 'DC Filter')}
      {@render sw(UTIL.mute, 'Mute')}
    </div>
  </div>
  </FaceSection>
  </FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510): four equal columns, each what it
     sets over one touch row of switches at its foot. */
  .utility-layout {
    height: 100%;
    width: 100%;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: var(--face-gutter);
    min-width: 0;
    min-height: 0;
  }

  .knob,
  .channel {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
  }
  /* No wider than 6:5: the fit that picks a knob's size (`knobSizeFits`)
     reads a wider cell as one whose name stands beside the knob, and
     would step these down a size though their names stand under them. */
  .knob {
    display: flex;
    align-self: center;
    width: 100%;
    max-width: 12.5rem;
  }
  .knob > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }

  /* The channel tab: two rows of two. */
  .channel {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
  }
  .utility-mode {
    min-width: 0;
    min-height: 0;
    font-size: 0.9375rem;
    font-weight: 600;
  }

  /* The foot: one touch row, a switch or two side by side. */
  .foot {
    flex: 0 0 var(--height-touch);
    display: flex;
    gap: var(--face-gutter);
    min-width: 0;
  }
  .utility-switch {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    font-size: 0.9375rem;
    font-weight: 600;
  }

  /* Flat grammar: medium weight. ON and the label's colour are app.css's
     (ADR-544). */
  :global([data-grammar="flat"]) .utility-switch,
  :global([data-grammar="flat"]) .utility-mode {
    font-weight: var(--font-weight-medium);
  }
</style>
