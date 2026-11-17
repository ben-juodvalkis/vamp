<script lang="ts">
  /**
   * Live's Delay (the `delay` slot, 2026-11-06), its panel left to right
   * (Live 12 manual §29.11):
   *
   *   [Left Sync over 1 2 / 3 4 / 5 6 / 8 16] [Link over Repitch Fade Jump
   *   over Offset L  Offset R] [Right Sync over the same]
   *   | [Freeze over Feedback] | [Filter over the band-pass display: Freq
   *   across, Width up] | [LFO: Rate over Delay  Filter]
   *   | [Ping Pong over Dry/Wet]
   *
   * on one face grid (ADR-510), sections 4 · 1 · 2 · 2 · 1.
   *
   * Re-laid for Ink (ADR-544, 2026-11-17) on two lines: every switch on
   * one touch row along the top, over the control it switches, and the
   * controls under it. The two channels mirror each other about what they
   * share: Link, the Smoothing a time change is made with, and their two
   * Offsets. That gives the sixteenths a touch row each (24px rows before)
   * and makes every knob medium: the Offsets and the LFO's three were
   * small, in columns of three. Feedback and Dry/Wet, the levels a set
   * rides, are boxes the band's height; a third of it, Dry/Wet's name was
   * cut by its own fill.
   *
   * As in Live the display is the filter's pad, so this view mounts no
   * time x feedback pad; that is the chain cell's and the browser tile's
   * control (`delay` in deviceControls). With Link on, Live sets both
   * channels from either, so both columns show and write the left's time;
   * each Offset stays its own. Off Sync, a channel's grid is its Time knob.
   * The LFO's Rate follows its rate mode; its mode, wave and Morph are not
   * drawn. Indices and labels are `delayParams.ts`, measured on the rig.
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */
  import FilterDotsGraph from '$lib/components/v6/central/FilterDotsGraph.svelte';
  import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import ParamColumn from './fx/ParamColumn.svelte';
  import { press } from '$lib/actions/press';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
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
  type Channel = { name: string; side: string; sync: number; sixteenth: number; time: number; offset: number; offsetTitle: string };
  const LEFT: Channel = { name: 'Left', side: 'left', sync: DELAY.syncL, sixteenth: DELAY.sixteenthL, time: DELAY.timeL, offset: DELAY.offsetL, offsetTitle: 'Offset L' };
  const RIGHT: Channel = { name: 'Right', side: 'right', sync: DELAY.syncR, sixteenth: DELAY.sixteenthR, time: DELAY.timeR, offset: DELAY.offsetR, offsetTitle: 'Offset R' };
  /** Where a channel's time reads and writes: the left's while linked. */
  let channels = $derived<Channel[]>([LEFT, linked ? { ...LEFT, name: 'Right', side: 'right', offset: DELAY.offsetR, offsetTitle: 'Offset R' } : RIGHT]);

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
    return {
      rate: { ...rate, title: 'Rate' },
      toDelay: { index: DELAY.lfoToDelay, title: 'Delay', min: 0, max: 1, rest: 0 },
      toFilter: { index: DELAY.lfoToFilter, title: 'Filter', min: 0, max: 1, rest: 0 }
    };
  });
  const FEEDBACK = [{ index: DELAY.feedback, title: 'Feedback', rest: 0 }];
  const DRY_WET = [{ index: DELAY.dryWet, title: 'Dry/Wet', rest: 0.5 }];
</script>

