<script lang="ts">
  import { press } from '$lib/actions/press';
  /**
   * GlueCentralView — the Glue Compressor's view (slot `squash`).
   *
   * The whole device but its external sidechain (the user, 2026-11-11:
   * "put the rest of the controls in"), on the face grid (ADR-510), eight
   * columns in Live's own panel order:
   *
   *   Compressor [Threshold] [Ratio / Range] | Attack | Release |
   *   Output [Makeup, Dry/Wet, Soft Clip] | S/C EQ [On, type, Freq] [Gain, Q]
   *
   * The chain cell's `SquashControl` is one finger over threshold+makeup
   * together, the performance gesture; this view sets each outright. Ratio,
   * Attack and Release are pick-one tabs (Live's own steps), Range, Makeup,
   * Dry/Wet and the EQ's amounts knobs, Soft Clip and EQ switches.
   *
   * Left out: the external sidechain (S/C On, its Gain and Mix). It needs
   * a source to listen to, and the surface carries the routing pair for
   * Compressor2 only, so it would land as a switch that does nothing. The
   * S/C EQ works without it: it shapes what the Glue's own detector hears.
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
   *   16 S/C EQ Q 0..1 (0.10..12.0)
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

  const RATIOS = ['2:1', '4:1', '10:1'];
  const ATTACKS = ['0.01', '0.1', '0.3', '1', '3', '10', '30'];
  const RELEASES = ['0.1', '0.2', '0.4', '0.6', '0.8', '1.2', 'Auto'];
  const EQ_TYPES = ['Low Shelf', 'Bell', 'High Shelf', 'Low Pass', 'Peak', 'High Pass'];

  // ADR-400: these controls drive the Glue Compressor, so they wear its ink.
  let ink = $derived(squash.isGhost ? IDLE_SCHEME : squash.color);
  let eqOn = $derived(step(P.eqOn) === 1);
  /** Live greys the EQ's Gain on the two cut filters, which have none. */
  let eqHasGain = $derived(![3, 5].includes(step(P.eqType)));

  const toggle = (index: number) => squash.sendParam(index, step(index) === 1 ? 0 : 1);
  /** A touch on the EQ's controls while it is off turns it on, as a switched-off section does (ADR-487). */
  function sendEq(index: number, v: number) {
    if (!eqOn) squash.sendParam(P.eqOn, 1);
    squash.sendParam(index, v);
  }
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states.
     `sendParam` is fire-and-forget on a ghost — it queues and triggers
     the load. -->
