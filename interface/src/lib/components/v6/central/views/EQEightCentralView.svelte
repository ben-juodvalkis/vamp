<script lang="ts">
  /**
   * EQ Eight (the `eq8` slot, 2026-11-06), Live's panel (manual §29.15):
   *
   *   EQ [the curve, a dot per band / Band 1-8]
   *   | Band N [Type] [Freq · Gain / Q · On]
   *   | Global [Output · Scale / Adaptive Q]
   *
   * on one face grid (ADR-510), ten columns, sections 4 · 4 · 2.
   *
   * Live's per-band choosers and switches under its display become one
   * band picker under the curve, as Live has them, and one type tab and
   * one On switch for the band selected, so each stays a touch target: the
   * band picker one touch row of eight, the types two columns of four, the
   * lows on the left and the highs on the right, as the curve runs.
   * (Until ADR-544's rollout the picker and the types were two small-rowed
   * lists side by side, eight types in a column of 26px rows, and the
   * band's knobs three captionless letters.)
   *
   * Every amount beside the curve is a knob of one size with its whole
   * name (ADR-517, ADR-544): the band's Freq, Gain and Q, and the device's
   * Output and Scale, set and left (value boxes until then, their names cut
   * by their own fills). A switch sits in a knob's cell on the same grid.
   *
   * The curve is every band that is on, in series (`eq8Params.eq8Db`), on
   * the device's own 10 Hz - 22 kHz sweep, so a dot's X is its Frequency
   * parameter, over a frequency and dB scale (`eq/GraphScale`). A press
   * grabs the nearest dot and selects its band, which the controls beside
   * then edit. Up and down is the gain for a shelf or a bell, as in Live;
   * for the cuts and the notch, which have none, it is the Q (Live's
   * Alt-drag), so a finger reaches it. The app edits each band's A half
   * (Live's Stereo mode).
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */
  import FilterDotsGraph, { type GraphDot } from '$lib/components/v6/central/FilterDotsGraph.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';
  import GraphScale from './eq/GraphScale.svelte';
  import ParamSwitch from './fx/ParamSwitch.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { axisHz, responsePath } from '$lib/utils/filterGraph';
  import {
    EQ8,
    EQ8_BANDS,
    EQ8_FREQ_RANGE,
    EQ8_GAIN_MAX,
    EQ8_REST,
    EQ8_TYPES,
    eq8Band,
    eq8Db,
    eq8HasGain,
    type Eq8BandState
  } from '$lib/components/v6/device-panel/eq8Params';

  const fx = useFxGridSlot('eq8');

  /** The graph's dB span from its middle to its edge (`filterGraph`). */
  const GRAPH_DB = 24;
  const BAND_NUMBERS = Array.from({ length: EQ8_BANDS }, (_, i) => i + 1);
  const FREQS = Array.from({ length: 121 }, (_, i) => axisHz(EQ8_FREQ_RANGE, i / 120));
  /**
   * The types as the tab lays them, row by row: each low response beside
   * its high twin, the bell beside the notch. Each entry is Live's type
   * value, which is what a pick writes.
   */
  const TYPE_ORDER = [0, 7, 1, 6, 2, 5, 3, 4] as const;

  let selected = $state(3);

  function bandState(b: number): Eq8BandState {
    const p = eq8Band(b);
    return {
      on: (fx.paramValue(p.on) ?? EQ8_REST.on[b - 1]) >= 0.5,
      type: Math.round(fx.paramValue(p.type) ?? EQ8_REST.type[b - 1]),
      freq: fx.paramValue(p.freq) ?? EQ8_REST.freq[b - 1],
      gain: fx.paramValue(p.gain) ?? EQ8_REST.gain,
      q: fx.paramValue(p.q) ?? EQ8_REST.q
    };
  }

  let bands = $derived(BAND_NUMBERS.map(bandState));
  let curves = $derived([{ d: responsePath(eq8Db(bands, FREQS)), color: fx.color.primary }]);
  let dots = $derived<GraphDot[]>(
    bands.map((band, i) => ({
      label: String(i + 1),
      x: band.freq,
      y: eq8HasGain(band.type) ? 0.5 + band.gain / (2 * GRAPH_DB) : band.q,
      color: fx.color.primary,
      on: band.on,
      filled: i + 1 === selected
    }))
  );

  function move(i: number, x: number, y: number) {
    const p = eq8Band(i + 1);
    fx.sendParam(p.freq, x);
    if (eq8HasGain(bands[i].type)) {
      fx.sendParam(p.gain, Math.max(-EQ8_GAIN_MAX, Math.min(EQ8_GAIN_MAX, (y - 0.5) * 2 * GRAPH_DB)));
    } else {
      fx.sendParam(p.q, y);
    }
  }

  /** A knob on one parameter by LOM index, in its own range; a ghost draws `rest`. */
  interface Knob {
    index: number;
    title: string;
    rest: number;
    min?: number;
    max?: number;
    /** The neutral value a ± parameter's arc grows from. */
    center?: number;
  }

  let band = $derived(eq8Band(selected));
  let selectedState = $derived(bands[selected - 1]);
  let freqKnob = $derived<Knob>({ index: band.freq, title: 'Freq', rest: EQ8_REST.freq[selected - 1] });
  let gainKnob = $derived<Knob>({ index: band.gain, title: 'Gain', rest: 0, min: -EQ8_GAIN_MAX, max: EQ8_GAIN_MAX, center: 0 });
  let qKnob = $derived<Knob>({ index: band.q, title: 'Q', rest: EQ8_REST.q });
  const OUTPUT: Knob = { index: EQ8.output, title: 'Output', rest: 0, min: -12, max: 12, center: 0 };
  const SCALE: Knob = { index: EQ8.scale, title: 'Scale', rest: 1, min: -2, max: 2, center: 0 };
  let adaptiveQ = $derived((fx.paramValue(EQ8.adaptiveQ) ?? 1) >= 0.5);
