<script lang="ts">
  /**
   * Wavetable's section pages, each hand-laid on the face grid (ADR-510,
   * user 2026-11-06, Drift's pages the model): equal columns on a page,
   * identical seams, one header line whose first section carries the way
   * back ("‹ Osc 1"), every knob at its ADR-509 size, large wherever a
   * knob has its column to itself. They replace the rule-laid panel pages
   * (`panel/wavetablePanel.ts`), whose groups each took their own width,
   * left a third of the band empty and clamped their knobs.
   *
   * Every control binds a parameter by Live's name
   * (docs/reference/instruments/Wavetable.md) through `usePanelParams`, and
   * a control in a section with a switch writes through it as the panel
   * did: touching it while the section is off turns the section on first.
   *
   * Pages: `osc1` / `osc2`, `filter1` / `filter2`, `mod` (the modulation
   * sources, each section's name opening its own page), `amp`, `env2`,
   * `env3`, `lfo1`, `lfo2` (whose way back is `mod`), and `global`.
   *
   * On the full-screen board (`board`, ADR-512) every page is a tile at
   * once: a page's way back is its plain name, and Amp, the LFOs and Global
   * stack two knobs to a column so a row holds more of them; a loop mode is
   * a `ChoicePicker`, its tab too narrow for a board column.
   */
  import type { Snippet } from 'svelte';
  import DeviceSlider from '../../../device-panel/DeviceSlider.svelte';
  import ScrubTabs from '../../../device-panel/ScrubTabs.svelte';
  import FaceGrid from '../../FaceGrid.svelte';
  import FaceSection from '../../FaceSection.svelte';
  import FaceSeam from '../../FaceSeam.svelte';
  import ChoicePicker from '../../ChoicePicker.svelte';
  import DeviceXY from '../../../device-panel/DeviceXY.svelte';
  import EnvelopeGraph from '../../EnvelopeGraph.svelte';
  import LfoGraph from '../../LfoGraph.svelte';
  import { liveFilterCurve, FILTER_FREQ_RANGE } from '$lib/utils/instrumentFilterCurves';
  import type { PanelParams } from '../panel/usePanelParams.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';

  interface Props {
    page: string;
    params: PanelParams;
    ink: DeviceColorScheme;
    /** Each oscillator's own colour, as on the face (Osc 1 orange, Osc 2 blue). */
    oscInks: { 1: DeviceColorScheme; 2: DeviceColorScheme };
    /** Opens another page (the mod sources' sections), or the face with null. */
    onNavigate: (page: string | null) => void;
    /** The oscillator's pad: Effect 2 across, Wave Position up, its wave drawn under it. */
    oscPad: Snippet<[1 | 2]>;
    /** Effect 1's and Effect 2's names under the oscillator's effect mode. */
    effectTitles: (osc: 1 | 2) => readonly [string, string];
    /**
     * A tile of the full-screen board (ADR-512): every page is on screen, so
     * a page's way back is its plain name and a section's link is its name.
     */
    board?: boolean;
    /**
     * The oscillator's wavetable as two choices, Live's category and the
     * table in it, and their writers: the board's Osc pages draw a chooser
     * of each (user, 2026-11-07).
     */
    tables?: {
      choice: (osc: 1 | 2) => { categories: string[]; category: number; tables: string[]; table: number };
      setCategory: (osc: 1 | 2, index: number) => void;
      setTable: (osc: 1 | 2, index: number) => void;
    };
  }

  let { page, params, ink, oscInks, onNavigate, oscPad, effectTitles, board = false, tables }: Props = $props();

  const TITLES: Record<string, string> = {
    osc1: 'Osc 1', osc2: 'Osc 2', filter1: 'Filter 1', filter2: 'Filter 2', mod: 'Mod Sources',
    amp: 'Amp', env2: 'Env 2', env3: 'Env 3', lfo1: 'LFO 1', lfo2: 'LFO 2', global: 'Global'
  };
  /** Where a page's "‹" leads: the mod sources' own pages lead back to them. */
  const PARENT: Record<string, string> = { amp: 'mod', env2: 'mod', env3: 'mod', lfo1: 'mod', lfo2: 'mod' };

  // Live's own lists (panel/wavetablePanel.ts, from the device dump).
  const FILTER_TYPES = ['LP', 'HP', 'BP', 'Notch', 'Morph'];
  const LP_HP_CIRCUITS = ['Clean', 'OSR', 'MS2', 'SMP', 'PRD'];
  const BP_CIRCUITS = ['Clean', 'OSR'];
  const LOOP_MODES = ['None', 'Trigger', 'Loop'];
  const LFO_WAVES = ['Sine', 'Tri', 'Saw', 'Rect', 'Noise'];
  const SYNCED = [
    '8', '6', '4', '3', '2', '1.5', '1', '3/4', '1/2', '3/8', '1/3',
    '5/16', '1/4', '3/16', '1/6', '1/8', '1/12', '1/16', '1/24', '1/32', '1/48', '1/64'
  ];
  /** The LFO's five shapes as pictures, on the face's 24 x 12 glyph box. */
  const LFO_GLYPHS: Record<string, string> = {
    Sine: 'M0 6 Q3 0 6 6 T12 6 T18 6 T24 6',
    Tri: 'M0 6 L3 2 L9 10 L15 2 L21 10 L24 6',
    Saw: 'M0 10 L10 2 L10 10 L20 2 L20 10',
    Rect: 'M0 10 L0 2 L6 2 L6 10 L12 10 L12 2 L18 2 L18 10 L24 10',
    Noise: 'M0 7 L4 7 L4 3 L8 3 L8 9 L12 9 L12 5 L16 5 L16 10 L20 10 L20 4 L24 4'
  };
  /** Controls whose zero is the middle of their range: draw from the top. */
  const BIPOLAR = /(Detune|Pan|Transp|Transpose|^Time)$/;

  const lo = (p: string) => params.range(p)?.min ?? 0;
  const hi = (p: string) => params.range(p)?.max ?? 1;
  const step = (p: string) => {
    const v = params.raw(p);
    return v === undefined ? -1 : Math.round(v - lo(p));
  };
  const isOn = (p: string) => params.has(p) && (params.raw(p) ?? 0) >= 0.5;

  let title = $derived(TITLES[page] ?? page);
  /** The page's oscillator, filter, envelope or LFO number. */
  let n = $derived(Number(page.replace(/\D/g, '')) as 1 | 2 | 3);
  let O = $derived(`Osc ${n}`);
  let F = $derived(`Flt ${n}`);
  let E = $derived(page === 'amp' ? 'Amp' : `Env ${n}`);
  let L = $derived(`LFO ${n}`);
  let oscInk = $derived(n === 2 ? oscInks[2] : oscInks[1]);
  let fx = $derived(effectTitles(n === 2 ? 2 : 1));
  /** The filter's circuit list follows its type: LP and HP have five, the rest two. */
  let lpHp = $derived(step(`${F} Type`) <= 1);
  let lfoTempo = $derived(step(`${L} Sync`) === 1);
