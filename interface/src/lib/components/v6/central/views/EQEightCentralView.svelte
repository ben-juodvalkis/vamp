<script lang="ts">
  /**
   * EQ Eight (the `eq8` slot, 2026-11-06), Live's panel (manual §29.15):
   *
   *   [Freq / Gain / Q] [the curve, a dot per band] [Band 1-8 · On] [Type]
   *   [Output / Scale · Adaptive Q]
   *
   * Live's per-band choosers and switches under its display become one
   * band picker and one type tab for the band selected, so each stays a
   * touch target.
   *
   * The curve is every band that is on, in series (`eq8Params.eq8Db`), on
   * the device's own 10 Hz - 22 kHz sweep, so a dot's X is its Frequency
   * parameter. A press grabs the nearest dot and selects its band, which
   * the columns beside then edit. Up and down is the gain for a shelf or a
   * bell, as in Live; for the cuts and the notch, which have none, it is
   * the Q (Live's Alt-drag), so a finger reaches it. The app edits each
   * band's A half (Live's Stereo mode).
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */
  import FilterDotsGraph, { type GraphDot } from '$lib/components/v6/central/FilterDotsGraph.svelte';
  import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';
  import ParamColumn from './fx/ParamColumn.svelte';
  import ParamSwitch from './fx/ParamSwitch.svelte';
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

  let band = $derived(eq8Band(selected));
  let selectedState = $derived(bands[selected - 1]);
  let bandBoxes = $derived([
    { index: band.freq, title: 'Freq', rest: EQ8_REST.freq[selected - 1] },
    { index: band.gain, title: 'Gain', rest: 0, min: -EQ8_GAIN_MAX, max: EQ8_GAIN_MAX, center: 0 },
    { index: band.q, title: 'Q', rest: EQ8_REST.q }
  ]);
  const GLOBAL = [
    { index: EQ8.output, title: 'Output', rest: 0, min: -12, max: 12, center: 0 },
    { index: EQ8.scale, title: 'Scale', rest: 1, min: -2, max: 2, center: 0 }
  ];
  let adaptiveQ = $derived((fx.paramValue(EQ8.adaptiveQ) ?? 1) >= 0.5);
</script>

<div class="fx-layout" data-view="eq8">
  <ParamColumn face="knob" {fx} ink={fx.color} boxes={bandBoxes} />

  <div class="cell graph" class:slot-ghost={fx.isGhost}>
    <FilterDotsGraph {dots} {curves} onGrab={(i) => (selected = i + 1)} onMove={move} ariaLabel="EQ Eight bands" />
  </div>

  <div class="cell">
    <ScrubTabs
      options={BAND_NUMBERS}
      selected={selected - 1}
      onSelect={(i) => (selected = i + 1)}
      cols={2}
      tint={fx.color.primary}
      inked
      ghost={fx.isGhost}
      label={(b) => `Band ${b}`}
      groupLabel="Band"
      name="band"
      style="flex: 4 1 0;"
    >
      {#snippet item(b)}
        <span class:band-off={!bands[b - 1].on}>{b}</span>
      {/snippet}
    </ScrubTabs>
    <ParamSwitch
      row
      label="On"
      on={selectedState.on}
      tint={fx.color.primary}
      ghost={fx.isGhost}
      onToggle={() => fx.sendParam(band.on, selectedState.on ? 0 : 1)}
    />
  </div>

  <div class="cell">
    <ScrubTabs
      options={EQ8_TYPES}
      selected={selectedState.type}
      onSelect={(i) => fx.sendParam(band.type, i)}
      cols={1}
      tint={fx.color.primary}
      inked
      ghost={fx.isGhost}
      label={(t) => t}
      groupLabel="Filter type"
      name="type"
      class="flex-1"
    />
  </div>

  <div class="cell">
    <div class="grow"><ParamColumn {fx} ink={fx.color} boxes={GLOBAL} /></div>
    <ParamSwitch label="Adaptive Q" on={adaptiveQ} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => fx.sendParam(EQ8.adaptiveQ, adaptiveQ ? 0 : 1)} />
  </div>
</div>

<style>
  /* Live's order: the band's dials, the curve (three shares), then the band
     choosers and the global controls. */
  .fx-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 3fr) repeat(3, minmax(0, 1fr));
    gap: var(--central-gap);
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    min-height: 0;
    min-width: 0;
  }

  .grow {
    flex: 3 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .grow > :global(*) {
    flex: 1 1 0;
  }

  .band-off {
    opacity: 0.45;
    text-decoration: line-through;
  }
</style>