</script>

<!-- One knob in its cell, in its parameter's own range: every knob on the
     face is this size (ADR-544). -->
{#snippet knob(k: Knob)}
  <div class="knob-cell">
    <DeviceSlider
      value={fx.paramValue(k.index) ?? k.rest}
      title={k.title}
      face="knob"
      knobSize="m"
      knobFit
      orientation="vertical"
      min={k.min ?? 0}
      max={k.max ?? 1}
      centerOrigin={k.center !== undefined}
      centerValue={k.center}
      isGhost={fx.isGhost}
      color={fx.color}
      readout={fx.paramDisplay(k.index)}
      onInteraction={(v) => fx.sendParam(k.index, v)}
    />
  </div>
{/snippet}

<!-- One face grid (ADR-510), ten columns of ~91px at 1366 x 1024: the
     curve over its band picker 4 · the band's type and knobs 4 · Global 2. -->
<div class="face-root" data-view="eq8">
<FaceGrid sections={[4, 4, 2]}>
  <FaceSection span={4}>
    {#snippet head()}<PanelEyebrow title="EQ" color={fx.color.primary} />{/snippet}
    <div class="cell face-span-all">
      <div class="graph" class:slot-ghost={fx.isGhost}>
        <GraphScale axis={EQ8_FREQ_RANGE} span={GRAPH_DB}>
          <FilterDotsGraph {dots} {curves} onGrab={(i) => (selected = i + 1)} onMove={move} ariaLabel="EQ Eight bands" />
        </GraphScale>
      </div>
      <!-- The bands under the curve, as Live has them: one touch row. -->
      <ScrubTabs
        options={BAND_NUMBERS}
        selected={selected - 1}
        onSelect={(i) => (selected = i + 1)}
        cols={8}
        ghost={fx.isGhost}
        label={(b) => `Band ${b}`}
        groupLabel="Band"
        name="band"
        class="band-row"
        style="--scrub-font-size: 0.9375rem;"
      >
        {#snippet item(b)}
          <span class:band-off={!bands[b - 1].on}>{b}</span>
        {/snippet}
      </ScrubTabs>
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={4}>
    {#snippet head()}<PanelEyebrow title="Band {selected}" color={fx.color.primary} />{/snippet}
    <ScrubTabs
      options={TYPE_ORDER}
      selected={TYPE_ORDER.indexOf(selectedState.type as (typeof TYPE_ORDER)[number])}
      onSelect={(_, type) => fx.sendParam(band.type, type)}
      cols={2}
      ghost={fx.isGhost}
      label={(type) => EQ8_TYPES[type]}
      groupLabel="Filter type"
      name="type"
      class="face-span-2"
      style="--scrub-font-size: 0.8125rem;"
    />
    <!-- Freq · Gain over Q · On: the band's knobs and its switch, one grid. -->
    <div class="pairs face-span-2" class:slot-ghost={fx.isGhost}>
      {@render knob(freqKnob)}
      {@render knob(gainKnob)}
      {@render knob(qKnob)}
      <div class="switch-cell">
        <ParamSwitch
          row
          label="On"
          on={selectedState.on}
          tint={fx.color.primary}
          onToggle={() => fx.sendParam(band.on, selectedState.on ? 0 : 1)}
        />
      </div>
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Global" color={fx.color.primary} />{/snippet}
    <div class="pairs face-span-2" class:slot-ghost={fx.isGhost}>
      {@render knob(OUTPUT)}
      {@render knob(SCALE)}
      <div class="switch-cell wide">
        <ParamSwitch row label="Adaptive Q" on={adaptiveQ} tint={fx.color.primary} onToggle={() => fx.sendParam(EQ8.adaptiveQ, adaptiveQ ? 0 : 1)} />
      </div>
    </div>
  </FaceSection>
</FaceGrid>
</div>

<style>
  /* Live's order on the face grid (ADR-510): the curve over its bands,
     the selected band's controls, then the global ones. */
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
  .graph {
    flex: 1 1 0;
    min-height: 0;
  }
  /* The band picker: one touch row under the curve. */
  .cell > :global(.band-row) {
    flex: 0 0 var(--height-touch);
  }

  /* Two rows of two on the face's own columns: knobs of one size, a switch
     in a knob's cell (one touch row, centred), or across both columns. */
  .pairs {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: repeat(2, minmax(0, 1fr));
    row-gap: var(--face-gutter);
    min-width: 0;
    min-height: 0;
  }
  .knob-cell,
  .switch-cell {
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .knob-cell > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
  .switch-cell {
    flex-direction: column;
    justify-content: center;
  }
  .switch-cell.wide {
    grid-column: 1 / -1;
  }

  .band-off {
    opacity: 0.45;
    text-decoration: line-through;
  }
</style>
