<script lang="ts">
  /**
   * Live's Delay (the `delay` slot, 2026-11-06), its panel left to right
   * (Live 12 manual §29.11):
   *
   *   [Left: Sync · 1 2 / 3 4 / 5 6 / 8 16 · Offset] [Right: the same]
   *   [Feedback · Link · Freeze] (under the channels in Live; beside them
   *   here, where the band is short) [the band-pass display: Freq across,
   *   Width up · Filter]
   *   [LFO: Delay / Filter / Rate] [Smoothing · Ping Pong · Dry/Wet]
   *
   * As in Live the display is the filter's pad, so this view mounts no
   * time x feedback pad; that is the chain cell's and the browser tile's
   * control (`delay` in deviceControls). With Link on, Live sets both
   * channels from either, so both columns show and write the left's time;
   * each Offset stays its own. Off Sync, a channel's grid is its Time box.
   * The LFO's Rate follows its rate mode; its mode, wave and Morph are not
   * drawn. Indices and labels are `delayParams.ts`, measured on the rig.
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */
  import FilterDotsGraph from '$lib/components/v6/central/FilterDotsGraph.svelte';
  import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import ParamColumn from './fx/ParamColumn.svelte';
  import ParamSwitch from './fx/ParamSwitch.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { axisHz, responsePath } from '$lib/utils/filterGraph';
  import { DELAY, DELAY_FILTER_RANGE, DELAY_SIXTEENTHS, DELAY_SMOOTHING, delayFilterDb } from '$lib/components/v6/device-panel/delayParams';

  const fx = useFxGridSlot('delay');

  /** A fresh insert on the rig (its User Library default): linked, synced, L 2/16, R 4/16, Fade, filter on at 1 kHz. */
  const REST: Record<number, number> = {
    [DELAY.smoothing]: 1,
    [DELAY.link]: 1,
    [DELAY.pingPong]: 0,
    [DELAY.syncL]: 1,
    [DELAY.syncR]: 1,
    [DELAY.timeL]: 0.5954,
    [DELAY.timeR]: 0.5954,
    [DELAY.sixteenthL]: 1,
    [DELAY.sixteenthR]: 3,
    [DELAY.freeze]: 0,
    [DELAY.filterOn]: 1,
    [DELAY.filterFreq]: 0.5089,
    [DELAY.filterWidth]: 0.8824,
    [DELAY.lfoMode]: 5
  };
  const value = (index: number) => fx.paramValue(index) ?? REST[index] ?? 0;
  const on = (index: number) => value(index) >= 0.5;
  const toggle = (index: number) => fx.sendParam(index, on(index) ? 0 : 1);

  let linked = $derived(on(DELAY.link));
  const LEFT = { name: 'Left', sync: DELAY.syncL, sixteenth: DELAY.sixteenthL, time: DELAY.timeL, offset: DELAY.offsetL };
  const RIGHT = { name: 'Right', sync: DELAY.syncR, sixteenth: DELAY.sixteenthR, time: DELAY.timeR, offset: DELAY.offsetR };
  /** Where a channel's time reads and writes: the left's while linked. */
  let channels = $derived([LEFT, linked ? { ...LEFT, name: 'Right', offset: DELAY.offsetR } : RIGHT]);

  /** The display: the band-pass drawn near the top, its one dot Freq across and Width up. */
  const FREQS = Array.from({ length: 121 }, (_, i) => axisHz(DELAY_FILTER_RANGE, i / 120));
  const LIFT_DB = 18;
  let filterOn = $derived(on(DELAY.filterOn));
  let curves = $derived(
    filterOn
      ? [{ d: responsePath(delayFilterDb(value(DELAY.filterFreq), value(DELAY.filterWidth), FREQS).map((d) => d + LIFT_DB)), color: fx.color.primary }]
      : []
  );
  let dots = $derived([
    { label: '', x: value(DELAY.filterFreq), y: value(DELAY.filterWidth), color: fx.color.primary, on: filterOn, filled: true }
  ]);
  function moveFilter(_i: number, x: number, y: number) {
    fx.sendParam(DELAY.filterFreq, x);
    fx.sendParam(DELAY.filterWidth, y);
  }

  const LFO_RATE: Record<number, { index: number; min: number; max: number; rest: number }> = {
    0: { index: DELAY.lfoFreq, min: 0, max: 1, rest: 0.4717 },
    1: { index: DELAY.lfoTime, min: 0, max: 1, rest: 0.1974 },
    5: { index: DELAY.lfoSixteenth, min: 1, max: 64, rest: 1 }
  };
  let lfo = $derived.by(() => {
    const rate = LFO_RATE[Math.round(value(DELAY.lfoMode))] ?? { index: DELAY.lfoSynced, min: 0, max: 21, rest: 4 };
    return [
      { index: DELAY.lfoToDelay, title: 'Delay', rest: 0 },
      { index: DELAY.lfoToFilter, title: 'Filter', rest: 0 },
      { ...rate, title: 'Rate' }
    ];
  });
  const FEEDBACK = [{ index: DELAY.feedback, title: 'Feedback', rest: 0 }];
  const DRY_WET = [{ index: DELAY.dryWet, title: 'Dry/Wet', rest: 0.5 }];
