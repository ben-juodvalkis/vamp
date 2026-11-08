<script lang="ts" module>
  import type { BoardRow } from '../../InstrumentBoard.svelte';

  /**
   * Roar at full screen (ADR-515), in the order of Live's expanded Roar:
   * what feeds the stages (Input, Routing) and what follows them
   * (Feedback, Global) on top, the three stages side by side, then the four
   * modulation sources. Controls stand two to a column wherever a pair
   * belongs together (user, 2026-11-07: the first board's single rows of
   * knobs left most of each tile empty), so a row needs fewer columns and
   * each column is filled top to bottom. A control's size is its rank, as
   * Live's own panel ranks it (manual 29.33): the primary ones (Drive, a
   * stage's Amount and Frequency, the feedback's Amount) large, the
   * secondary medium, the tertiary (Level, Tone Freq, the feedback filter,
   * Smooth) small; in a shared column the larger takes the larger share.
   * The stages carry Live's two pictures, the shaper's curve and the
   * filter's response, the stages' row the tallest. Each tile is a panel
   * with a header bar (ADR-516); a stage's own switch is on its bar.
   */
  export const ROAR_BOARD: readonly BoardRow[] = [
    { tiles: [{ id: 'input', cols: 2 }, { id: 'routing', cols: 2 }, { id: 'feedback', cols: 3 }, { id: 'global', cols: 3 }], weight: 0.9 },
    { tiles: [{ id: 'stage-1', cols: 4 }, { id: 'stage-2', cols: 4 }, { id: 'stage-3', cols: 4 }], weight: 1.5 },
    { tiles: [{ id: 'lfo-1', cols: 4 }, { id: 'lfo-2', cols: 4 }, { id: 'env', cols: 4 }, { id: 'noise', cols: 2 }], weight: 0.9 }
  ];
</script>

<script lang="ts">
  /**
   * Roar's pages (ADR-515): the band's one face (`face`) and the full
   * screen's tiles, each laid on the face grid (ADR-510) and bound by
   * Live's parameter names through `usePanelParams`, read off the running
   * Roar (`roarParams.ts`). The chain cell's XY moves Drive and Dry/Wet, so
   * the face leaves them out (ADR-510); the board, where everything is,
   * has them in Input and Global.
   *
   * The routing mode decides which stages run (Live 12 manual, 29.33.1):
   * a stage the mode does not use ghosts, Blend shows only where the mode
   * blends two stages, and Multi Band's crossovers only under Multi Band.
   * Its stages take the mode's names (Low, Mid, High; Mid, Side).
   */
  import DeviceSlider from '../../../device-panel/DeviceSlider.svelte';
  import LfoGraph from '../../LfoGraph.svelte';
  import DeviceXY from '../../../device-panel/DeviceXY.svelte';
  import ShaperCurve from './ShaperCurve.svelte';
  import FaceGrid from '../../FaceGrid.svelte';
  import FaceSection from '../../FaceSection.svelte';
  import FaceSeam from '../../FaceSeam.svelte';
  import BoardTile from '../../BoardTile.svelte';
  import ChoicePicker from '../../ChoicePicker.svelte';
  import type { PanelParams } from '../panel/usePanelParams.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';
  import {
    ROAR_ROUTINGS,
    ROAR_SHAPERS,
    ROAR_FILTERS,
    ROAR_FB_MODES,
    ROAR_RATE_MODES,
    ROAR_LFO_WAVES,
    ROAR_NOISES,
    roarStagesFor,
    roarHasBlend,
    roarStageNames,
    roarFilterExtra,
    roarFilterHasRes,
    roarRateParam,
    roarFeedbackTimeParam,
    roarFilterCurve,
    ROAR_FILTER_FREQ_RANGE
  } from '../../../device-panel/roarParams';

  interface Props {
    /** `face` (the band), or a board tile's id (`ROAR_BOARD`). */
    page: string;
    params: PanelParams;
    ink: DeviceColorScheme;
    /** `routing_mode_index`, or undefined until the property answers. */
    routing: number | undefined;
    setRouting: (index: number) => void;
  }

  let { page, params, ink, routing, setRouting }: Props = $props();

  /** Rails that are 0..1 with their zero in the middle (the dump's labels). */
  const BIPOLAR = /^(Drive|Tone Amt|Shaper \d (Bias|Level)|Flt \d Peak|LFO \d Morph)$/;

  const lo = (p: string) => params.range(p)?.min ?? 0;
  const hi = (p: string) => params.range(p)?.max ?? 1;
  const step = (p: string) => {
    const v = params.raw(p);
    return v === undefined ? -1 : Math.round(v - lo(p));
  };
  const isOn = (p: string) => params.has(p) && (params.raw(p) ?? 0) >= 0.5;
  const flip = (p: string) => params.write(p, isOn(p) ? lo(p) : hi(p));

  let stages = $derived(roarStagesFor(routing));
  let names = $derived(roarStageNames(routing));
  let blend = $derived(roarHasBlend(routing));
  let multiBand = $derived(routing === 3);

  /** A rate knob's caption by its mode: a rate in Hz, a count of sixteenths, or a division. */
  function rateTitle(mode: number): string {
    return mode === 0 ? 'Rate' : mode === 4 ? '16ths' : 'Sync';
  }
