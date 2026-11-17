<script lang="ts">
  import { press } from '$lib/actions/press';
  /**
   * GlueCentralView — the Glue Compressor's view (slot `squash`).
   *
   * Laid out as Live's own panel (the user, 2026-11-11, from a screenshot
   * of it), on the face grid (ADR-510), eleven columns, sections
   * 3 · 2 · 4 · 2, two rows:
   *
   *   SC Filter [Freq · Res · Gain] | Timing [Attack · Release] | Compressor            | Output [Range · Dry/Wet]
   *             [On · Type      ]          [Ratio 2 · 4 · 10 ]   Threshold    Makeup            [Soft Clip     ]
   *
   * Live's four columns in Live's order. Two tiers (ADR-544: knobs that
   * sit together are one size): Threshold and Makeup, the pair that is
   * played, are the two largest knobs the band holds, in the middle under
   * the gain-reduction meter, as in Live; every other knob is medium with
   * its name under it, all seven on one line, and every switch and pick
   * on the line under them, each under the knobs it belongs to (a switch
   * at a column's foot, as the Limiter's and the Utility's are). (Until
   * the rollout the side columns stacked three knobs each at whatever
   * size their cells left, three sizes on one face, names beside some and
   * under others.) Attack and Release are stepped knobs, a detent per step
   * and the step's value under the name; Ratio's three steps are a tab,
   * one touch row under them, as Live has it (a stepped knob until the
   * rollout; a pick writes the same 0 · 1 · 2).
   *
   * Live puts the reduction on no wire, so Vamp for Mac reads Live's own
   * needle and the meter shows it while the `liveMeters` switch is on
   * (ADR-541). The chain cell's `SquashControl` moves Threshold and Makeup
   * together with one finger.
   *
   * Left out: Live's Sidechain column (External, Source, Mix, SC Gain). It
   * needs a source to listen to, and the surface carries the routing pair
   * for Compressor2 only, so it would land as a switch that does nothing.
   * The SC Filter works without it: it shapes what the detector hears.
   * Gain shows only on the filter types that have one, as in Live; it
   * stands last in its row, so Freq and Res never move.
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
  import ScrubTabs from '../../device-panel/ScrubTabs.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import ReductionMeter from './panel/ReductionMeter.svelte';

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

  /** Attack and Release: Live's steps, a detent each. */
  const STEPPED = [
    { index: P.attack, title: 'Attack', labels: ['0.01 ms', '0.1 ms', '0.3 ms', '1 ms', '3 ms', '10 ms', '30 ms'] },
    { index: P.release, title: 'Release', labels: ['0.1 s', '0.2 s', '0.4 s', '0.6 s', '0.8 s', '1.2 s', 'Auto'] }
  ];
  /** Ratio's three steps, Live's labels: a tab. */
  const RATIOS = ['2:1', '4:1', '10:1'];
  const EQ_TYPES = ['Low Shelf', 'Bell', 'High Shelf', 'Low Pass', 'Peak', 'High Pass'];

  // One ink (ADR-544): the selected track's, as the slot hands it over. A
  // ghost, or the filter while it is off, dims (`isGhost`); it does not
  // change colour (a grey scheme of its own until the rollout).
  let ink = $derived(squash.color);
  let eqOn = $derived(step(P.eqOn) === 1);
  let eqOff = $derived(squash.isGhost || !eqOn);
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