<div class="glue-central-layout relative" data-view="glue" style="--btn-tint: {ink.primary};">
<FaceGrid sections={[2, 1, 1, 1, 2]}>
  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Compressor" color={ink.primary} />{/snippet}
    <!-- Live's own direction: up is a higher threshold, i.e. less
         squash — the opposite of the chain cell, whose up is MORE. -->
    <div class="col" class:slot-ghost={squash.isGhost}>
      <DeviceSlider
        value={value(P.threshold)}
        title="Threshold"
        icon="threshold"
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
    <div class="col" class:slot-ghost={squash.isGhost}>
      <div class="tabs short device-segmented seg-grid" role="radiogroup" aria-label="Ratio">
        {#each RATIOS as label, i (label)}
          <button
            class="device-segment tab"
            class:active={!squash.isGhost && step(P.ratio) === i}
            role="radio"
            aria-checked={step(P.ratio) === i}
            use:press={{ onPress: () => squash.sendParam(P.ratio, i) }}
          >{label}</button>
        {/each}
      </div>
      <div class="knob">
        <DeviceSlider
          value={value(P.range)}
          title="Range"
          face="knob"
          knobSize="m"
          orientation="vertical"
          min={0}
          max={70}
          isGhost={squash.isGhost}
          color={ink}
          readout={squash.paramDisplay(P.range)}
          onInteraction={(v) => squash.sendParam(P.range, v)}
        />
      </div>
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Attack ms" color={ink.primary} />{/snippet}
    <div class="col" class:slot-ghost={squash.isGhost}>
      <div class="tabs device-segmented seg-grid" role="radiogroup" aria-label="Attack">
        {#each ATTACKS as label, i (label)}
          <button
            class="device-segment tab"
            class:active={!squash.isGhost && step(P.attack) === i}
            role="radio"
            aria-checked={step(P.attack) === i}
            use:press={{ onPress: () => squash.sendParam(P.attack, i) }}
          >{label}</button>
        {/each}
      </div>
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Release s" color={ink.primary} />{/snippet}
    <div class="col" class:slot-ghost={squash.isGhost}>
      <div class="tabs device-segmented seg-grid" role="radiogroup" aria-label="Release">
        {#each RELEASES as label, i (label)}
          <button
            class="device-segment tab"
            class:active={!squash.isGhost && step(P.release) === i}
            role="radio"
            aria-checked={step(P.release) === i}
            use:press={{ onPress: () => squash.sendParam(P.release, i) }}
          >{label}</button>
        {/each}
      </div>
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Output" color={ink.primary} />{/snippet}
    <div class="col" class:slot-ghost={squash.isGhost}>
      <div class="knob">
        <DeviceSlider
          value={value(P.output)}
          title="Makeup"
          face="knob"
          knobSize="m"
          icon="output"
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
      <div class="knob">
        <DeviceSlider
          value={value(P.dryWet)}
          title="Dry/Wet"
          face="knob"
          knobSize="m"
          orientation="vertical"
          min={0}
          max={1}
          isGhost={squash.isGhost}
          color={ink}
          readout={squash.paramDisplay(P.dryWet)}
          onInteraction={(v) => squash.sendParam(P.dryWet, v)}
        />
      </div>
      <button
        class="physical-button btn-toggle switch"
        class:active={!squash.isGhost && step(P.softClip) === 1}
        aria-pressed={step(P.softClip) === 1}
        use:press={{ onPress: () => toggle(P.softClip) }}
      >Soft Clip</button>
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Sidechain EQ" color={ink.primary} />{/snippet}
    <div class="col" class:slot-ghost={squash.isGhost}>
      <button
        class="physical-button btn-toggle switch"
        class:active={!squash.isGhost && eqOn}
        aria-pressed={eqOn}
        use:press={{ onPress: () => toggle(P.eqOn) }}
      >EQ</button>
      <ChoicePicker
        options={EQ_TYPES}
        selected={step(P.eqType)}
        onSelect={(i) => sendEq(P.eqType, i)}
        label="Sidechain EQ type"
        tint={ink.primary}
        ghost={squash.isGhost || !eqOn}
      />
      <div class="knob">
        <DeviceSlider
          value={value(P.eqFreq)}
          title="Freq"
          face="knob"
          knobSize="m"
          icon="cutoff"
          orientation="vertical"
          min={0}
          max={1}
          isGhost={squash.isGhost || !eqOn}
          color={squash.isGhost || !eqOn ? IDLE_SCHEME : ink}
          readout={squash.paramDisplay(P.eqFreq)}
          onInteraction={(v) => sendEq(P.eqFreq, v)}
        />
      </div>
    </div>
    <div class="col" class:slot-ghost={squash.isGhost}>
      <div class="knob">
        <DeviceSlider
          value={value(P.eqGain)}
          title="Gain"
          face="knob"
          knobSize="m"
          orientation="vertical"
          min={-15}
          max={15}
          isGhost={squash.isGhost || !eqOn || !eqHasGain}
          color={squash.isGhost || !eqOn || !eqHasGain ? IDLE_SCHEME : ink}
          readout={squash.paramDisplay(P.eqGain)}
          onInteraction={(v) => sendEq(P.eqGain, v)}
        />
      </div>
      <div class="knob">
        <DeviceSlider
          value={value(P.eqQ)}
          title="Q"
          face="knob"
          knobSize="m"
          orientation="vertical"
          min={0}
          max={1}
          isGhost={squash.isGhost || !eqOn}
          color={squash.isGhost || !eqOn ? IDLE_SCHEME : ink}
          readout={squash.paramDisplay(P.eqQ)}
          onInteraction={(v) => sendEq(P.eqQ, v)}
        />
      </div>
    </div>
  </FaceSection>
</FaceGrid>
</div>

<style>
  /* Compressor 2 | Attack | Release | Output | Sidechain EQ 2, on the
     FaceGrid (ADR-510): eight equal columns. */
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

  .tabs {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  /* Ratio's three over Range: the tabs take as much as the knob. */
  .tabs.short {
    flex: 1 1 0;
  }
  .tab {
    flex: 1;
    min-height: 0;
    font-size: 1rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .switch {
    flex: 0 0 var(--height-touch);
    font-size: 1rem;
    font-weight: 600;
  }

  /* As the Random view's tabs: the name in the device ink, the lit one filled with it. */
  :global([data-skin="hybrid"]) .tab {
    color: var(--btn-tint);
  }
  :global(.light[data-skin="hybrid"]) .tab {
    color: color-mix(in oklab, var(--btn-tint) 55%, var(--foreground));
  }
  :global([data-grammar="flat"]) .tab,
  :global([data-grammar="flat"]) .switch {
    font-weight: var(--font-weight-medium);
  }
  :global([data-grammar="flat"]) .tab.active,
  :global([data-grammar="flat"]) .switch.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }
</style>