</script>

<!-- A knob bound by name. A parameter whose range is integers wider than a
     switch (a synced division, a note, a count of sixteenths) steps. -->
{#snippet knob(param: string, title: string, size: 's' | 'm' | 'l' | 'xl' = 'm', ghost = false)}
  {@const l = lo(param)}
  {@const h = hi(param)}
  {@const bipolar = BIPOLAR.test(param) || (l < 0 && h > 0)}
  {@const steps = h - l > 1 && Number.isInteger(l) && Number.isInteger(h) ? h - l : undefined}
  <div class="cell rank-{size}" data-param={param}>
    <DeviceSlider
      value={params.raw(param) ?? l}
      {title}
      face="knob"
      knobSize={size}
      min={l}
      max={h}
      centerOrigin={bipolar}
      centerValue={bipolar ? (l < 0 && h > 0 ? 0 : (l + h) / 2) : undefined}
      {steps}
      orientation="vertical"
      labelSize="small"
      isGhost={ghost || !params.has(param)}
      color={ink}
      readout={params.display(param)}
      onInteraction={(v) => params.write(param, steps ? Math.round(v) : v)}
    />
  </div>
{/snippet}

<!-- An on/off parameter: one touch-height button, lit while on. -->
{#snippet sw(param: string, title: string)}
  {@const on = isOn(param)}
  <div class="cell sw-cell">
    <button
      class="physical-button btn-toggle switch"
      class:active={on}
      aria-pressed={on}
      disabled={!params.has(param)}
      style="--btn-tint: {ink.primary};"
      data-param={param}
      onclick={() => params.write(param, on ? lo(param) : hi(param))}
    >{title}</button>
  </div>
{/snippet}

<!-- A pick of named values: a button naming the value, the list opening over the view. -->
{#snippet pick(param: string, labels: readonly string[], title: string, caption?: string)}
  <div class="cell sw-cell" data-param={param}>
    <ChoicePicker options={labels} selected={params.has(param) ? step(param) : undefined} onSelect={(i) => params.write(param, lo(param) + i)} label={title} {caption} tint={ink.primary} ghost={!params.has(param)} />
  </div>
{/snippet}

{#snippet routingPick(caption?: string)}
  <div class="cell sw-cell" data-roar-routing>
    <ChoicePicker options={ROAR_ROUTINGS} selected={routing} onSelect={setRouting} label="Routing" {caption} tint={ink.primary} ghost={routing === undefined} />
  </div>
{/snippet}

{#snippet title(text: string)}<span class="sub" style="color: {ink.primary};">{text}</span>{/snippet}

<!-- The routing on the band: its pick, one touch row across the section,
     over what the mode adds: Blend between two stages, large across both
     columns, or Multi Band's two crossovers, a column each. -->
{#snippet routingTile()}
  <div class="face-span-all routing-face">
    <div class="span-2-cell">{@render routingPick()}</div>
    {#if multiBand}
      {@render knob('Low Mid X-Over', 'Low', 'm')}
      {@render knob('Mid High X-Over', 'High', 'm')}
    {:else}
      <div class="span-2-cell tall">{@render knob('Blend', 'Blend', 'l', !blend)}</div>
    {/if}
  </div>
{/snippet}

<!-- One stage on the band, as Live lays it: the shaper's half on the
     left, the filter's on the right. One touch row of each half's type
     with its switch beside it (2026-11-08; the switches were a row of
     their own at the foot, two slabs under the knobs), then the six knobs
     under it, medium, a whole name each. The board's stage adds its
     pictures (`stageBoard`). -->
{#snippet stage(n: number)}
  {@const type = step(`Flt ${n} Type`)}
  {@const extra = roarFilterExtra(type)}
  <div class="face-span-all stage-grid" data-roar-stage-grid={n}>
    <div class="span-2-cell">{@render pick(`Shaper ${n} Type`, ROAR_SHAPERS, `${names[n - 1]} shaper`, 'Shaper')}</div>
    {@render sw(`Shaper ${n} On`, 'Shaper')}
    <div class="span-2-cell">{@render pick(`Flt ${n} Type`, ROAR_FILTERS, `${names[n - 1]} filter`, 'Filter')}</div>
    {@render sw(`Flt ${n} On`, 'Filter')}
    {@render knob(`Shaper ${n} Amt`, 'Amount', 'm')}
    {@render knob(`Shaper ${n} Bias`, 'Bias', 'm')}
    {@render knob(`Shaper ${n} Level`, 'Level', 'm')}
    {@render knob(`Flt ${n} Freq`, 'Freq', 'm')}
    {@render knob(`Flt ${n} Res`, 'Res', 'm', !roarFilterHasRes(type))}
    {#if extra}{@render knob(`Flt ${n} ${extra}`, extra, 'm')}{:else}<div class="cell"></div>{/if}
  </div>
{/snippet}

<!-- A stage on the board, as Live's expanded Roar draws one: the shaper's
     two columns and the filter's two, each its type over its picture (the
     shaper's curve, dragged for Amount and Bias; the filter's response, a
     pad of Freq across and Res up) over its knobs by rank, its switches at
     the foot. -->
{#snippet stageBoard(n: number)}
  {@const type = step(`Flt ${n} Type`)}
  {@const extra = roarFilterExtra(type)}
  {@const fOn = isOn(`Flt ${n} On`)}
  <div class="face-span-all stage-board" data-roar-stage-grid={n}>
    <div class="span-2-cell">{@render pick(`Shaper ${n} Type`, ROAR_SHAPERS, `${names[n - 1]} shaper`, 'Shaper')}</div>
    <div class="span-2-cell">{@render pick(`Flt ${n} Type`, ROAR_FILTERS, `${names[n - 1]} filter`, 'Filter')}</div>
    <div class="span-2-cell picture"><ShaperCurve {params} {n} ink={ink.primary} /></div>
    <div class="span-2-cell picture" data-roar-filter-pad={n}>
      <DeviceXY
        xValue={params.raw(`Flt ${n} Freq`) ?? 0.97}
        yValue={params.raw(`Flt ${n} Res`) ?? 0.1}
        showCurve
        curveType={roarFilterCurve(type, params.raw(`Flt ${n} Morph`) ?? 0)}
        curveFreqRange={ROAR_FILTER_FREQ_RANGE}
        isGhost={!fOn || !params.has(`Flt ${n} Freq`)}
        color={ink}
        onInteraction={(x, y) => {
          params.write(`Flt ${n} Freq`, x, `Flt ${n} On`);
          if (roarFilterHasRes(type)) params.write(`Flt ${n} Res`, y, `Flt ${n} On`);
        }}
      />
    </div>
    {@render knob(`Shaper ${n} Amt`, 'Amount', 'l')}
    <div class="stack">{@render knob(`Shaper ${n} Bias`, 'Bias', 'm')}{@render knob(`Shaper ${n} Level`, 'Level', 's')}</div>
    {@render knob(`Flt ${n} Freq`, 'Freq', 'l')}
    <div class="stack">{@render knob(`Flt ${n} Res`, 'Res', 'm', !roarFilterHasRes(type))}{#if extra}{@render knob(`Flt ${n} ${extra}`, extra, 's')}{/if}</div>
    <div class="span-2-cell">{@render sw(`Shaper ${n} On`, 'Shaper')}</div>
    {@render sw(`Flt ${n} On`, 'Filter')}
    {@render sw(`Flt ${n} Pre On`, 'Pre')}
  </div>
{/snippet}

<!-- An LFO: its wave as Live draws it (ADR-514), rate across, across the
     tile over its wave and rate mode, rate, morph and smoothing. Roar's LFOs
     have no amount of their own (the matrix sets how far they reach), so
     the picture is drawn full height. Beside the controls the wave was too
     narrow to draw tall, so it stays on top. -->
{#snippet lfo(n: 1 | 2)}
  {@const prefix = `LFO ${n}` as const}
  {@const mode = step(`${prefix} Mode`)}
  {@const rate = roarRateParam(prefix, mode)}
  <div class="face-span-all graph-board" style="--graph-rows: minmax(0, 0.85fr) minmax(0, 1fr);">
    <div class="graph"><LfoGraph {params} ink={ink.primary} shape={ROAR_LFO_WAVES[step(`${prefix} Wave`)]} {rate} /></div>
    <div class="stack">{@render pick(`${prefix} Wave`, ROAR_LFO_WAVES, `${prefix} wave`, 'Wave')}{@render pick(`${prefix} Mode`, ROAR_RATE_MODES, `${prefix} rate mode`, 'Rate')}</div>
    {@render knob(rate, rateTitle(mode), 'l')}
    {@render knob(`${prefix} Morph`, 'Morph', 'm')}
    {@render knob(`${prefix} Smooth`, 'Smooth', 's')}
  </div>
{/snippet}

<div class="roar-page" data-roar-page={page}>
{#if page === 'face'}
  <!-- The band (ADR-513: one face): Input's tone, the routing, the first
       stage, the feedback and the compressor. Eleven columns (2026-11-08;
       fifteen until then, 57px each, which cut "Amount" to "Am…"): a
       column holds a medium knob with its whole name, so Input, Feedback
       and Global stack their two in one column each and the stage's six
       knobs stand one a column. -->
  <FaceGrid sections={[1, 2, 6, 1, 1]}>
    <FaceSection span={1}>
      {#snippet head()}{@render title('Input')}{/snippet}
      <div class="stack">{@render knob('Tone Amt', 'Tone', 's')}{@render knob('Tone Freq', 'Freq', 's')}{@render sw('Color On', 'Color')}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render title('Routing')}{/snippet}
      {@render routingTile()}
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={6}>
      {#snippet head()}{@render title(names[0])}{/snippet}
      {@render stage(1)}
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render title('Feedback')}{/snippet}
      <div class="stack">
        {@render knob('Feedback', 'Amount')}
        {@render knob(roarFeedbackTimeParam(step('FB Time Mode')), step('FB Time Mode') === 4 ? 'Note' : 'Time')}
      </div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render title('Global')}{/snippet}
      <div class="stack">{@render knob('Comp Amt', 'Comp')}{@render knob('Output', 'Output')}</div>
    </FaceSection>
  </FaceGrid>
{:else if page === 'input'}
  <BoardTile title="Input" ink={ink.primary}>
    <FaceGrid sections={[2]} heads={false}>
      <FaceSection span={2}>
        <div class="stack">
          <div class="grow">{@render knob('Drive', 'Drive', 'xl')}</div>
          {@render sw('Color On', 'Color')}
        </div>
        <div class="stack">{@render knob('Tone Amt', 'Tone', 'm')}{@render knob('Tone Freq', 'Freq', 's')}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'routing'}
  <BoardTile title="Routing" ink={ink.primary}>
    <FaceGrid sections={[2]} heads={false}>
      <FaceSection span={2}>
        <div class="face-span-all routing-board">
          <div class="span-2-cell">{@render routingPick('Mode')}</div>
          {#if multiBand}
            {@render knob('Low Mid X-Over', 'Low', 'm')}
            {@render knob('Mid High X-Over', 'High', 'm')}
          {:else}
            <div class="span-2-cell">{@render knob('Blend', 'Blend', 'l', !blend)}</div>
          {/if}
        </div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'feedback'}
  {@const mode = step('FB Time Mode')}
  <BoardTile title="Feedback" ink={ink.primary}>
    <FaceGrid sections={[3]} heads={false}>
      <FaceSection span={3}>
        <div class="stack">{@render pick('FB Time Mode', ROAR_FB_MODES, 'Feedback mode', 'Mode')}{@render sw('FB Invert', 'Invert')}{@render sw('Fb Gate On', 'Gate')}</div>
        <div class="stack">{@render knob('Feedback', 'Amount', 'l')}{@render knob(roarFeedbackTimeParam(mode), mode === 4 ? 'Note' : 'Time', 'm')}</div>
        <div class="stack">{@render knob('FB Freq', 'Freq', 's')}{@render knob('FB Width', 'Width', 's')}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'global'}
  <BoardTile title="Global" ink={ink.primary}>
    <FaceGrid sections={[3]} heads={false}>
      <FaceSection span={3}>
        <div class="stack"><div class="grow">{@render knob('Comp Amt', 'Comp', 'm')}</div>{@render sw('Comp Hp On', 'Comp HP')}</div>
        <div class="stack">{@render knob('Output', 'Output', 'm')}{@render knob('Dry/Wet', 'Dry/Wet', 'm')}</div>
        {@render knob('Global Mod Amt', 'Mod Amt', 's')}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page.startsWith('stage-')}
  <!-- A stage the routing does not run is ghosted whole, its switch still on its bar. -->
  {@const n = Number(page.slice(6))}
  <BoardTile title={names[n - 1]} ink={ink.primary} on={isOn(`Stage ${n} On`)} onToggle={() => flip(`Stage ${n} On`)} switchParam="Stage {n} On" switchDisabled={!params.has(`Stage ${n} On`)} ghost={n > stages}>
    <FaceGrid sections={[4]} heads={false}>
      <FaceSection span={4} data-roar-stage={n} data-roar-stage-used={n <= stages}>
        {@render stageBoard(n)}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'lfo-1' || page === 'lfo-2'}
  <BoardTile title={page === 'lfo-1' ? 'LFO 1' : 'LFO 2'} ink={ink.primary}>
    <FaceGrid sections={[4]} heads={false}>
      <FaceSection span={4}>
        {@render lfo(page === 'lfo-1' ? 1 : 2)}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'env'}
  <!-- The envelope follower: its threshold and times medium, its gain and
       the band it listens to small, Hold beside them. -->
  <BoardTile title="Envelope" ink={ink.primary}>
    <FaceGrid sections={[4]} heads={false}>
      <FaceSection span={4}>
        <div class="stack">{@render knob('Env Thresh', 'Thresh', 'm')}{@render knob('Env Gain', 'Gain', 's')}</div>
        <div class="stack">{@render knob('Env Attack', 'Attack', 'm')}{@render knob('Env Release', 'Release', 'm')}</div>
        <div class="stack">{@render knob('Env Freq', 'Freq', 's')}{@render knob('Env Width', 'Width', 's')}</div>
        {@render sw('Env Hold On', 'Hold')}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'noise'}
  {@const mode = step('Noise Mode')}
  <BoardTile title="Noise" ink={ink.primary}>
    <FaceGrid sections={[2]} heads={false}>
      <FaceSection span={2}>
        <div class="stack">{@render pick('Noise Type', ROAR_NOISES, 'Noise type', 'Type')}{@render pick('Noise Mode', ROAR_RATE_MODES, 'Noise rate mode', 'Rate')}</div>
        <div class="stack">{@render knob(roarRateParam('Noise', mode), rateTitle(mode), 'm')}{@render knob('Noise Smooth', 'Smooth', 's')}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{/if}
</div>

<style>
  .roar-page {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
  }
  .roar-page > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
  /* A column of controls sharing its height evenly. */
  .stack {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
  }
  .stack > :global(*) {
    flex: 1 1 0;
    min-height: 0;
  }
  .cell {
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  /* A switch or a pick is one touch-height row, centred in its cell, so it
     lines up with the knob beside it rather than filling the column. */
  .sw-cell {
    display: flex;
    align-items: center;
  }
  .switch {
    width: 100%;
    height: var(--height-touch);
    font-size: 0.8125rem;
  }
  /* A stage on the band: the types with their switches, then the knobs,
     two rows on the section's columns. */
  .stage-grid {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: var(--height-touch) minmax(0, 1fr);
    row-gap: var(--spacing-sm);
    min-height: 0;
  }
  /* The routing on the band: its pick over Blend, or the crossovers. */
  .routing-face {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: var(--height-touch) minmax(0, 1fr);
    row-gap: var(--spacing-sm);
    min-height: 0;
  }
  .routing-face > :global(*) {
    min-width: 0;
    min-height: 0;
  }
  .span-2-cell.tall {
    align-items: stretch;
  }
  .span-2-cell.tall > :global(*) {
    height: 100%;
  }
  .stage-grid > :global(*) {
    min-width: 0;
    min-height: 0;
  }
  .span-3 {
    grid-column: span 3;
    display: flex;
    align-items: center;
  }
  .span-3 > :global(*),
  .span-2-cell > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
  .span-2-cell {
    grid-column: span 2;
    display: flex;
    align-items: center;
  }
  /* A stage on the board: types, then two rows of knobs. */
  .stage-board {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: var(--height-touch) minmax(0, 0.8fr) minmax(0, 1.2fr) var(--height-touch);
    row-gap: var(--spacing-sm);
    min-height: 0;
  }
  .stage-board > .picture {
    align-items: stretch;
  }
  .stage-board > .picture > :global(*) {
    height: 100%;
  }
  /* In a shared column the higher rank takes the larger share (ADR-515). */
  .stack > .rank-xl { flex-grow: 2; }
  .stack > .rank-l { flex-grow: 1.6; }
  .stack > .rank-m { flex-grow: 1.25; }
  /* The routing on the board: its pick over Blend or the crossovers. */
  .routing-board {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: var(--height-touch) minmax(0, 1fr);
    row-gap: var(--spacing-sm);
    min-height: 0;
  }
  .stage-board > :global(*),
  .routing-board > :global(*) {
    min-width: 0;
    min-height: 0;
  }
  /* Two switches where a knob would be, centred as a pair. */
  .stack.sw-pair {
    justify-content: center;
  }
  .stack.sw-pair > :global(*) {
    flex: none;
  }
  /* In a stack of touch rows, the knob takes what they leave. */
  .stack > .grow {
    flex: 1 1 0;
    min-height: 0;
  }
  .stack > .sw-cell,
  .stack > :global(.sw-cell) {
    flex: none;
    height: var(--height-touch);
  }
  .span-2-cell > :global(.sw-cell) {
    height: var(--height-touch);
  }

  .sub {
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1rem;
    white-space: nowrap;
  }
</style>
