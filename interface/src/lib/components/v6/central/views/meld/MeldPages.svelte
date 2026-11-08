<script lang="ts">
  /**
   * Meld's board tiles (ADR-512, ADR-513), each a `BoardTile` panel
   * (ADR-516) hand-laid on the face grid (ADR-510). An engine's tiles
   * (`osc-a`, `filter-a`, `env-a`, `lfo-a`, and `-b`) wear its colour;
   * Global holds what both share, each engine's mix in its own. Every
   * control binds a parameter by Live's name
   * (docs/reference/instruments/Meld.md) through `usePanelParams`.
   *
   * Each tile is a selector row over a knob row, as Live's own panels are:
   * the picks and switches one touch row across the top (the type, the
   * octave, the glide mode, the engine's Key, Scale, Reset and Offset), the
   * knobs under them at their ADR-509 size with their names whole. The
   * engine's and the filter's switches are on their tiles' bars. (Before
   * ADR-516 each engine's rows stacked two knobs to a column in rows too
   * short for either, and cut their captions to "S..." and "Rele...".)
   */
  import DeviceSlider from '../../../device-panel/DeviceSlider.svelte';
  import DeviceXY from '../../../device-panel/DeviceXY.svelte';
  import ScrubTabs from '../../../device-panel/ScrubTabs.svelte';
  import FaceGrid from '../../FaceGrid.svelte';
  import FaceSection from '../../FaceSection.svelte';
  import FaceSeam from '../../FaceSeam.svelte';
  import BoardTile from '../../BoardTile.svelte';
  import ChoicePicker from '../../ChoicePicker.svelte';
  import EnvelopeGraph from '../../EnvelopeGraph.svelte';
  import type { PanelParams } from '../panel/usePanelParams.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';
  import type { MeldEngine } from '../meldParams';
  import { meldFilterCurve, FILTER_FREQ_RANGE } from '$lib/utils/instrumentFilterCurves';
  import { MELD_FILTER_EXTRA_NAMES } from '../meldParams';

  interface Props {
    page: string;
    params: PanelParams;
    /** Meld's own ink, for Global. */
    ink: DeviceColorScheme;
    /** Engine A's and B's colours, as on the face. */
    engineInks: Record<MeldEngine, DeviceColorScheme>;
  }

  let { page, params, ink, engineInks }: Props = $props();

  // Live's value lists (meldPanel.ts, read off the running Meld).
  const OSC_TYPES = [
    'Basic', 'Dual Basic', 'Noisy', 'Sq Sync', 'Sq 5th', 'Sub', 'Swarm Sine', 'Swarm Tri',
    'Swarm Saw', 'Swarm Sq', 'Harm FM', 'Fold FM', 'Squelch', 'Simple FM', 'Chip', "Shepard's Pi",
    'Tarp', 'Extratone', 'Noise Loop', 'Filt Noise', 'Bitgrunge', 'Crackle', 'Rain', 'Bubble', 'Chord'
  ];
  const FILTER_TYPES = [
    'SVF 12', 'SVF 24', 'LP MS2', 'HP MS2', 'BP OSR', 'LP Crunch', 'LP Sw Res', 'Filther', 'Eq Peak',
    'Eq Notch', 'Phaser', 'Redux', 'Vowel', 'Comb +', 'Comb -', 'Plate', 'Membrane'
  ];
  const LFO_FX = [
    'None', 'Offset', 'Attenuvert', 'Gate', 'Skew Uni', 'Skew Bi', 'Unipolar', 'Quantizer', 'S&H',
    'Indep S&H', 'Clipper', 'Fade In', 'Fade Out', 'Slew Down', 'Slew Up', 'Slew U&D', 'Trig Env',
    'Comparator', 'Scrambler'
  ];
  const LFO1_WAVES = ['Basic', 'Ramp', 'Wander', 'Altern', 'Euclid', 'Pulsate'];
  const LFO2_WAVES = ['Sine', 'Tri', 'Saw Up', 'Saw Dn', 'Rect', 'S&H'];
  const LOOP_MODES = ['None', 'Trig', 'Loop', 'AD Loop'];
  const OCTAVES = ['-3', '-2', '-1', '0', '+1', '+2', '+3'];
  const GLIDE_MODES = ['Port', 'Gliss'];

  /** Controls with a middle: zero, or 0.5 of 0..1 (Detune, Pan, Tone). */
  const BIPOLAR_SUFFIX = [' Detune', ' Pan', ' Tone Filter', ' Transpose', ' Transp Scale'];

  /** The engine a page belongs to (`osc-a` → A), or none (Global). */
  let engine = $derived<MeldEngine | null>(page.endsWith('-a') ? 'A' : page.endsWith('-b') ? 'B' : null);
  let X = $derived(engine ?? 'A');
  let section = $derived(page.replace(/-[ab]$/, ''));
  let eInk = $derived(engine ? engineInks[engine] : ink);

  const TITLES: Record<string, string> = { osc: 'Engine', filter: 'Filter', env: 'Envelopes', lfo: 'LFOs', global: 'Global' };
  let title = $derived(`${TITLES[section] ?? section}${engine ? ` ${engine}` : ''}`);

  const lo = (p: string) => params.range(p)?.min ?? 0;
  const hi = (p: string) => params.range(p)?.max ?? 1;
  const step = (p: string) => {
    const v = params.raw(p);
    return v === undefined ? -1 : Math.round(v - lo(p));
  };
  const isOn = (p: string) => params.has(p) && (params.raw(p) ?? 0) >= 0.5;
  const flip = (p: string) => params.write(p, isOn(p) ? lo(p) : hi(p));

  // Filter page: the pad's curve, and the second macro's name under the type.
  let filterType = $derived(Math.max(0, step(`${X} Filter Type`)));
  let filterCurve = $derived(meldFilterCurve(filterType, params.raw(`${X} Filter L-B-H-N`) ?? 0));
  let extraTitle = $derived(MELD_FILTER_EXTRA_NAMES[filterType] ?? 'Extra');

  /** An LFO's rate: Freq while free, the synced division (22 steps) on Tempo. */
  const rateParam = (n: 1 | 2) => (isOn(`${X} LFO ${n} Sync`) ? `${X} LFO ${n} Synced` : `${X} LFO ${n} Freq`);
