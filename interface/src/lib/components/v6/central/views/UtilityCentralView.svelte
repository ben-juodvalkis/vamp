<script lang="ts">
  import { press } from '$lib/actions/press';
  /**
   * UtilityCentralView — the Utility's view (slot `utility`, StereoGain).
   *
   *   Stereo [Width] [Balance] [Bass Freq] | Channel | Switches
   *
   * On the face grid (ADR-510), sections [3, 1, 1]: five columns of about
   * 177px, one large knob to a column.
   *
   * No Gain: it is the Utility's chain cell (the `utility` control,
   * `deviceControls`), always beside this view (the user, 2026-11-05).
   * Value boxes (ADR-477), a four-way channel picker and switches, Live's own parameters as measured on the rig (2026-11-05,
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
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
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

  let ink = $derived({
    primary: trackInk(utility.color.primary, paintModeReactive()),
    secondary: utility.color.secondary,
    accent: trackInk(utility.color.accent, paintModeReactive())
  });

  const value = (index: number) => utility.paramValue(index) ?? REST[index];
  const on = (index: number) => value(index) >= 0.5;
  const toggle = (index: number) => utility.sendParam(index, on(index) ? 0 : 1);

  const CHANNEL_MODES = ['Left', 'Stereo', 'Right', 'Swap'];
  const channelMode = $derived(Math.round(value(UTIL.channelMode)));

  /** Rows of switches; the two phase inverts share one, so five rows fit the band at the touch floor. */
  const SWITCH_ROWS = [
    [{ index: UTIL.mono, label: 'Mono' }],
    [{ index: UTIL.bassMono, label: 'Bass Mono' }],
    [{ index: UTIL.leftInv, label: 'Invert L' }, { index: UTIL.rightInv, label: 'Invert R' }],
    [{ index: UTIL.dcFilter, label: 'DC Filter' }],
    [{ index: UTIL.mute, label: 'Mute' }]
  ];
</script>

<div class="utility-layout" data-view="utility" style="--btn-tint: {ink.primary};">
  <FaceGrid sections={[3, 1, 1]}>
  <FaceSection span={3}>
  {#snippet head()}<PanelEyebrow title="Stereo" color={ink.primary} />{/snippet}
  <div class="column" class:slot-ghost={utility.isGhost}>
    <DeviceSlider
      value={value(UTIL.width)}
      title="Width"
      face="knob"
      knobSize="l"
      orientation="vertical"
      min={0}
      max={2}
      centerOrigin
      centerValue={1}
      isGhost={utility.isGhost}
      color={ink}
      readout={utility.paramDisplay(UTIL.width)}
      onInteraction={(v) => utility.sendParam(UTIL.width, v)}
    />
  </div>

  <div class="column" class:slot-ghost={utility.isGhost}>
    <DeviceSlider
      value={value(UTIL.balance)}
      title="Balance"
      face="knob"
      knobSize="l"
      orientation="horizontal"
      min={-1}
      max={1}
      centerOrigin
      centerValue={0}
      isGhost={utility.isGhost}
      color={ink}
      readout={utility.paramDisplay(UTIL.balance)}
      onInteraction={(v) => utility.sendParam(UTIL.balance, v)}
    />
  </div>

  <div class="column" class:slot-ghost={utility.isGhost}>
    <DeviceSlider
      value={value(UTIL.bassFreq)}
      title="Bass Freq"
      face="knob"
      knobSize="l"
      orientation="vertical"
      min={0}
      max={1}
      isGhost={utility.isGhost}
      color={ink}
      readout={utility.paramDisplay(UTIL.bassFreq)}
      onInteraction={(v) => utility.sendParam(UTIL.bassFreq, v)}
    />
  </div>

  </FaceSection>
  <FaceSeam ink={ink.primary} />

  <FaceSection span={1}>
  {#snippet head()}<PanelEyebrow title="Channel" color={ink.primary} />{/snippet}
  <div class="column channel" class:slot-ghost={utility.isGhost} role="radiogroup" aria-label="Channel">
    {#each CHANNEL_MODES as label, i (label)}
      <button
        class="physical-button btn-toggle utility-switch"
        class:active={channelMode === i}
        role="radio"
        aria-checked={channelMode === i}
        use:press={{ onPress: () => utility.sendParam(UTIL.channelMode, i) }}
      >
        {label}
      </button>
    {/each}
  </div>

  </FaceSection>
  <FaceSeam ink={ink.primary} />

  <FaceSection span={1}>
  {#snippet head()}<PanelEyebrow title="Switches" color={ink.primary} />{/snippet}
  <div class="column switches" class:slot-ghost={utility.isGhost}>
    {#each SWITCH_ROWS as row, r (r)}
      <div class="switch-row">
        {#each row as s (s.index)}
          <button class="physical-button btn-toggle utility-switch" class:active={on(s.index)} aria-pressed={on(s.index)} use:press={{ onPress: () => toggle(s.index) }}>
            {s.label}
          </button>
        {/each}
      </div>
    {/each}
  </div>
  </FaceSection>
  </FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510): five equal columns, three knobs,
     the channel picker, the switches. A column's rows are a gutter apart,
     so five switch rows keep the touch floor in the band (5 x 44 + 4 x 8). */
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

  .column > :global(*) {
    flex: 1 1 0;
    min-height: 0;
  }

  .switch-row {
    display: flex;
    gap: var(--face-gutter);
  }

  .switch-row > .utility-switch {
    flex: 1 1 0;
    min-width: 0;
  }

  .utility-switch {
    min-height: var(--height-touch);
    font-size: 1rem;
    font-weight: 600;
  }

  /* Flat grammar: medium weight, and the device's own ink when on (as
     Redux's switches), not the house ON color beside its faders. */
  :global([data-grammar="flat"]) .utility-switch {
    font-weight: var(--font-weight-medium);
  }
  :global([data-grammar="flat"]) .utility-switch.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }
  :global([data-grammar="flat"]) .utility-switch:not(.active) {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
</style>
