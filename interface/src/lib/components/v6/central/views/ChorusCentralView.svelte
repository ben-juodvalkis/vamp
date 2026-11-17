<script lang="ts">
  /**
   * The Chorus's view (Live's Chorus-Ensemble, the `chorus` slot), its
   * panel left to right (2026-11-06; Mode and four boxes from 2026-10-26):
   *
   *   [Mode] | [Taps 1 | 2 over the delay Time] | [Amount] [FB Invert over
   *   Feedback] | [Width] [Warmth] | [High Pass over HP Freq] [Output]
   *
   * on one face grid (ADR-510), sections 1 · 1 · 2 · 2 · 2.
   *
   * Re-laid for Ink (ADR-544, 2026-11-17): the six amounts are six knobs
   * of one size on one line, a column each, large; a switch sits on the
   * touch row over the knob it switches. HP Freq and Output were two short
   * boxes whose names their fills cut, and neither is ridden: knobs. The
   * delay Time's six options are a tab the column's height (33px rows
   * before). Vibrato's Shape and Offset take the places of the two knobs
   * Vibrato has no use for, Feedback and Width, so no mode leaves a hole in
   * the line; Time and Taps, Chorus's alone, stay drawn and dim in the
   * other two modes, where they do nothing and take no touch.
   *
   * Rate and Dry/Wet are the chain cell's pad (the `chorus` control,
   * deviceControls, ADR-479), drawn above this view, so the view does not
   * draw the same pad again (user, 2026-11-06).
   *
   * Live 12 manual §29.8: Width belongs to Chorus and Ensemble, Shape and
   * Offset to Vibrato, Time and Taps to Chorus alone; Feedback is disabled
   * in Vibrato. Indices,
   * ranges and labels measured on the rig (device_dump, 2026-11-06): 1 Mode
   * 0..2 Chorus / Ensemble / Vibrato, 2 Shape, 4 Amount, 5 Feedback (99 %
   * at 1), 6 FB Invert, 7 Offset (0..180°), 8 Delay Time 0..5 (Auto, 7, 10,
   * 20, 35, 50 ms), 9 Delay Taps (0 = 1, 1 = 2), 10 HP On, 11 HP Freq
   * (20 Hz .. 2 kHz), 12 Width (0..200 %), 13 Warmth, 14 Output (0 dB at
   * 0.7071), all 0..1 but the steps. A ghost draws Live's values on a fresh
   * insert; its first write loads it.
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */
  import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import { press } from '$lib/actions/press';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

  const chorus = useFxGridSlot('chorus');

  const CHORUS = { mode: 1, shape: 2, amount: 4, feedback: 5, fbInvert: 6, offset: 7, delay: 8, taps: 9, hpOn: 10, hpFreq: 11, width: 12, warmth: 13, output: 14 } as const;
  const MODES = ['Chorus', 'Ensemble', 'Vibrato'] as const;
  const DELAYS = ['Auto', '7 ms', '10 ms', '20 ms', '35 ms', '50 ms'] as const;
  /** Live's Taps toggles, 1 | 2 (Delay Taps 0 | 1). */
  const TAPS = ['1', '2'] as const;
  /** Live's values on a fresh Chorus-Ensemble. */
  const REST: Record<number, number> = { [CHORUS.mode]: 0, [CHORUS.fbInvert]: 0, [CHORUS.delay]: 2, [CHORUS.taps]: 1, [CHORUS.hpOn]: 0 };

  const value = (index: number) => chorus.paramValue(index) ?? REST[index] ?? 0;
  const on = (index: number) => value(index) >= 0.5;
  const toggle = (index: number) => chorus.sendParam(index, on(index) ? 0 : 1);

  let mode = $derived(Math.round(value(CHORUS.mode)));
  let vibrato = $derived(mode === 2);
  type Knob = { index: number; title: string; rest: number };
  const AMOUNT: Knob = { index: CHORUS.amount, title: 'Amount', rest: 0.5 };
  const FEEDBACK: Knob = { index: CHORUS.feedback, title: 'Feedback', rest: 0 };
  const WIDTH: Knob = { index: CHORUS.width, title: 'Width', rest: 0.5 };
  const WARMTH: Knob = { index: CHORUS.warmth, title: 'Warmth', rest: 0 };
  const HP_FREQ: Knob = { index: CHORUS.hpFreq, title: 'HP Freq', rest: 0.2842 };
  const OUTPUT: Knob = { index: CHORUS.output, title: 'Output', rest: 0.7071 };
  /** Vibrato's own two, in the places of the two it has no use for. */
  const SHAPE: Knob = { index: CHORUS.shape, title: 'Shape', rest: 0 };
  const OFFSET: Knob = { index: CHORUS.offset, title: 'Offset', rest: 0 };
</script>

