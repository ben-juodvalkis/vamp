<script lang="ts">
  /**
   * Wavetable's board tiles (ADR-512, ADR-513), each a `BoardTile` panel
   * (ADR-516) hand-laid on the face grid (ADR-510): a header bar naming
   * the section in its ink with the section's switch at its right, then
   * equal columns, every knob at its ADR-509 size, large wherever a knob
   * has its column to itself.
   *
   * Every control binds a parameter by Live's name
   * (docs/reference/instruments/Wavetable.md) through `usePanelParams`, and
   * a control in a section with a switch writes through it as the panel
   * did: touching it while the section is off turns the section on first.
   *
   * Tiles: `osc1` / `osc2` (the oscillator's wavetable picks on its bar,
   * the pad and its knobs under), `sub` (drawn once, between the two
   * oscillators' row and the filters'), `filter1` / `filter2`, `routing`
   * (Serial, Parallel or Split, between the two filters), `amp`, `env2`,
   * `env3`, `lfo1`, `lfo2` and `global`.
   */
  import type { Snippet } from 'svelte';
  import DeviceSlider from '../../../device-panel/DeviceSlider.svelte';
  import ScrubTabs from '../../../device-panel/ScrubTabs.svelte';
  import FaceGrid from '../../FaceGrid.svelte';
  import FaceSection from '../../FaceSection.svelte';
  import FaceSeam from '../../FaceSeam.svelte';
  import BoardTile from '../../BoardTile.svelte';
  import ChoicePicker from '../../ChoicePicker.svelte';
  import DeviceXY from '../../../device-panel/DeviceXY.svelte';
  import EnvelopeGraph from '../../EnvelopeGraph.svelte';
  import LfoGraph from '../../LfoGraph.svelte';
  import { liveFilterCurve, FILTER_FREQ_RANGE } from '$lib/utils/instrumentFilterCurves';
  import { FILTER_ROUTINGS } from '$lib/utils/wavetableFilterGraph';
  import type { PanelParams } from '../panel/usePanelParams.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';

  interface Props {
    page: string;
    params: PanelParams;
    ink: DeviceColorScheme;
    /** Each oscillator's own colour, as on the face (Osc 1 orange, Osc 2 blue). */
    oscInks: { 1: DeviceColorScheme; 2: DeviceColorScheme };
    /** The oscillator's pad: Effect 2 across, Wave Position up, its wave drawn under it. */
    oscPad: Snippet<[1 | 2]>;
    /** Effect 1's and Effect 2's names under the oscillator's effect mode. */
    effectTitles: (osc: 1 | 2) => readonly [string, string];
    /**
     * The oscillator's wavetable as two choices, Live's category and the
     * table in it, and their writers: on the Osc tiles' bars (user, 2026-11-07).
     */
    tables?: {
      choice: (osc: 1 | 2) => { categories: string[]; category: number; tables: string[]; table: number };
      setCategory: (osc: 1 | 2, index: number) => void;
      setTable: (osc: 1 | 2, index: number) => void;
    };
    /** The filters' routing (`filter_routing`: Serial 0, Parallel 1, Split 2) and its writer. */
    routing?: { value: number; set: (index: number) => void };
  }

  let { page, params, ink, oscInks, oscPad, effectTitles, tables, routing }: Props = $props();

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
  /** Flips an on/off parameter (a tile's bar switch). */
  const flip = (p: string) => params.write(p, isOn(p) ? lo(p) : hi(p));

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
{#snippet knob(param: string, title: string, size: 's' | 'm' | 'l' | 'xl', opts: { sw?: string; color?: DeviceColorScheme; steps?: number; labels?: readonly string[] } = {})}
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
    onclick={() => flip(param)}
  >{title}</button>
  </div>
{/snippet}

<!-- A pick as a field naming the value, its own name over it, opening the
     values over the view: a board tile's column is too narrow for its tab. -->
{#snippet pick(param: string, labels: readonly string[], title: string, caption: string)}
  <div class="cell sw-cell" data-param={param}>
    <ChoicePicker options={labels} selected={params.has(param) ? step(param) : undefined} onSelect={(i) => params.write(param, lo(param) + i)} label={title} {caption} tint={ink.primary} ghost={!params.has(param)} />
  </div>
{/snippet}

<!-- A section's header line: a name over each run of columns. -->
{#snippet heads(items: readonly (readonly [string, number])[], color: string = ink.primary)}
  <div class="col-heads" style="grid-template-columns: repeat({items.reduce((n, [, span]) => n + span, 0)}, minmax(0, 1fr));">
    {#each items as [text, span], i (i)}<span class="sub" style="color: {color}; grid-column: span {span};">{text}</span>{/each}
  </div>
{/snippet}

<!-- An envelope's tile (ADR-514): Live's picture over its small stage knobs,
     the three slopes one column beside it (its loop mode is on the bar). -->
{#snippet envelope(prefix: string, levels: boolean)}
  <FaceGrid sections={[5, 1]} heads={false}>
    <FaceSection span={5}>
      <div class="face-span-all">
        <EnvelopeGraph
          {params}
          ink={ink.primary}
          names={levels
            ? { attack: `${prefix} Attack`, decay: `${prefix} Decay`, sustain: `${prefix} Sustain`, release: `${prefix} Release`, initial: `${prefix} Initial`, peak: `${prefix} Peak`, final: `${prefix} Final` }
            : { attack: `${prefix} Attack`, decay: `${prefix} Decay`, sustain: `${prefix} Sustain`, release: `${prefix} Release` }}
        />
      </div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      <div class="stack">{@render knob(`${prefix} A Slope`, 'A Slope', 's')}{@render knob(`${prefix} D Slope`, 'D Slope', 's')}{@render knob(`${prefix} R Slope`, 'R Slope', 's')}</div>
    </FaceSection>
  </FaceGrid>
{/snippet}

<div class="wt-page" data-wavetable-page={page}>
{#if (page === 'osc1' || page === 'osc2') && tables}
  <!-- The oscillator (ADR-516): its wavetable's two picks on the bar, each
       naming itself, with its switch; under them the wave across the tile, as
       Live draws it (2026-11-08; three columns of seven until then), over one
       row of knobs. Picking a category puts the oscillator on that category's
       first table, as Live does. -->
  {@const osc = n === 2 ? 2 : 1}
  {@const t = tables.choice(osc)}
  <BoardTile title="Osc {osc}" ink={oscInk.primary} on={isOn(`${O} On`)} onToggle={() => flip(`${O} On`)} switchParam="{O} On" switchDisabled={!params.has(`${O} On`)}>
    {#snippet tools()}
      <div class="choosers" data-wavetable-choosers={osc}>
        <ChoicePicker options={t.categories} selected={t.category} onSelect={(i) => tables.setCategory(osc, i)} label="Osc {osc} wavetable category" caption="Category" tint={oscInk.primary} ghost={t.categories.length === 0} />
        <ChoicePicker options={t.tables} selected={t.table} onSelect={(i) => tables.setTable(osc, i)} label="Osc {osc} wavetable" caption="Table" tint={oscInk.primary} ghost={t.tables.length === 0} />
      </div>
    {/snippet}
    <FaceGrid sections={[7]} heads={false}>
      <FaceSection span={7}>
        <div class="face-span-all picture-over-knobs" style="--knob-cols: 5;">
          <div class="pad over" style={isOn(`${O} On`) ? '' : 'opacity: var(--opacity-ghost);'}>{@render oscPad(osc)}</div>
          {@render knob(`${O} Effect 1`, fx[0], 'm', { sw: `${O} On`, color: oscInk })}
          {@render knob(`${O} Detune`, 'Detune', 's', { sw: `${O} On`, color: oscInk })}
          {@render knob(`${O} Transp`, 'Semi', 's', { sw: `${O} On`, color: oscInk })}
          {@render knob(`${O} Gain`, 'Gain', 'm', { sw: `${O} On`, color: oscInk })}
          {@render knob(`${O} Pan`, 'Pan', 's', { sw: `${O} On`, color: oscInk })}
        </div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'sub'}
  <!-- The sub oscillator, once (it was drawn on both oscillators' tiles):
       its gain the lead, its tone over its octave. -->
  <BoardTile title="Sub" ink={ink.primary} on={isOn('Sub On')} onToggle={() => flip('Sub On')} switchParam="Sub On" switchDisabled={!params.has('Sub On')}>
    <FaceGrid sections={[2]} heads={false}>
      <FaceSection span={2}>
        {@render knob('Sub Gain', 'Gain', 'l', { sw: 'Sub On' })}
        <div class="stack">{@render knob('Sub Tone', 'Tone', 's', { sw: 'Sub On' })}{@render tab('Sub Transpose', ['0', '-1', '-2'], { cols: 3, sw: 'Sub On', row: true })}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'filter1' || page === 'filter2'}
  <!-- The filter: its cutoff and resonance one pad, Freq across and Res up,
       its curve drawn (user, 2026-11-07); Drive and Morph beside it; then
       the type, its circuit and the slope, each a column named over it. -->
  {@const fInk = n === 2 ? oscInks[2] : oscInks[1]}
  {@const curve = liveFilterCurve(step(`${F} Type`), step(`${F} Slope`), params.unit(`${F} Morph`) ?? 0)}
  <BoardTile title="Filter {n}" ink={fInk.primary} on={isOn(`${F} On`)} onToggle={() => flip(`${F} On`)} switchParam="{F} On" switchDisabled={!params.has(`${F} On`)}>
    <FaceGrid sections={[4, 3]}>
      <FaceSection span={4}>
        <div class="face-span-3 pad" data-filter-pad={n}>
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
        <div class="stack">{@render knob(`${F} Drive`, 'Drive', 's', { sw: `${F} On` })}{@render knob(`${F} Morph`, 'Morph', 's', { sw: `${F} On` })}</div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={3}>
        {#snippet head()}{@render heads([['Type', 1], ['Circuit', 1], ['Slope', 1]])}{/snippet}
        {@render tab(`${F} Type`, FILTER_TYPES, { sw: `${F} On` })}
        {#if lpHp}
          {@render tab(`${F} LP/HP`, LP_HP_CIRCUITS, { sw: `${F} On` })}
        {:else}
          {@render tab(`${F} BP/NO/MO`, BP_CIRCUITS, { sw: `${F} On` })}
        {/if}
        {@render tab(`${F} Slope`, ['12 dB', '24 dB'], { sw: `${F} On` })}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'routing' && routing}
  <!-- How the two filters are joined (Live's `filter_routing`), between
       them: Serial, Parallel or Split, one tab down the tile. -->
  <BoardTile title="Routing" ink={ink.primary}>
    <FaceGrid sections={[1]} heads={false}>
      <FaceSection span={1}>
        <div class="cell panel-choice" data-filter-routing>
          <ScrubTabs
            options={FILTER_ROUTINGS.map((_, i) => i)}
            selected={routing.value}
            onSelect={(i) => routing.set(i)}
            cols={1}
            tint={ink.primary}
            inked
            label={(i) => `Filter routing ${FILTER_ROUTINGS[i]}`}
            groupLabel="Filter routing"
            style="height: 100%; --scrub-font-size: 0.75rem;"
          >
            {#snippet item(i)}{FILTER_ROUTINGS[i]}{/snippet}
          </ScrubTabs>
        </div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'amp'}
  <BoardTile title="Amp Envelope" ink={ink.primary}>
    {#snippet tools()}{@render pick('Amp Loop Mode', LOOP_MODES, 'Amp loop', 'Loop')}{/snippet}
    {@render envelope('Amp', false)}
  </BoardTile>
{:else if page === 'env2' || page === 'env3'}
  <!-- As Amp: the picture carries the times and all four levels (Initial,
       Peak, Sustain, Final). -->
  <BoardTile title="Envelope {n}" ink={ink.primary}>
    {#snippet tools()}{@render pick(`${E} Loop Mode`, LOOP_MODES, `${E} loop`, 'Loop')}{/snippet}
    {@render envelope(E, true)}
  </BoardTile>
{:else if page === 'lfo1' || page === 'lfo2'}
  <!-- The LFO (ADR-514): the shapes, the sync and Retrig on the bar, so the
       wave has the body (rate across and amount up), over one row of knobs. -->
  <BoardTile title="LFO {n}" ink={ink.primary}>
    {#snippet tools()}
      <div class="bar-tools">
        <div class="bar-wave">{@render tab(`${L} Wave`, LFO_WAVES, { glyph: true, cols: 5 })}</div>
        <div class="bar-sync">{@render tab(`${L} Sync`, ['Free', 'Tempo'], { cols: 2 })}</div>
        <div class="bar-retrig">{@render sw(`${L} Retrig On`, 'Retrig')}</div>
      </div>
    {/snippet}
    <FaceGrid sections={[5]} heads={false}>
      <FaceSection span={5}>
        <div class="face-span-all picture-over-knobs" style="--knob-cols: 5;">
          <div class="over">
            <LfoGraph {params} ink={ink.primary} shape={LFO_WAVES[step(`${L} Wave`)]} rate={lfoTempo ? `${L} Synced` : `${L} Freq`} amount={`${L} Amount`} />
          </div>
          {#if lfoTempo}
            {@render knob(`${L} Synced`, 'Sync', 'm', { steps: SYNCED.length, labels: SYNCED })}
          {:else}
            {@render knob(`${L} Freq`, 'Rate', 'm')}
          {/if}
          {@render knob(`${L} Amount`, 'Amount', 'm')}
          {@render knob(`${L} Morph`, 'Morph', 's')}
          {@render knob(`${L} Offset`, 'Offset', 's')}
          {@render knob(`${L} Attack`, 'Attack', 's')}
        </div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'global'}
  <!-- Volume, the lead, a column to itself; the rest two to a column,
       alike in rank. -->
  <BoardTile title="Global" ink={ink.primary}>
    <FaceGrid sections={[4]} heads={false}>
      <FaceSection span={4}>
        {@render knob('Volume', 'Volume', 'l')}
        <div class="stack">{@render knob('Unison Amount', 'Unison', 'm')}{@render knob('Glide', 'Glide', 'm')}</div>
        <div class="stack">{@render knob('Transpose', 'Transp', 's')}{@render knob('Time', 'Time', 's')}</div>
        {@render knob('Global Mod Amount', 'Mod Amt', 's')}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{/if}
</div>

<style>
  .wt-page {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
  }
  .wt-page > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
  /* A picture across the tile, on all the height one row of knobs leaves. */
  .picture-over-knobs {
    display: grid;
    grid-template-columns: repeat(var(--knob-cols), minmax(0, 1fr));
    grid-template-rows: minmax(0, 1fr) 5.875rem;
    gap: var(--spacing-sm);
    min-width: 0;
    min-height: 0;
  }
  .picture-over-knobs > .over {
    grid-column: 1 / -1;
    min-width: 0;
    min-height: 0;
  }
  /* The LFO's shapes, sync and Retrig on its bar, at the bar's height. */
  .bar-tools {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    width: 100%;
    max-width: none;
  }
  :global(.panel-tools) > .bar-tools {
    max-width: none;
  }
  .bar-wave,
  .bar-sync,
  .bar-retrig {
    height: var(--picker-h);
    min-width: 0;
  }
  .bar-wave { flex: 2 1 0; }
  .bar-sync { flex: 1.4 1 0; }
  .bar-retrig { flex: 0 0 3.5rem; }
  .bar-retrig .switch {
    height: var(--picker-h);
    font-size: 0.75rem;
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
  /* A pick or a switch in a stack is one touch row. */
  .stack > :global(.sw-cell) {
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
  /* The bar's two wavetable picks share its tool space. */
  .choosers {
    display: contents;
  }
  .choosers > :global(*) {
    flex: 1 1 0;
    min-width: 0;
    max-width: 13rem;
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
  /* A switch or a pick is one touch-height row, centred in its cell. */
  .sw-cell {
    display: flex;
    align-items: center;
  }
  .sw-cell > :global(*) {
    width: 100%;
  }
  .switch {
    width: 100%;
    height: var(--height-touch);
    font-size: 0.8125rem;
  }
  /* A section's column names, one over each run of columns. */
  .col-heads {
    flex: 1 1 auto;
    align-self: stretch;
    display: grid;
    column-gap: var(--face-gutter);
    justify-items: center;
    align-items: center;
    min-width: 0;
  }
  .sub {
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: 1rem;
    white-space: nowrap;
    opacity: 0.8;
  }
</style>