</script>

<div class="fx-layout" data-view="delay">
  {#each channels as ch (ch.name)}
    <div class="cell">
      <ParamSwitch
        label={on(ch.sync) ? `${ch.name} Sync` : `${ch.name} Time`}
        on={on(ch.sync)}
        tint={fx.color.primary}
        ghost={fx.isGhost}
        row
        onToggle={() => toggle(ch.sync)}
      />
      {#if on(ch.sync)}
        <ScrubTabs
          options={DELAY_SIXTEENTHS}
          selected={Math.round(value(ch.sixteenth))}
          onSelect={(i) => fx.sendParam(ch.sixteenth, i)}
          cols={2}
          tint={fx.color.primary}
          inked
          ghost={fx.isGhost}
          label={(s) => `${ch.name} ${s} sixteenths`}
          groupLabel={`${ch.name} time`}
          name={`sixteenth-${ch.name}`}
          style="flex: 3 1 0;"
        >
          {#snippet item(s)}{s}{/snippet}
        </ScrubTabs>
      {:else}
        <div class="grow" class:slot-ghost={fx.isGhost}>
          <DeviceSlider
            value={value(ch.time)}
            title="Time"
            face="knob"
            orientation="vertical"
            isGhost={fx.isGhost}
            color={fx.color}
            readout={fx.paramDisplay(ch.time)}
            onInteraction={(v) => fx.sendParam(ch.time, v)}
          />
        </div>
      {/if}
      <div class="offset">
        <ParamColumn face="knob" {fx} ink={fx.color} boxes={[{ index: ch.offset, title: 'Offset', rest: 0.5, center: 0.5 }]} />
      </div>
    </div>
  {/each}

  <div class="cell">
    <div class="grow"><ParamColumn {fx} ink={fx.color} boxes={FEEDBACK} /></div>
    <ParamSwitch label="Link" on={linked} tint={fx.color.primary} ghost={fx.isGhost} row onToggle={() => toggle(DELAY.link)} />
    <ParamSwitch label="Freeze" on={on(DELAY.freeze)} tint={fx.color.primary} ghost={fx.isGhost} row onToggle={() => toggle(DELAY.freeze)} />
  </div>

  <div class="cell" class:slot-ghost={fx.isGhost}>
    <div class="graph">
      <FilterDotsGraph {dots} {curves} onMove={moveFilter} ariaLabel="Delay band-pass filter" />
    </div>
    <ParamSwitch label="Filter" on={filterOn} tint={fx.color.primary} ghost={fx.isGhost} row onToggle={() => toggle(DELAY.filterOn)} />
  </div>

  <ParamColumn face="knob" {fx} ink={fx.color} boxes={lfo} />

  <div class="cell">
    <ScrubTabs
      options={DELAY_SMOOTHING}
      selected={Math.round(value(DELAY.smoothing))}
      onSelect={(i) => fx.sendParam(DELAY.smoothing, i)}
      cols={1}
      tint={fx.color.primary}
      inked
      ghost={fx.isGhost}
      label={(m) => m}
      groupLabel="Smoothing"
      name="smoothing"
      style="flex: 3 1 0;"
    />
    <ParamSwitch label="Ping Pong" on={on(DELAY.pingPong)} tint={fx.color.primary} ghost={fx.isGhost} row onToggle={() => toggle(DELAY.pingPong)} />
    <div class="grow"><ParamColumn {fx} ink={fx.color} boxes={DRY_WET} /></div>
  </div>
</div>

<style>
  /* Live's order: the two channels, Feedback with Link and Freeze (under
     the channels in Live; beside them here, the band being short), the
     display two and a half shares, then the LFO and the right-hand column. */
  .fx-layout {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 2.5fr) repeat(2, minmax(0, 1fr));
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

  .grow,
  .graph {
    flex: 3 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .grow > :global(*),
  .graph > :global(*) {
    flex: 1 1 0;
  }

  .offset {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .offset > :global(*) {
    flex: 1 1 0;
  }
</style>