</script>

<!-- A knob bound by name, its name under it. A parameter that steps
     (Transpose, the synced rates) rounds. -->
{#snippet knob(param: string, title: string, opts: { steps?: number; mark?: string; color?: DeviceColorScheme; size?: 's' | 'm' | 'l'; span?: number } = {})}
  {@const l = lo(param)}
  {@const h = hi(param)}
  {@const bipolar = BIPOLAR_SUFFIX.some((s) => param.endsWith(s))}
  <div class="cell rank-{opts.size ?? 's'}" style={opts.span ? `grid-column: span ${opts.span};` : undefined} data-param={param}>
    <DeviceSlider
      value={params.raw(param) ?? l}
      {title}
      face="knob"
      knobSize={opts.size ?? 's'}
      min={l}
      max={h}
      centerOrigin={bipolar}
      centerValue={bipolar ? (l < 0 && h > 0 ? 0 : (l + h) / 2) : undefined}
      steps={opts.steps}
      knobCaption={!opts.mark}
      knobMark={opts.mark}
      orientation="vertical"
      labelSize="small"
      isGhost={!params.has(param)}
      color={opts.color ?? eInk}
      readout={params.display(param)}
      onInteraction={(v) => params.write(param, opts.steps || h - l > 1 ? Math.round(v) : v)}
    />
  </div>
{/snippet}

<!-- An on/off parameter: one touch row, lit while on. -->
{#snippet sw(param: string, title: string, color: string = eInk.primary)}
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

<!-- A list's pick: a field naming its value, its own name over it. -->
{#snippet picker(param: string, options: readonly string[], label: string, caption: string, span?: number)}
  <div class="cell sw-cell" style={span ? `grid-column: span ${span};` : undefined} data-param={param}>
    <ChoicePicker {options} selected={params.has(param) ? step(param) : undefined} onSelect={(i) => params.write(param, lo(param) + i)} {label} {caption} tint={eInk.primary} ghost={!params.has(param)} />
  </div>
{/snippet}

{#snippet sub(text: string, color: string = eInk.primary)}<span class="sub" style="color: {color};">{text}</span>{/snippet}

<!-- A section's header line: a name over each run of columns. -->
{#snippet heads(items: readonly (readonly [string, number])[], color: string = eInk.primary)}
  <div class="col-heads" style="grid-template-columns: repeat({items.reduce((n, [, span]) => n + span, 0)}, minmax(0, 1fr));">
    {#each items as [text, span], i (i)}<span class="sub" style="color: {color}; grid-column: span {span};">{text}</span>{/each}
  </div>
{/snippet}

<!-- The engine's filter pad: Freq across, Q up, its curve drawn. -->
{#snippet filterPad()}
  <DeviceXY
    xValue={params.unit(`${X} Filter Freq`) ?? 1}
    yValue={params.unit(`${X} Filter Q`) ?? 0}
    title="Filter {X}"
    titleAt="bottom"
    showCurve={isOn(`${X} Filter On`) && filterCurve.curveType !== 'none'}
    curveType={filterCurve.curveType}
    curveOrder={filterCurve.order}
    curveFreqRange={FILTER_FREQ_RANGE.meld}
    onInteraction={(x, y) => {
      params.writeUnit(`${X} Filter Freq`, x, `${X} Filter On`);
      params.writeUnit(`${X} Filter Q`, y, `${X} Filter On`);
    }}
    color={eInk}
  />
{/snippet}

<!-- The octave as a pick, +3 first, as the column reads. -->
{#snippet octavePick()}
  {@const order = OCTAVES.map((_, i) => OCTAVES.length - 1 - i)}
  {@const at = step(`${X} Octave`)}
  <div class="cell sw-cell" data-param="{X} Octave">
    <ChoicePicker
      options={order.map((i) => OCTAVES[i])}
      selected={params.has(`${X} Octave`) && at >= 0 ? order.indexOf(at) : undefined}
      onSelect={(k) => params.write(`${X} Octave`, lo(`${X} Octave`) + order[k])}
      label="Engine {X} octave"
      caption="Octave"
      tint={eInk.primary}
      ghost={!params.has(`${X} Octave`)}
    />
  </div>
{/snippet}

<!-- An envelope's picture over its lettered stage knobs (the tile's columns
     are too narrow for the words), its slopes lettered two to a column
     beside it under a "Slope" head, the loop mode under them. -->
{#snippet envelope(prefix: string, levels: boolean, loopLabel: string)}
  <div class="face-span-3"><EnvelopeGraph {params} ink={eInk.primary} knobs="short" names={levels
    ? { attack: `${prefix} Attack`, decay: `${prefix} Decay`, sustain: `${prefix} Sustain`, release: `${prefix} Release`, initial: `${prefix} Initial`, peak: `${prefix} Peak`, final: `${prefix} Final` }
    : { attack: `${prefix} Attack`, decay: `${prefix} Decay`, sustain: `${prefix} Sustain`, release: `${prefix} Release` }} /></div>
  <div class="face-span-2 slopes">
    {@render knob(`${prefix} A Slope`, 'A')}
    {@render knob(`${prefix} R Slope`, 'R')}
    {@render knob(`${prefix} D Slope`, 'D')}
    <div class="cell"></div>
    <div class="span-2">{@render picker(`${prefix} Loop Mode`, LOOP_MODES, loopLabel, 'Loop')}</div>
  </div>
{/snippet}

<div class="meld-page" data-meld-page={page}>
{#if section === 'osc'}
  <!-- The engine: its type, octave and glide mode and its four switches
       one row, its knobs under them, Shape the lead over two columns. -->
  <BoardTile title="Engine {X}" ink={eInk.primary} on={isOn(`${X} On`)} onToggle={() => flip(`${X} On`)} switchParam="{X} On" switchDisabled={!params.has(`${X} On`)}>
    <FaceGrid sections={[7]} heads={false}>
      <FaceSection span={7}>
        <div class="face-span-all two-rows">
          {@render picker(`${X} Osc Type`, OSC_TYPES, `Engine ${X} oscillator type`, 'Type')}
          {@render octavePick()}
          {@render picker(`${X} Glide Mode`, GLIDE_MODES, `Engine ${X} glide mode`, 'Glide')}
          {@render sw(`${X} Keytracking`, 'Key')}
          {@render sw(`${X} Osc Scale Aware`, 'Scale')}
          {@render sw(`${X} Reset`, 'Reset')}
          {@render sw(`${X} Reset To Voice Offset`, 'Offset')}
          {@render knob(`${X} Osc Shape`, 'Shape', { span: 2, size: 'm' })}
          {@render knob(`${X} Osc Tone`, 'Tone', { size: 'm' })}
          {@render knob(`${X} Transpose`, 'Semi', { steps: 25, size: 'm' })}
          {@render knob(`${X} Detune`, 'Detune', { size: 'm' })}
          {@render knob(`${X} Transp Scale`, 'Scale St')}
          {@render knob(`${X} Glide Time`, 'Glide')}
        </div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if section === 'filter'}
  <!-- The filter: its pad over two columns, its type over Scale, its second
       macro named as Live names it under the type. -->
  <BoardTile title="Filter {X}" ink={eInk.primary} on={isOn(`${X} Filter On`)} onToggle={() => flip(`${X} Filter On`)} switchParam="{X} Filter On" switchDisabled={!params.has(`${X} Filter On`)}>
    <FaceGrid sections={[5]} heads={false}>
      <FaceSection span={5}>
        <div class="face-span-2 pad">{@render filterPad()}</div>
        <div class="face-span-3 two-rows">
          {@render picker(`${X} Filter Type`, FILTER_TYPES, `Filter ${X} type`, 'Type', 2)}
          {@render sw(`${X} Filter Filter Scale Aware`, 'Scale')}
          {@render knob(`${X} Filter L-B-H-N`, extraTitle, { size: 'm', span: 3 })}
        </div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if section === 'env'}
  <!-- Each envelope as Live draws it (ADR-514) over its small stage knobs
       (Mod's four levels dragged on it too), its slopes and loop mode two
       to a column beside it. -->
  <BoardTile title="Envelopes {X}" ink={eInk.primary}>
    <FaceGrid sections={[5, 5]}>
      <FaceSection span={5}>
        {#snippet head()}{@render heads([['Amp', 3], ['Slope', 2]])}{/snippet}
        {@render envelope(`${X} Amp`, false, `Engine ${X} amp loop`)}
      </FaceSection>
      <FaceSeam ink={eInk.primary} />
      <FaceSection span={5}>
        {#snippet head()}{@render heads([['Mod', 3], ['Slope', 2]])}{/snippet}
        {@render envelope(`${X} Mod`, true, `Engine ${X} mod loop`)}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if section === 'lfo'}
  <!-- Both LFOs: each its wave, sync and retrigger one row, its knobs
       under; LFO 1's two effects a pick each over their amounts. -->
  <BoardTile title="LFOs {X}" ink={eInk.primary}>
    <FaceGrid sections={[4, 2, 3]}>
      <FaceSection span={4}>
        {#snippet head()}{@render sub('LFO 1')}{/snippet}
        <div class="face-span-all two-rows">
          {@render picker(`${X} LFO 1 Wave`, LFO1_WAVES, `Engine ${X} LFO 1 wave`, 'Wave')}
          {@render sw(`${X} LFO 1 Sync`, 'Sync')}
          {@render sw(`${X} LFO 1 Retrig On`, 'Retrig')}
          <div class="cell"></div>
          {@render knob(rateParam(1), isOn(`${X} LFO 1 Sync`) ? 'Sync' : 'Rate', { steps: isOn(`${X} LFO 1 Sync`) ? 22 : undefined, size: 'm' })}
          {@render knob(`${X} LFO 1 Offset`, 'Offset')}
          {@render knob(`${X} LFO 1 Shape`, 'Shape')}
          {@render knob(`${X} LFO 1 Fold`, 'Fold')}
        </div>
      </FaceSection>
      <FaceSeam ink={eInk.primary} />
      <FaceSection span={2}>
        {#snippet head()}{@render sub('LFO 1 FX')}{/snippet}
        <div class="face-span-all three-rows">
          {@render picker(`${X} LFO 1 FX 1 Type`, LFO_FX, 'FX 1 type', 'FX 1', 2)}
          {@render picker(`${X} LFO 1 FX 2 Type`, LFO_FX, 'FX 2 type', 'FX 2', 2)}
          {@render knob(`${X} LFO 1 FX 1 Scale`, 'FX 1', { mark: '1' })}
          {@render knob(`${X} LFO 1 FX 2 Ramp`, 'FX 2', { mark: '2' })}
        </div>
      </FaceSection>
      <FaceSeam ink={eInk.primary} />
      <FaceSection span={3}>
        {#snippet head()}{@render sub('LFO 2')}{/snippet}
        <div class="face-span-all two-rows">
          {@render picker(`${X} LFO 2 Wave`, LFO2_WAVES, `Engine ${X} LFO 2 wave`, 'Wave')}
          {@render sw(`${X} LFO 2 Sync`, 'Sync')}
          {@render sw(`${X} LFO 2 Retrig On`, 'Retrig')}
          {@render knob(rateParam(2), isOn(`${X} LFO 2 Sync`) ? 'Sync' : 'Rate', { steps: isOn(`${X} LFO 2 Sync`) ? 22 : undefined, span: 2, size: 'm' })}
          {@render knob(`${X} LFO 2 Offset`, 'Offset')}
        </div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if section === 'global'}
  <!-- What both engines share: each engine's mix in its colour, Meld's
       own four, and how it plays. -->
  <BoardTile title="Global" ink={ink.primary}>
    <FaceGrid sections={[3, 4, 2]}>
      <FaceSection span={3}>
        {#snippet head()}{@render heads([['Vol', 1], ['Pan', 1], ['Tone', 1]], ink.primary)}{/snippet}
        {#each [['Volume', 'Vol'], ['Pan', 'Pan'], ['Tone Filter', 'Tone']] as [name, label] (name)}
          <div class="stack">
            {@render knob(`A ${name}`, `A ${label}`, { color: engineInks.A, mark: 'A' })}
            {@render knob(`B ${name}`, `B ${label}`, { color: engineInks.B, mark: 'B' })}
          </div>
        {/each}
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={4}>
        {#snippet head()}{@render sub('Output', ink.primary)}{/snippet}
        {@render knob('Drive', 'Drive', { color: ink })}
        {@render knob('Voice Spread', 'Spread', { color: ink })}
        {@render knob('Engine B Delay', 'B Delay', { color: ink })}
        {@render knob('Volume', 'Volume', { color: ink })}
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={2}>
        {#snippet head()}{@render sub('Play', ink.primary)}{/snippet}
        <div class="stack">{@render sw('Limiter On', 'Limiter', ink.primary)}{@render sw('Link Envelopes', 'Link Env', ink.primary)}</div>
        <div class="stack">{@render sw('Scale Aware', 'Scale', ink.primary)}{@render sw('Mono Legato', 'Legato', ink.primary)}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{/if}
</div>

<style>
  .meld-page {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
  }
  .meld-page > :global(*) {
    flex: 1 1 0;
    min-width: 0;
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
  /* A switch or a field in a stack is one touch row. */
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
  }
  /* A selector row over a knob row (ADR-516): the picks and switches one
     touch row across the section's columns, the knobs on those columns
     under them. */
  .two-rows {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: var(--height-touch) minmax(0, 1fr);
    row-gap: var(--spacing-sm);
    min-height: 0;
  }
  .two-rows > :global(*) {
    min-width: 0;
    min-height: 0;
  }
  /* Two picks, each across the section, over their two amounts. */
  .three-rows {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: var(--height-touch) var(--height-touch) minmax(0, 1fr);
    row-gap: var(--spacing-sm);
    min-height: 0;
  }
  .three-rows > :global(*) {
    min-width: 0;
    min-height: 0;
  }
  /* An envelope's slopes two by two, the loop's field across both under them. */
  .slopes {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr) var(--height-touch);
    gap: var(--spacing-sm) var(--face-gutter);
    min-height: 0;
  }
  .slopes > :global(*) {
    min-width: 0;
    min-height: 0;
  }
  .slopes > .span-2 {
    grid-column: span 2;
  }
  /* A switch or a field is one touch row, centred in its cell. */
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
  /* The board's columns are narrow: a field keeps its padding small. */
  .meld-page :global(.picker-button) {
    padding: 0 0.25rem;
  }
</style>
