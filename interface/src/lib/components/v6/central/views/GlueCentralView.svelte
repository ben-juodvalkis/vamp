<script lang="ts">
  import { press } from '$lib/actions/press';
  /**
   * GlueCentralView — the Glue Compressor's view (slot `squash`).
   *
   * Laid out as Live's own panel (the user, 2026-11-11, from a screenshot
   * of it), on the face grid (ADR-510), five columns:
   *
   *   SC Filter [switch, Type, Freq, Gain, Res] | [Attack, Release, Ratio]
   *   | Threshold  Makeup | [Soft Clip, Range, Dry/Wet]
   *
   * Attack, Release and Ratio are stepped knobs stacked as Live stacks
   * them, a detent per step. Threshold and Makeup are the two large knobs
   * in the middle, where Live has them under its gain-reduction meter (the
   * meter is not on the wire, so it is not drawn). The chain cell's
   * `SquashControl` moves those two together with one finger.
   *
   * Left out: Live's Sidechain column (External, Source, Mix, SC Gain). It
   * needs a source to listen to, and the surface carries the routing pair
   * for Compressor2 only, so it would land as a switch that does nothing.
   * The SC Filter works without it: it shapes what the detector hears.
   * Gain shows only on the filter types that have one, as in Live.
   *
   * Measured on the rig (device_dump on "3-Audio"'s Glue Compressor,
   * 2026-11-11), 17 parameters, LOM order with Device On at 0:
   *   1 Threshold -40..0 dB      2 Range 0..70 (Live's own dB curve)
   *   3 Output 0..20 dB (Makeup) 4 Attack 0..6 (.01 .1 .3 1 3 10 30 ms)
   *   5 Ratio 0..2 (2 4 10)      6 Release 0..6 (.1 .2 .4 .6 .8 1.2 s, A)
   *   7 Dry/Wet 0..1             8 Peak Clip In 0..1 (Soft Clip)
   *   12 S/C EQ Type 0..5 (Low Shelf, Bell, High Shelf, Low pass, Peak,
   *      High pass)              13 S/C EQ On 0..1
   *   14 S/C EQ Freq 0..1 (30 Hz..15 kHz)  15 S/C EQ Gain -15..15 dB
   *   16 S/C EQ Q 0..1 (0.10..12.0, Live's "Res")
   * Readouts are Live's own labels (`paramDisplay`). A ghost draws Live's
   * defaults, and its first write loads the device.
   *
   * Self-contained: queries its own slot state, takes no props, and
   * renders through ghost/loading/active without a `{#if device}` gate.
   */

  import ChoicePicker from '../ChoicePicker.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';

  // The disabled/idle scheme is the neutral utility family (deviceInk-safe greys).
  const IDLE_SCHEME = { primary: '#a2acb7', secondary: 'color-mix(in oklab, var(--signal-dim) 10%, transparent)', accent: '#bbc5d1' };

  const squash = useFxGridSlot('squash');

  const P = {
    threshold: 1, range: 2, output: 3, attack: 4, ratio: 5, release: 6, dryWet: 7, softClip: 8,
    eqType: 12, eqOn: 13, eqFreq: 14, eqGain: 15, eqQ: 16
  } as const;

  /** Live's values on a fresh Glue Compressor (the dump's defaults): what a ghost shows. */
  const REST: Record<number, number> = {
    1: 0, 2: 70, 3: 0, 4: 3, 5: 1, 6: 3, 7: 1, 8: 0,
    12: 5, 13: 0, 14: 0.3052678406238556, 15: 0, 16: 0.40856707096099854
  };
  const value = (index: number) => squash.paramValue(index) ?? REST[index];
  const step = (index: number) => Math.round(value(index));

  /** Attack, Release and Ratio: Live's steps, stacked as on its panel. */
  const STEPPED = [
    { index: P.attack, title: 'Attack', labels: ['0.01 ms', '0.1 ms', '0.3 ms', '1 ms', '3 ms', '10 ms', '30 ms'] },
    { index: P.release, title: 'Release', labels: ['0.1 s', '0.2 s', '0.4 s', '0.6 s', '0.8 s', '1.2 s', 'Auto'] },
    { index: P.ratio, title: 'Ratio', labels: ['2:1', '4:1', '10:1'] }
  ];
  const EQ_TYPES = ['Low Shelf', 'Bell', 'High Shelf', 'Low Pass', 'Peak', 'High Pass'];

  // ADR-400: these controls drive the Glue Compressor, so they wear its ink.
  let ink = $derived(squash.isGhost ? IDLE_SCHEME : squash.color);
  let eqOn = $derived(step(P.eqOn) === 1);
  let eqInk = $derived(squash.isGhost || !eqOn ? IDLE_SCHEME : squash.color);
  /** Live shows the filter's Gain only on the types that have one (not the two cuts). */
  let eqHasGain = $derived(![3, 5].includes(step(P.eqType)));

  const toggle = (index: number) => squash.sendParam(index, step(index) === 1 ? 0 : 1);
  /** A touch on the filter's controls while it is off turns it on, as a switched-off section does (ADR-487). */
  function sendEq(index: number, v: number) {
    if (!eqOn) squash.sendParam(P.eqOn, 1);
    squash.sendParam(index, v);
  }
  function sendStep(index: number, count: number, v: number) {
    squash.sendParam(index, Math.max(0, Math.min(count - 1, Math.round(v))));
  }
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states.
     `sendParam` is fire-and-forget on a ghost — it queues and triggers
     the load. -->