</script>

<!-- A knob bound by name, at its size; `sw` is the section's switch, which
     a write turns on first and whose off state ghosts the knob. -->
{#snippet knob(param: string, title: string, size: 's' | 'm' | 'l', opts: { sw?: string; color?: DeviceColorScheme; steps?: number; labels?: readonly string[] } = {})}
  {@const l = lo(param)}
  {@const h = hi(param)}
  {@const bipolar = BIPOLAR.test(param)}
  {@const raw = params.raw(param)}
  <div class="cell rank-{size}" data-param={param}>
    <DeviceSlider
      value={raw ?? l}
      {title}
      face="knob"
      knobSize={size}
      min={l}
      max={h}
      centerOrigin={bipolar}
      centerValue={bipolar ? (l + h) / 2 : undefined}
      steps={opts.steps}
      valueText={opts.labels && raw !== undefined ? opts.labels[Math.round(raw - l)] : undefined}
      orientation="vertical"
      labelSize="small"
      isGhost={!params.has(param) || (opts.sw !== undefined && !params.isOn(opts.sw))}
      color={opts.color ?? ink}
      readout={params.display(param)}
      onInteraction={(v) => params.write(param, opts.steps ? Math.round(v) : v, opts.sw)}
    />
  </div>
{/snippet}

{#snippet lfoGlyph(label: string)}
  <svg class="lfo-glyph" viewBox="0 0 24 12" role="img" aria-label={label}>
    <path d={LFO_GLYPHS[label] ?? ''} fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
  </svg>
{/snippet}

<!-- A pick of named values, scrubbed: `cols` across, filling its cell. -->
{#snippet tab(param: string, labels: readonly string[], opts: { cols?: number; sw?: string; color?: string; glyph?: boolean; row?: boolean } = {})}
  <div class="cell panel-choice" class:row={opts.row} class:dim={opts.sw !== undefined && !params.isOn(opts.sw)} data-param={param}>
  <ScrubTabs
    options={labels.map((_, i) => i)}
    selected={step(param)}
    onSelect={(i) => params.write(param, lo(param) + i, opts.sw)}
    cols={opts.cols ?? 1}
    tint={opts.color ?? ink.primary}
    inked
    ghost={!params.has(param)}
    label={(i) => labels[i]}
    groupLabel={param}
    style="height: 100%; --scrub-font-size: 0.75rem;"
  >
    {#snippet item(i)}{#if opts.glyph}{@render lfoGlyph(labels[i])}{:else}{labels[i]}{/if}{/snippet}
  </ScrubTabs>
  </div>
{/snippet}

<!-- An on/off parameter: one touch row, centred in its cell, lit while on. -->
{#snippet sw(param: string, title: string, color: string = ink.primary)}
  {@const on = isOn(param)}
  <div class="cell sw-cell">
  <button
    class="physical-button btn-toggle switch"
    class:active={on}
    aria-pressed={on}
    disabled={!params.has(param)}
    style="--btn-tint: {color};"
    data-param={param}
    onclick={() => params.write(param, on ? lo(param) : hi(param))}
  >{title}</button>
  </div>
{/snippet}

<!-- A pick as a button naming the value, opening the values over the
     view: a board tile's column is too narrow for its tab. -->
{#snippet pick(param: string, labels: readonly string[], title: string)}
  <div class="cell sw-cell" data-param={param}>
    <ChoicePicker options={labels} selected={params.has(param) ? step(param) : undefined} onSelect={(i) => params.write(param, lo(param) + i)} label={title} tint={ink.primary} ghost={!params.has(param)} />
  </div>
{/snippet}

{#snippet back(color: string = ink.primary)}
  {#if board}
    <span class="sub" style="color: {color};">{title}</span>
  {:else}
    <button class="page-back" style="color: {color};" onclick={() => onNavigate(PARENT[page] ?? null)}>‹ {title}</button>
  {/if}
{/snippet}

{#snippet sub(text: string, color: string = ink.primary)}<span class="sub" style="color: {color};">{text}</span>{/snippet}

<div class="wt-page" data-wavetable-page={page}>
{#if (page === 'osc1' || page === 'osc2') && board && tables}
  <!-- On the board (ADR-512) the page's eight columns, the wavetable's
       picks one touch row across the oscillator's six, its category beside
       its table, each naming it (user, 2026-11-07); the pad and the knobs
       under them. Picking a category puts the oscillator on that
       category's first table, as Live does. -->
  {@const osc = n === 2 ? 2 : 1}
  {@const t = tables.choice(osc)}
  <FaceGrid sections={[6, 2]}>
    <FaceSection span={6}>
      {#snippet head()}{@render back(oscInk.primary)}{/snippet}
      <div class="face-span-all osc-board">
        <div class="choosers" data-wavetable-choosers={osc}>
          <ChoicePicker options={t.categories} selected={t.category} onSelect={(i) => tables.setCategory(osc, i)} label="Osc {osc} wavetable category" tint={oscInk.primary} ghost={t.categories.length === 0} />
          <ChoicePicker options={t.tables} selected={t.table} onSelect={(i) => tables.setTable(osc, i)} label="Osc {osc} wavetable" tint={oscInk.primary} ghost={t.tables.length === 0} />
        </div>
        <div class="face-span-3 pad" style={isOn(`${O} On`) ? '' : 'opacity: var(--opacity-ghost);'}>{@render oscPad(osc)}</div>
        <div class="stack">{@render knob(`${O} Effect 1`, fx[0], 'l', { sw: `${O} On`, color: oscInk })}{@render knob(`${O} Transp`, 'Semi', 's', { sw: `${O} On`, color: oscInk })}</div>
        <div class="stack">{@render knob(`${O} Detune`, 'Detune', 'm', { sw: `${O} On`, color: oscInk })}{@render knob(`${O} Pan`, 'Pan', 's', { sw: `${O} On`, color: oscInk })}</div>
        <div class="stack">{@render knob(`${O} Gain`, 'Gain', 'l', { sw: `${O} On`, color: oscInk })}{@render sw(`${O} On`, 'On', oscInk.primary)}</div>
      </div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render sub('Sub')}{/snippet}
      <div class="stack">{@render knob('Sub Gain', 'Gain', 'm', { sw: 'Sub On' })}{@render sw('Sub On', 'On')}</div>
      <div class="stack">{@render knob('Sub Tone', 'Tone', 's', { sw: 'Sub On' })}{@render tab('Sub Transpose', ['0', '-1', '-2'], { cols: 3, sw: 'Sub On', row: true })}</div>
    </FaceSection>
  </FaceGrid>
{:else if (page === 'filter1' || page === 'filter2') && board}
  <!-- On the board (ADR-512) the filter's cutoff and resonance are one pad,
       Freq across and Res up, its curve drawn (user, 2026-11-07: a filter
       on the full screen is an XY, not two knobs); then Drive and Morph,
       and the type, its circuit and the slope over the filter's switch. -->
  {@const fInk = n === 2 ? oscInks[2] : oscInks[1]}
  {@const curve = liveFilterCurve(step(`${F} Type`), step(`${F} Slope`), params.unit(`${F} Morph`) ?? 0)}
  <FaceGrid sections={[4, 3]}>
    <FaceSection span={4}>
      {#snippet head()}{@render back(fInk.primary)}{/snippet}
      <div class="face-span-2 pad" data-filter-pad={n}>
        <DeviceXY
          xValue={params.unit(`${F} Freq`) ?? 1}
          yValue={params.unit(`${F} Res`) ?? 0}
          title="Filter {n}"
          titleAt="bottom"
          showCurve={isOn(`${F} On`)}
          curveType={curve.curveType}
          curveOrder={curve.order}
          curveFreqRange={FILTER_FREQ_RANGE.wavetable}
          onInteraction={(x, y) => {
            params.writeUnit(`${F} Freq`, x, `${F} On`);
            params.writeUnit(`${F} Res`, y, `${F} On`);
          }}
          color={fInk}
        />
      </div>
      {@render knob(`${F} Drive`, 'Drive', 'm', { sw: `${F} On` })}
      {@render knob(`${F} Morph`, 'Morph', 'm', { sw: `${F} On` })}
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={3}>
      {#snippet head()}{@render sub('Type · Circuit · Slope')}{/snippet}
      {@render tab(`${F} Type`, FILTER_TYPES, { sw: `${F} On` })}
      {#if lpHp}
        {@render tab(`${F} LP/HP`, LP_HP_CIRCUITS, { sw: `${F} On` })}
      {:else}
        {@render tab(`${F} BP/NO/MO`, BP_CIRCUITS, { sw: `${F} On` })}
      {/if}
      <div class="column">
        <div class="grow">{@render tab(`${F} Slope`, ['12 dB', '24 dB'], { sw: `${F} On` })}</div>
        {@render sw(`${F} On`, 'On')}
      </div>
    </FaceSection>
  </FaceGrid>
{:else if page === 'amp' && board}
  <!-- On the board (ADR-514) the envelope is Live's picture over its small
       Attack, Decay, Sustain and Release knobs; the three slopes and the
       loop mode a column beside it. -->
  <FaceGrid sections={[3, 1]}>
    <FaceSection span={3}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="face-span-all"><EnvelopeGraph {params} ink={ink.primary} names={{ attack: 'Amp Attack', decay: 'Amp Decay', sustain: 'Amp Sustain', release: 'Amp Release' }} /></div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render sub('Slope')}{/snippet}
      <div class="stack">{@render knob('Amp A Slope', 'A', 's')}{@render knob('Amp D Slope', 'D', 's')}{@render knob('Amp R Slope', 'R', 's')}{@render pick('Amp Loop Mode', LOOP_MODES, 'Amp loop')}</div>
    </FaceSection>
  </FaceGrid>
{:else if (page === 'env2' || page === 'env3') && board}
  <!-- As Amp: the picture carries the times and all four levels (Initial,
       Peak, Sustain, Final), its stage knobs under it, the slopes and loop
       mode a column beside it. -->
  <FaceGrid sections={[3, 1]}>
    <FaceSection span={3}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="face-span-all"><EnvelopeGraph {params} ink={ink.primary} names={{ attack: `${E} Attack`, decay: `${E} Decay`, sustain: `${E} Sustain`, release: `${E} Release`, initial: `${E} Initial`, peak: `${E} Peak`, final: `${E} Final` }} /></div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render sub('Slope')}{/snippet}
      <div class="stack">{@render knob(`${E} A Slope`, 'A', 's')}{@render knob(`${E} D Slope`, 'D', 's')}{@render knob(`${E} R Slope`, 'R', 's')}{@render pick(`${E} Loop Mode`, LOOP_MODES, `${E} loop`)}</div>
    </FaceSection>
  </FaceGrid>
{:else if (page === 'lfo1' || page === 'lfo2') && board}
  <!-- On the board (ADR-514) the LFO's wave across the tile, rate across
       and amount up; the shapes, the sync and Retrig one touch row under it,
       then the knobs. -->
  <FaceGrid sections={[5]}>
    <FaceSection span={5}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="face-span-all graph-board" style="--graph-rows: minmax(0, 0.5fr) auto minmax(0, 1.5fr);">
        <div class="graph">
          <LfoGraph {params} ink={ink.primary} shape={LFO_WAVES[step(`${L} Wave`)]} rate={lfoTempo ? `${L} Synced` : `${L} Freq`} amount={`${L} Amount`} />
        </div>
        <div class="span-2 touch-row">{@render tab(`${L} Wave`, LFO_WAVES, { glyph: true, cols: 5 })}</div>
        <div class="span-2 touch-row">{@render tab(`${L} Sync`, ['Free', 'Tempo'], { cols: 2 })}</div>
        {@render sw(`${L} Retrig On`, 'Retrig')}
        {#if lfoTempo}
          {@render knob(`${L} Synced`, 'Sync', 'l', { steps: SYNCED.length, labels: SYNCED })}
        {:else}
          {@render knob(`${L} Freq`, 'Rate', 'l')}
        {/if}
        {@render knob(`${L} Amount`, 'Amount', 'l')}
        {@render knob(`${L} Morph`, 'Morph', 's')}
        {@render knob(`${L} Offset`, 'Offset', 's')}
        {@render knob(`${L} Attack`, 'Attack', 's')}
      </div>
    </FaceSection>
  </FaceGrid>
{:else if page === 'global' && board}
  <!-- On the board (ADR-512) three columns, two knobs to a column. -->
  <FaceGrid sections={[3]}>
    <FaceSection span={3}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="stack">{@render knob('Volume', 'Volume', 'l')}{@render knob('Transpose', 'Transp', 's')}</div>
      <div class="stack">{@render knob('Unison Amount', 'Unison', 'm')}{@render knob('Glide', 'Glide', 's')}</div>
      <div class="stack">{@render knob('Time', 'Time', 's')}{@render knob('Global Mod Amount', 'Mod Amt', 's')}</div>
    </FaceSection>
  </FaceGrid>
{/if}
</div>

<style>
  .wt-page {
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  /* A column of controls sharing its height evenly. */
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
  }
  .stack > :global(*) {
    flex: 1 1 0;
    min-height: 0;
  }
  /* In a shared column the higher rank takes the larger share (ADR-515). */
  .stack > :global(.rank-l) { flex-grow: 1.6; }
  .stack > :global(.rank-m) { flex-grow: 1.25; }
  /* A tab over a switch: the tab takes what the switch's row leaves. */
  .column {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
  }
  .column > .grow {
    flex: 1 1 0;
    min-height: 0;
  }
  .column > :global(.sw-cell) {
    flex: none;
    height: var(--height-touch);
  }
  .cell {
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  .pad {
    min-height: 0;
    min-width: 0;
  }
  /* The board's oscillator: the wavetable's two picks one touch row across
     the section's columns, the pad and the knobs on those columns under. */
  .osc-board {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: auto minmax(0, 1fr);
    row-gap: var(--spacing-sm);
  }
  .osc-board > * {
    min-width: 0;
    min-height: 0;
  }
  .osc-board > .face-span-3 {
    grid-column: span 3;
  }
  .choosers {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--spacing-sm);
  }
  .touch-row {
    height: var(--height-touch);
  }
  /* A tab of a few values beside a knob is one touch row, centred. */
  .panel-choice.row {
    display: flex;
    align-items: center;
  }
  .panel-choice.row > :global(*) {
    height: var(--height-touch) !important;
    width: 100%;
  }
  .dim {
    opacity: var(--opacity-ghost);
  }
  .lfo-glyph {
    width: 100%;
    height: 100%;
    max-height: 22px;
  }
  /* A switch is one touch-height button, centred in its cell. */
  .sw-cell {
    display: flex;
    align-items: center;
  }
  .switch {
    width: 100%;
    height: var(--height-touch);
    font-size: 0.8125rem;
  }
  /* The header line: the page's way back, then section names. */
  .page-back,
  .sub {
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1rem;
    white-space: nowrap;
  }
  .page-back {
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