<!-- One of the six amounts: a large knob under the face's switch row,
     with its switch on that row when it has one. -->
{#snippet knobColumn(box: Knob, switchLabel?: string, switchIndex?: number)}
  <div class="cell">
    {#if switchLabel !== undefined && switchIndex !== undefined}
      <button
        class="physical-button btn-toggle fx-switch"
        class:active={on(switchIndex)}
        class:slot-ghost={chorus.isGhost}
        aria-pressed={on(switchIndex)}
        use:press={{ onPress: () => toggle(switchIndex) }}
      >{switchLabel}</button>
    {:else}
      <div class="switch-row" aria-hidden="true"></div>
    {/if}
    <div class="knob-cell" class:slot-ghost={chorus.isGhost}>
      {#key box.index}
        <DeviceSlider
          value={chorus.paramValue(box.index) ?? box.rest}
          title={box.title}
          face="knob"
          knobSize="l"
          knobFit
          knobCaptionBelow
          orientation="vertical"
          isGhost={chorus.isGhost}
          color={chorus.color}
          readout={chorus.paramDisplay(box.index)}
          onInteraction={(v) => chorus.sendParam(box.index, v)}
        />
      {/key}
    </div>
  </div>
{/snippet}

<!-- One face grid (ADR-510), eight columns of ~109px at 1366 x 1024:
     Mode 1 · Delay 1 · Depth 2 · Space 2 · Output 2. Two lines from the
     Delay on: a touch row (Taps, FB Invert, High Pass), then the controls. -->
<div class="face-root" data-view="chorus">
<FaceGrid sections={[1, 1, 2, 2, 2]}>
  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Mode" color={chorus.color.primary} />{/snippet}
    <ScrubTabs
      options={MODES}
      selected={mode}
      onSelect={(i) => chorus.sendParam(CHORUS.mode, i)}
      cols={1}
      ghost={chorus.isGhost}
      label={(m) => m}
      groupLabel="Mode"
      name="mode"
      style="--scrub-font-size: 0.9375rem;"
    />
  </FaceSection>
  <FaceSeam />

  <!-- Chorus's own delay line: Taps over Time. The other two modes have no
       use for it, so there it dims and is inert: no touch, no key. -->
  <FaceSection span={1} ghost={mode !== 0}>
    {#snippet head()}<PanelEyebrow title="Delay" color={chorus.color.primary} />{/snippet}
    <div class="cell" inert={mode !== 0}>
      <ScrubTabs
        options={TAPS}
        selected={Math.round(value(CHORUS.taps))}
        onSelect={(i) => chorus.sendParam(CHORUS.taps, i)}
        cols={2}
        ghost={chorus.isGhost}
        label={(t) => `${t} ${t === '1' ? 'tap' : 'taps'}`}
        groupLabel="Taps"
        name="taps"
        class="switch-row"
        style="--scrub-font-size: 0.8125rem; --scrub-padding: 0;"
      />
      <ScrubTabs
        options={DELAYS}
        selected={Math.round(value(CHORUS.delay))}
        onSelect={(i) => chorus.sendParam(CHORUS.delay, i)}
        cols={2}
        ghost={chorus.isGhost}
        label={(d) => `Delay ${d}`}
        groupLabel="Delay time"
        name="delay"
        style="flex: 1 1 0; min-height: 0; --scrub-font-size: 0.8125rem; --scrub-padding: 0;"
      >
        {#snippet item(d)}{d}{/snippet}
      </ScrubTabs>
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Depth" color={chorus.color.primary} />{/snippet}
    {@render knobColumn(AMOUNT)}
    {#if vibrato}
      {@render knobColumn(SHAPE)}
    {:else}
      {@render knobColumn(FEEDBACK, 'FB Invert', CHORUS.fbInvert)}
    {/if}
  </FaceSection>
  <FaceSeam />

  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Space" color={chorus.color.primary} />{/snippet}
    {@render knobColumn(vibrato ? OFFSET : WIDTH)}
    {@render knobColumn(WARMTH)}
  </FaceSection>
  <FaceSeam />

  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Output" color={chorus.color.primary} />{/snippet}
    {@render knobColumn(HP_FREQ, 'High Pass', CHORUS.hpOn)}
    {@render knobColumn(OUTPUT)}
  </FaceSection>
</FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510); a cell is how one column fills its height. */
  .face-root {
    height: 100%;
    width: 100%;
    min-height: 0;
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: var(--face-gutter);
    min-height: 0;
    min-width: 0;
  }

  /* The face's switch row: one touch row at the head of a column, empty
     over a knob that has no switch, so the six knobs stand on one line. */
  .switch-row,
  .cell > :global(.switch-row) {
    flex: 0 0 var(--height-touch);
    min-height: 0;
  }
  .fx-switch {
    flex: 0 0 var(--height-touch);
    min-height: 0;
    width: 100%;
    padding-inline: 2px;
    font-size: 0.875rem;
    font-weight: var(--font-weight-medium);
  }

  .knob-cell {
    flex: 1 1 0;
    display: flex;
    min-height: 0;
    min-width: 0;
  }
  .knob-cell > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
</style>