<div class="glue-central-layout relative" data-view="glue" style="--btn-tint: {ink.primary};">
<FaceGrid sections={[1, 1, 2, 1]}>
  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="SC Filter" color={ink.primary} />{/snippet}
    <div class="col" class:slot-ghost={squash.isGhost} data-glue-col="filter">
      <div class="pair">
        <button
          class="physical-button btn-toggle switch"
          class:active={!squash.isGhost && eqOn}
          aria-pressed={eqOn}
          use:press={{ onPress: () => toggle(P.eqOn) }}
        >On</button>
        <ChoicePicker
          options={EQ_TYPES}
          selected={step(P.eqType)}
          onSelect={(i) => sendEq(P.eqType, i)}
          label="SC Filter type"
          tint={ink.primary}
          ghost={squash.isGhost || !eqOn}
        />
      </div>
      <div class="knob">
        <DeviceSlider
          value={value(P.eqFreq)}
          title="Freq"
          face="knob"
          knobSize="m"
          knobFit
          orientation="vertical"
          min={0}
          max={1}
          isGhost={squash.isGhost || !eqOn}
          color={eqInk}
          readout={squash.paramDisplay(P.eqFreq)}
          onInteraction={(v) => sendEq(P.eqFreq, v)}
        />
      </div>
      {#if eqHasGain}
        <div class="knob">
          <DeviceSlider
            value={value(P.eqGain)}
            title="Gain"
            face="knob"
            knobSize="m"
            knobFit
            orientation="vertical"
            min={-15}
            max={15}
            isGhost={squash.isGhost || !eqOn}
            color={eqInk}
            readout={squash.paramDisplay(P.eqGain)}
            onInteraction={(v) => sendEq(P.eqGain, v)}
          />
        </div>
      {/if}
      <div class="knob">
        <DeviceSlider
          value={value(P.eqQ)}
          title="Res"
          face="knob"
          knobSize="m"
          knobFit
          orientation="vertical"
          min={0}
          max={1}
          isGhost={squash.isGhost || !eqOn}
          color={eqInk}
          readout={squash.paramDisplay(P.eqQ)}
          onInteraction={(v) => sendEq(P.eqQ, v)}
        />
      </div>
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Timing" color={ink.primary} />{/snippet}
    <div class="col" class:slot-ghost={squash.isGhost} data-glue-col="timing">
      {#each STEPPED as knob (knob.index)}
        <div class="knob">
          <DeviceSlider
            value={step(knob.index)}
            title={knob.title}
            valueText={knob.labels[step(knob.index)]}
            steps={knob.labels.length}
            face="knob"
            knobSize="m"
            knobFit
            orientation="vertical"
            min={0}
            max={knob.labels.length - 1}
            isGhost={squash.isGhost}
            color={ink}
            onInteraction={(v) => sendStep(knob.index, knob.labels.length, v)}
          />
        </div>
      {/each}
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Compressor" color={ink.primary} />{/snippet}
    <div class="col center" class:slot-ghost={squash.isGhost}>
      <div class="knob">
        <DeviceSlider
          value={value(P.threshold)}
          title="Threshold"
          face="knob"
          knobSize="xl"
          knobFit
          knobCaptionBelow
          orientation="vertical"
          min={-40}
          max={0}
          isGhost={squash.isGhost}
          color={ink}
          readout={squash.paramDisplay(P.threshold)}
          onTap={() => squash.loadIfGhost()}
          onInteraction={(v) => squash.sendParam(P.threshold, v)}
        />
      </div>
    </div>
    <div class="col center" class:slot-ghost={squash.isGhost}>
      <div class="knob">
        <DeviceSlider
          value={value(P.output)}
          title="Makeup"
          face="knob"
          knobSize="xl"
          knobFit
          knobCaptionBelow
          orientation="vertical"
          min={0}
          max={20}
          isGhost={squash.isGhost}
          color={ink}
          readout={squash.paramDisplay(P.output)}
          onTap={() => squash.loadIfGhost()}
          onInteraction={(v) => squash.sendParam(P.output, v)}
        />
      </div>
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Clip" color={ink.primary} />{/snippet}
    <div class="col" class:slot-ghost={squash.isGhost} data-glue-col="output">
      <button
        class="physical-button btn-toggle switch"
        class:active={!squash.isGhost && step(P.softClip) === 1}
        aria-pressed={step(P.softClip) === 1}
        use:press={{ onPress: () => toggle(P.softClip) }}
      >Soft</button>
      <div class="knob">
        <DeviceSlider
          value={value(P.range)}
          title="Range"
          face="knob"
          knobSize="m"
          knobFit
          orientation="vertical"
          min={0}
          max={70}
          isGhost={squash.isGhost}
          color={ink}
          readout={squash.paramDisplay(P.range)}
          onInteraction={(v) => squash.sendParam(P.range, v)}
        />
      </div>
      <div class="knob">
        <DeviceSlider
          value={value(P.dryWet)}
          title="Dry/Wet"
          face="knob"
          knobSize="m"
          knobFit
          orientation="vertical"
          min={0}
          max={1}
          isGhost={squash.isGhost}
          color={ink}
          readout={squash.paramDisplay(P.dryWet)}
          onInteraction={(v) => squash.sendParam(P.dryWet, v)}
        />
      </div>
    </div>
  </FaceSection>
</FaceGrid>
</div>

<style>
  /* Live's panel, left to right: SC Filter | Attack, Release, Ratio |
     Threshold, Makeup | Clip, Range, Dry/Wet. Five equal columns on the
     FaceGrid (ADR-510), the middle two. */
  .glue-central-layout {
    height: 100%;
    width: 100%;
    min-height: 0;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: var(--face-gutter);
    min-width: 0;
    min-height: 0;
  }
  .col > :global(*) {
    min-height: 0;
  }
  .knob {
    flex: 1 1 0;
    min-height: 0;
  }
  .center {
    justify-content: center;
  }

  /* The filter's switch and type on one touch row. */
  .pair {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--face-gutter);
    align-items: stretch;
  }
  .switch {
    flex: 0 0 var(--height-touch);
    min-height: var(--height-touch);
    padding-inline: var(--spacing-sm);
    font-size: 1rem;
    font-weight: 600;
  }

  :global([data-grammar="flat"]) .switch {
    font-weight: var(--font-weight-medium);
  }
  :global([data-grammar="flat"]) .switch.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }
</style>