<!-- A switch on the face's top line: one touch row over what it switches. -->
{#snippet toggleRow(label: string, lit: boolean, onToggle: () => void, place = '')}
  <button
    class="physical-button btn-toggle fx-switch {place}"
    class:active={lit}
    class:slot-ghost={fx.isGhost}
    aria-pressed={lit}
    use:press={{ onPress: onToggle }}
  >{label}</button>
{/snippet}

<!-- A medium knob on one parameter in its own range (ADR-509); a ghost draws `rest`. -->
{#snippet knob(box: { index: number; title: string; rest: number; min?: number; max?: number; center?: number }, place = '')}
  <div class="knob-cell {place}" class:slot-ghost={fx.isGhost}>
    <DeviceSlider
      value={fx.paramValue(box.index) ?? box.rest}
      title={box.title}
      face="knob"
      knobSize="m"
      knobFit
      knobCaptionBelow
      orientation="vertical"
      min={box.min ?? 0}
      max={box.max ?? 1}
      centerOrigin={box.center !== undefined}
      centerValue={box.center}
      isGhost={fx.isGhost}
      color={fx.color}
      readout={fx.paramDisplay(box.index)}
      onInteraction={(v) => fx.sendParam(box.index, v)}
    />
  </div>
{/snippet}

<!-- One face grid (ADR-510), ten columns of ~86px at 1366 x 1024: the two
     channels about what they share 4 · Feedback 1 · the filter display 2 ·
     LFO 2 · Dry/Wet 1. Two lines: the switches, then what they switch. -->
<div class="face-root" data-view="delay">
<FaceGrid sections={[4, 1, 2, 2, 1]}>
  <FaceSection span={4}>
    {#snippet head()}<PanelEyebrow title="Left · Right" color={fx.color.primary} />{/snippet}
    <div class="face-span-all time-board">
      {#each channels as ch (ch.name)}
        {@render toggleRow(on(ch.sync) ? `${ch.name} Sync` : `${ch.name} Time`, on(ch.sync), () => toggle(ch.sync), `sync-${ch.side}`)}
        {#if on(ch.sync)}
          <ScrubTabs
            options={DELAY_SIXTEENTHS}
            selected={Math.round(value(ch.sixteenth))}
            onSelect={(i) => fx.sendParam(ch.sixteenth, i)}
            cols={2}
            ghost={fx.isGhost}
            label={(s) => `${ch.name} ${s} sixteenths`}
            groupLabel={`${ch.name} time`}
            name={`sixteenth-${ch.name}`}
            class="time-{ch.side}"
            style="--scrub-font-size: 0.9375rem;"
          >
            {#snippet item(s)}{s}{/snippet}
          </ScrubTabs>
        {:else}
          {@render knob({ index: ch.time, title: 'Time', rest: REST[ch.time] }, `time-knob-${ch.side}`)}
        {/if}
      {/each}

      <!-- Between the channels, what they share: Link, how a time change is
           smoothed, and each one's Offset beside its own channel. -->
      {@render toggleRow('Link', linked, () => toggle(DELAY.link), 'link')}
      <ScrubTabs
        options={DELAY_SMOOTHING}
        selected={Math.round(value(DELAY.smoothing))}
        onSelect={(i) => fx.sendParam(DELAY.smoothing, i)}
        cols={3}
        ghost={fx.isGhost}
        label={(m) => m}
        groupLabel="Smoothing"
        name="smoothing"
        class="smoothing"
        style="--scrub-font-size: 0.8125rem; --scrub-padding: 0;"
      />
      {#each channels as ch (ch.name)}
        {@render knob({ index: ch.offset, title: ch.offsetTitle, rest: 0.5, center: 0.5 }, `offset-${ch.side}`)}
      {/each}
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Feedback" color={fx.color.primary} />{/snippet}
    <div class="cell">
      {@render toggleRow('Freeze', on(DELAY.freeze), () => toggle(DELAY.freeze))}
      <div class="grow"><ParamColumn {fx} ink={fx.color} boxes={FEEDBACK} /></div>
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Filter" color={fx.color.primary} />{/snippet}
    <div class="cell face-span-2">
      {@render toggleRow('Filter', filterOn, () => toggle(DELAY.filterOn))}
      <div class="grow" class:slot-ghost={fx.isGhost}>
        <FilterDotsGraph {dots} {curves} onMove={moveFilter} ariaLabel="Delay band-pass filter" />
      </div>
    </div>
  </FaceSection>
  <FaceSeam />

  <!-- The LFO's rate over the two places it goes: three medium knobs
       (three small ones in a column before). -->
  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="LFO" color={fx.color.primary} />{/snippet}
    <div class="face-span-2 lfo-board">
      {@render knob(lfo.rate, 'lfo-rate')}
      {@render knob(lfo.toDelay)}
      {@render knob(lfo.toFilter)}
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Output" color={fx.color.primary} />{/snippet}
    <div class="cell">
      {@render toggleRow('Ping Pong', on(DELAY.pingPong), () => toggle(DELAY.pingPong))}
      <div class="grow"><ParamColumn {fx} ink={fx.color} boxes={DRY_WET} /></div>
    </div>
  </FaceSection>
</FaceGrid>
</div>

<style>
  /* Live's order on the face grid (ADR-510): the two channels, Feedback
     with Freeze, the display, the LFO, then Ping Pong over Dry/Wet. Every
     section is two lines: a touch row of switches, then the controls. */
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
  .grow {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .grow > :global(*) {
    flex: 1 1 0;
  }

  /* A switch: one touch row, its column's width. */
  .fx-switch {
    flex: 0 0 var(--height-touch);
    min-height: 0;
    width: 100%;
    padding-inline: 2px;
    font-size: 0.875rem;
    font-weight: var(--font-weight-medium);
  }

  .knob-cell {
    display: flex;
    min-height: 0;
    min-width: 0;
  }
  .knob-cell > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }

  /* The channels on the face's four columns: Left | what they share, over
     two | Right. Three rows: the switches, Smoothing, the Offsets; a
     channel's time (its sixteenths, or its Time knob) runs down the last two. */
  .time-board {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: var(--height-touch) var(--height-touch) minmax(0, 1fr);
    gap: var(--face-gutter);
    min-height: 0;
    min-width: 0;
  }
  .time-board > :global(*) {
    min-height: 0;
    min-width: 0;
  }
  .time-board > .sync-left {
    grid-area: 1 / 1;
  }
  .time-board > .sync-right {
    grid-area: 1 / 4;
  }
  .time-board > .link {
    grid-area: 1 / 2 / auto / span 2;
  }
  .time-board > :global(.time-left) {
    grid-area: 2 / 1 / span 2 / auto;
  }
  .time-board > :global(.time-right) {
    grid-area: 2 / 4 / span 2 / auto;
  }
  /* Off Sync a channel's time is a knob, on the Offsets' line. */
  .time-board > .time-knob-left {
    grid-area: 3 / 1;
  }
  .time-board > .time-knob-right {
    grid-area: 3 / 4;
  }
  .time-board > :global(.smoothing) {
    grid-area: 2 / 2 / auto / span 2;
  }
  .time-board > .offset-left {
    grid-area: 3 / 2;
  }
  .time-board > .offset-right {
    grid-area: 3 / 3;
  }

  /* Rate over Delay and Filter, on the face's two columns. */
  .lfo-board {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--face-gutter);
    min-height: 0;
    min-width: 0;
  }
  .lfo-board > .lfo-rate {
    grid-column: 1 / -1;
  }
</style>