<!-- A second-tier knob in its cell: medium, its name under it. -->
{#snippet knob(index: number, title: string, min: number, max: number, off: boolean, send: (v: number) => void)}
  <div class="knob">
    <DeviceSlider
      value={value(index)}
      {title}
      face="knob"
      knobSize="m"
      knobFit
      orientation="vertical"
      {min}
      {max}
      isGhost={off}
      color={ink}
      readout={squash.paramDisplay(index)}
      onInteraction={send}
    />
  </div>
{/snippet}

<!-- NO {#if device} gate - always render, handle ghost/loading states.
     `sendParam` is fire-and-forget on a ghost — it queues and triggers
     the load. One face grid (ADR-510), eleven columns of ~82px at
     1366 x 1024. -->
<div class="glue-central-layout relative" data-view="glue">
<FaceGrid sections={[3, 2, 4, 2]}>
  <FaceSection span={3}>
    {#snippet head()}<PanelEyebrow title="SC Filter" color={ink.primary} />{/snippet}
    <div class="rows face-span-all" class:slot-ghost={squash.isGhost} data-glue-col="filter">
      {@render knob(P.eqFreq, 'Freq', 0, 1, eqOff, (v) => sendEq(P.eqFreq, v))}
      {@render knob(P.eqQ, 'Res', 0, 1, eqOff, (v) => sendEq(P.eqQ, v))}
      {#if eqHasGain}
        {@render knob(P.eqGain, 'Gain', -15, 15, eqOff, (v) => sendEq(P.eqGain, v))}
      {:else}
        <!-- No Gain on a cut: its cell stays, so Freq and Res never move. -->
        <div></div>
      {/if}
      <!-- The filter's switch, then its type across two columns: one touch row. -->
      <div class="row-cell">
        <button
          class="physical-button btn-toggle switch"
          class:active={!squash.isGhost && eqOn}
          aria-pressed={eqOn}
          use:press={{ onPress: () => toggle(P.eqOn) }}
        >On</button>
      </div>
      <div class="row-cell span-2">
        <ChoicePicker
          options={EQ_TYPES}
          selected={step(P.eqType)}
          onSelect={(i) => sendEq(P.eqType, i)}
          label="SC Filter type"
          tint={ink.primary}
          ghost={eqOff}
        />
      </div>
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Timing" color={ink.primary} />{/snippet}
    <div class="rows face-span-all" class:slot-ghost={squash.isGhost} data-glue-col="timing">
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
      <!-- Ratio is three named settings, so it is a tab, not a stepped
           knob (ADR-544): its name over one touch row. -->
      <div class="row-cell span-2 named-tab">
        <span class="tab-name">Ratio</span>
        <ScrubTabs
          options={RATIOS}
          selected={step(P.ratio)}
          onSelect={(i) => sendStep(P.ratio, RATIOS.length, i)}
          cols={RATIOS.length}
          ghost={squash.isGhost}
          label={(option) => `Ratio ${option}`}
          groupLabel="Ratio"
          name="ratio"
          style="--scrub-font-size: 0.9375rem;"
        >
          {#snippet item(option)}{option}{/snippet}
        </ScrubTabs>
      </div>
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={4}>
    {#snippet head()}<PanelEyebrow title="Compressor" color={ink.primary} />{/snippet}
    <div class="face-span-all comp">
      <ReductionMeter devicePath={squash.isGhost ? undefined : squash.devicePath} color={ink.primary} />
      <div class="comp-knobs" class:slot-ghost={squash.isGhost}>
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
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Output" color={ink.primary} />{/snippet}
    <div class="rows face-span-all" class:slot-ghost={squash.isGhost} data-glue-col="output">
      {@render knob(P.range, 'Range', 0, 70, squash.isGhost, (v) => squash.sendParam(P.range, v))}
      {@render knob(P.dryWet, 'Dry/Wet', 0, 1, squash.isGhost, (v) => squash.sendParam(P.dryWet, v))}
      <div class="row-cell span-2">
        <button
          class="physical-button btn-toggle switch"
          class:active={!squash.isGhost && step(P.softClip) === 1}
          aria-pressed={step(P.softClip) === 1}
          use:press={{ onPress: () => toggle(P.softClip) }}
        >Soft Clip</button>
      </div>
    </div>
  </FaceSection>
</FaceGrid>
</div>

<style>
  /* Live's panel, left to right: SC Filter | Attack, Release, Ratio |
     Threshold, Makeup | Soft Clip, Range, Dry/Wet, on the FaceGrid
     (ADR-510). */
  .glue-central-layout {
    height: 100%;
    width: 100%;
    min-height: 0;
  }

  /* A side section: two rows on the face's own columns, a knob or a touch
     row a cell. */
  .rows {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: repeat(2, minmax(0, 1fr));
    row-gap: var(--face-gutter);
    min-width: 0;
    min-height: 0;
  }
  .knob {
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .knob > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
  /* A switch, a picker or a tab in a knob's cell: one touch row, centred. */
  .row-cell {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    min-height: 0;
    --picker-h: var(--height-touch);
  }
  .span-2 {
    grid-column: span 2;
  }
  .switch {
    flex: 0 0 var(--height-touch);
    min-width: 0;
    min-height: var(--height-touch);
    padding-inline: var(--spacing-xs);
    font-size: 0.9375rem;
    font-weight: 600;
  }
  /* A tab under its name. The tab is the cell's touch row, centred as the
     switches in the cells beside it are; its name stands over it, out of
     the flow. */
  .named-tab {
    position: relative;
  }
  .named-tab > :global(.scrub-tabs) {
    flex: 0 0 var(--height-touch);
  }
  .tab-name {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(50% + var(--height-touch) / 2 + 0.375rem);
    text-align: center;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.2;
    color: var(--label);
  }

  /* The Compressor section: the gain-reduction meter across its columns,
     Threshold and Makeup under it (ADR-541), each over two columns. */
  .comp {
    display: flex;
    flex-direction: column;
    gap: var(--face-gutter);
    min-height: 0;
  }
  .comp-knobs {
    flex: 1 1 0;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--face-gutter);
  }

  /* Flat grammar: medium weight. ON and the label's colour are app.css's
     (ADR-544). */
  :global([data-grammar="flat"]) .switch {
    font-weight: var(--font-weight-medium);
  }
</style>
