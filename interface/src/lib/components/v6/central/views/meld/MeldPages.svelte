<script lang="ts">
  /**
   * Meld's section pages, each hand-laid on the face grid (ADR-510,
   * 2026-11-06), as Drift's are (`drift/DriftPages.svelte`): equal columns
   * on a page, identical seams, one header line, knobs at their ADR-509
   * size. They replace the rule-laid panel pages for Meld. An engine's
   * pages (`osc-a`, `filter-a`, `env-a`, `lfo-a`, and `-b`) wear its
   * colour; Global holds what both share, each engine's mix in its own.
   * Every control binds a parameter by Live's name
   * (docs/reference/instruments/Meld.md) through `usePanelParams`, so a
   * write is exactly what the panel page wrote.
   *
   * Each engine's envelopes and LFOs are one page each, their detail
   * (slopes, loop mode, LFO 1's shape and effects) on it, so no page opens
   * another. The first section's header line carries the page's name with
   * a "‹" that leads back to the face.
   *
   * On the full-screen board (`board`, ADR-512) every page of both engines
   * is a tile at once, so each page is a narrower, shorter variant: a page's
   * way back is its plain name; a pick too long for a board row's height (the
   * octave, an LFO's wave) is a `ChoicePicker`, and an LFO's sync a switch;
   * the Filter pad takes two columns; the envelopes stand three knobs to a
   * column (times, slopes, levels); and Global's Play switches go two to a
   * column.
   */
  import DeviceSlider from '../../../device-panel/DeviceSlider.svelte';
  import DeviceXY from '../../../device-panel/DeviceXY.svelte';
  import ScrubTabs from '../../../device-panel/ScrubTabs.svelte';
  import FaceGrid from '../../FaceGrid.svelte';
  import FaceSection from '../../FaceSection.svelte';
  import FaceSeam from '../../FaceSeam.svelte';
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
    onBack: () => void;
    /**
     * A tile of the full-screen board (ADR-512): every page of both engines
     * is on screen, so a page's way back is its plain name.
     */
    board?: boolean;
  }

  let { page, params, ink, engineInks, onBack, board = false }: Props = $props();

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

  // Filter page: the pad's curve, and the second macro's name under the type.
  let filterType = $derived(Math.max(0, step(`${X} Filter Type`)));
  let filterCurve = $derived(meldFilterCurve(filterType, params.raw(`${X} Filter L-B-H-N`) ?? 0));
  let extraTitle = $derived(MELD_FILTER_EXTRA_NAMES[filterType] ?? 'Extra');

  /** An LFO's rate: Freq while free, the synced division (22 steps) on Tempo. */
  const rateParam = (n: 1 | 2) => (isOn(`${X} LFO ${n} Sync`) ? `${X} LFO ${n} Synced` : `${X} LFO ${n} Freq`);
</script>

<!-- A knob bound by name, its name under it (or beside it in a wide,
     short cell). A parameter that steps (Transpose, the synced rates)
     rounds. -->
{#snippet knob(param: string, title: string, opts: { steps?: number; mark?: string; color?: DeviceColorScheme; size?: 's' | 'm' | 'l' } = {})}
  {@const l = lo(param)}
  {@const h = hi(param)}
  {@const bipolar = BIPOLAR_SUFFIX.some((s) => param.endsWith(s))}
  <div class="cell" data-param={param}>
    <DeviceSlider
      value={params.raw(param) ?? l}
      {title}
      face="knob"
      knobSize={opts.size ?? 'm'}
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

<!-- A pick of named values, one cell each, scrubbed. `up` lists the last
     value first (an octave climbs as the eye does). -->
{#snippet tab(param: string, labels: readonly string[], opts: { cols?: number; up?: boolean } = {})}
  {@const order = opts.up ? labels.map((_, i) => labels.length - 1 - i) : labels.map((_, i) => i)}
  <div class="cell" data-param={param}>
  <ScrubTabs
    options={order}
    selected={order.indexOf(step(param))}
    onSelect={(_, i) => params.write(param, lo(param) + i)}
    cols={opts.cols ?? 1}
    tint={eInk.primary}
    inked
    ghost={!params.has(param)}
    label={(i) => labels[i]}
    groupLabel={param}
    style="height: 100%; --scrub-font-size: 0.75rem;"
  >
    {#snippet item(i)}{labels[i]}{/snippet}
  </ScrubTabs>
  </div>
{/snippet}

<!-- An on/off parameter: one touch row, centred in its cell, lit while on. -->
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
    onclick={() => params.write(param, on ? lo(param) : hi(param))}
  >{title}</button>
  </div>
{/snippet}

<!-- A long list's pick, one touch row centred in its cell. -->
{#snippet picker(param: string, options: readonly string[], label: string)}
  <div class="cell sw-cell">
    <ChoicePicker {options} selected={step(param)} onSelect={(i) => params.write(param, lo(param) + i)} {label} tint={eInk.primary} ghost={!params.has(param)} />
  </div>
{/snippet}

{#snippet back()}
  {#if board}
    <span class="sub" style="color: {eInk.primary};">{title}</span>
  {:else}
    <button class="page-back" style="color: {eInk.primary};" onclick={onBack}>‹ {title}</button>
  {/if}
{/snippet}

{#snippet sub(text: string, color: string = eInk.primary)}<span class="sub" style="color: {color};">{text}</span>{/snippet}

{#snippet empty()}<div class="cell"></div>{/snippet}

<!-- The engine's filter pad: Freq across, Q up, its curve drawn. -->
{#snippet filterPad()}
  <DeviceXY
    xValue={params.unit(`${X} Filter Freq`) ?? 1}
    yValue={params.unit(`${X} Filter Q`) ?? 0}
    title="Filter {X}"
    titleAt={board ? 'bottom' : 'center'}
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

<!-- The octave as a pick (the board): +3 first, as the column reads. -->
{#snippet octavePick()}
  {@const order = OCTAVES.map((_, i) => OCTAVES.length - 1 - i)}
  {@const at = step(`${X} Octave`)}
  <ChoicePicker
    options={order.map((i) => OCTAVES[i])}
    selected={params.has(`${X} Octave`) && at >= 0 ? order.indexOf(at) : undefined}
    onSelect={(k) => params.write(`${X} Octave`, lo(`${X} Octave`) + order[k])}
    label="Engine {X} octave"
    tint={eInk.primary}
    ghost={!params.has(`${X} Octave`)}
  />
{/snippet}

<div class="meld-page" data-meld-page={page}>
{#if section === 'osc' && board}
  <!-- On the board (ADR-512): the octave a pick over Semi (seven cells
       are too short in a board row), Detune over Scale St, the two
       switches a column. Each engine has its own short rows on the board,
       so no column stacks more than two touch rows: the type's pick over
       the engine's On, without the mark (the pick names the type). -->
  <FaceGrid sections={[2, 3, 1, 1]}>
    <FaceSection span={2}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="stack">
        {@render picker(`${X} Osc Type`, OSC_TYPES, `Engine ${X} oscillator type`)}
        {@render sw(`${X} On`, 'On')}
      </div>
      <div class="stack">{@render knob(`${X} Osc Shape`, 'Shape')}{@render knob(`${X} Osc Tone`, 'Tone')}</div>
    </FaceSection>
    <FaceSeam ink={eInk.primary} />
    <FaceSection span={3}>
      {#snippet head()}{@render sub('Pitch')}{/snippet}
      <div class="stack">
        <div class="cell sw-cell octave-pick">{@render octavePick()}</div>
        {@render knob(`${X} Transpose`, 'Semi', { steps: 25 })}
      </div>
      <div class="stack">{@render knob(`${X} Detune`, 'Detune')}{@render knob(`${X} Transp Scale`, 'Scale St')}</div>
      <div class="stack">{@render sw(`${X} Keytracking`, 'Key')}{@render sw(`${X} Osc Scale Aware`, 'Scale')}</div>
    </FaceSection>
    <FaceSeam ink={eInk.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render sub('Reset')}{/snippet}
      <div class="stack">{@render sw(`${X} Reset`, 'Reset')}{@render sw(`${X} Reset To Voice Offset`, 'Offset')}</div>
    </FaceSection>
    <FaceSeam ink={eInk.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render sub('Glide')}{/snippet}
      <div class="stack">{@render tab(`${X} Glide Mode`, ['Port', 'Gliss'])}{@render knob(`${X} Glide Time`, 'Time')}</div>
    </FaceSection>
  </FaceGrid>
{:else if section === 'filter' && board}
  <!-- On the board (ADR-512) four columns in one section: the pad over two,
       the type over On, Scale over the second macro (two touch rows a
       column: each engine's rows are short). -->
  <FaceGrid sections={[4]}>
    <FaceSection span={4}>
      {#snippet head()}{@render back()}{@render sub('Type')}{/snippet}
      <div class="face-span-2 pad">{@render filterPad()}</div>
      <div class="stack">
        {@render picker(`${X} Filter Type`, FILTER_TYPES, `Filter ${X} type`)}
        {@render sw(`${X} Filter On`, 'On')}
      </div>
      <div class="stack">
        {@render sw(`${X} Filter Filter Scale Aware`, 'Scale')}
        {@render knob(`${X} Filter L-B-H-N`, extraTitle)}
      </div>
    </FaceSection>
  </FaceGrid>
{:else if section === 'env' && board}
  <!-- On the board (ADR-514) each envelope as Live draws it: the times and
       levels dragged on the picture (Mod's four levels too), its three
       slopes and its loop mode under it. -->
  <FaceGrid sections={[4, 4]}>
    <FaceSection span={4}>
      {#snippet head()}{@render back()}{@render sub('Amp')}{/snippet}
      <div class="face-span-all graph-board">
        <div class="graph"><EnvelopeGraph {params} ink={eInk.primary} names={{ attack: `${X} Amp Attack`, decay: `${X} Amp Decay`, sustain: `${X} Amp Sustain`, release: `${X} Amp Release` }} /></div>
        {@render knob(`${X} Amp A Slope`, 'A Slope')}
        {@render knob(`${X} Amp D Slope`, 'D Slope')}
        {@render knob(`${X} Amp R Slope`, 'R Slope')}
        <div class="cell sw-cell">{@render picker(`${X} Amp Loop Mode`, LOOP_MODES, `Engine ${X} amp loop`)}</div>
      </div>
    </FaceSection>
    <FaceSeam ink={eInk.primary} />
    <FaceSection span={4}>
      {#snippet head()}{@render sub('Mod')}{/snippet}
      <div class="face-span-all graph-board">
        <div class="graph"><EnvelopeGraph {params} ink={eInk.primary} names={{ attack: `${X} Mod Attack`, decay: `${X} Mod Decay`, sustain: `${X} Mod Sustain`, release: `${X} Mod Release`, initial: `${X} Mod Initial`, peak: `${X} Mod Peak`, final: `${X} Mod Final` }} /></div>
        {@render knob(`${X} Mod A Slope`, 'A Slope')}
        {@render knob(`${X} Mod D Slope`, 'D Slope')}
        {@render knob(`${X} Mod R Slope`, 'R Slope')}
        <div class="cell sw-cell">{@render picker(`${X} Mod Loop Mode`, LOOP_MODES, `Engine ${X} mod loop`)}</div>
      </div>
    </FaceSection>
  </FaceGrid>
{:else if section === 'lfo' && board}
  <!-- On the board (ADR-512) seven columns: each LFO's wave a pick over
       its sync and retrigger switches (a six-cell tab is too short in a
       board row), its rate over its offset; LFO 1's shape over fold, and
       its two effects a column each. -->
  <FaceGrid sections={[3, 2, 2]}>
    <FaceSection span={3}>
      {#snippet head()}{@render back()}{@render sub('LFO 1')}{/snippet}
      <div class="stack">
        {@render picker(`${X} LFO 1 Wave`, LFO1_WAVES, `Engine ${X} LFO 1 wave`)}
        {@render sw(`${X} LFO 1 Sync`, 'Sync')}
        {@render sw(`${X} LFO 1 Retrig On`, 'Retrig')}
      </div>
      <div class="stack">
        {@render knob(rateParam(1), isOn(`${X} LFO 1 Sync`) ? 'Sync' : 'Rate', { steps: isOn(`${X} LFO 1 Sync`) ? 22 : undefined })}
        {@render knob(`${X} LFO 1 Offset`, 'Offset')}
      </div>
      <div class="stack">{@render knob(`${X} LFO 1 Shape`, 'Shape')}{@render knob(`${X} LFO 1 Fold`, 'Fold')}</div>
    </FaceSection>
    <FaceSeam ink={eInk.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render sub('LFO 1 FX')}{/snippet}
      <!-- The two amounts side by side, their types under them, 1 over 2,
           each across both columns so an effect's name reads whole. -->
      <div class="face-span-2 fx-pair">
        {@render knob(`${X} LFO 1 FX 1 Scale`, 'FX 1', { mark: '1' })}
        {@render knob(`${X} LFO 1 FX 2 Ramp`, 'FX 2', { mark: '2' })}
        {@render picker(`${X} LFO 1 FX 1 Type`, LFO_FX, 'FX 1 type')}
        {@render picker(`${X} LFO 1 FX 2 Type`, LFO_FX, 'FX 2 type')}
      </div>
    </FaceSection>
    <FaceSeam ink={eInk.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render sub('LFO 2')}{/snippet}
      <div class="stack">
        {@render picker(`${X} LFO 2 Wave`, LFO2_WAVES, `Engine ${X} LFO 2 wave`)}
        {@render sw(`${X} LFO 2 Sync`, 'Sync')}
        {@render sw(`${X} LFO 2 Retrig On`, 'Retrig')}
      </div>
      <div class="stack">
        {@render knob(rateParam(2), isOn(`${X} LFO 2 Sync`) ? 'Sync' : 'Rate', { steps: isOn(`${X} LFO 2 Sync`) ? 22 : undefined })}
        {@render knob(`${X} LFO 2 Offset`, 'Offset')}
      </div>
    </FaceSection>
  </FaceGrid>
{:else if section === 'global' && board}
  <!-- On the board (ADR-512) Global is its own row under both engines, as
       wide as the screen and short: the Play switches go four across, and
       the mix reads "A Vol". -->
  <FaceGrid sections={[3, 2, 4]}>
    <FaceSection span={3}>
      {#snippet head()}{@render back()}{@render sub('Mix A / B')}{/snippet}
      {#each [['Volume', 'Vol'], ['Pan', 'Pan'], ['Tone Filter', 'Tone']] as [name, label] (name)}
        <div class="stack">
          {@render knob(`A ${name}`, `A ${label}`, { color: engineInks.A })}
          {@render knob(`B ${name}`, `B ${label}`, { color: engineInks.B })}
        </div>
      {/each}
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render sub('Global', ink.primary)}{/snippet}
      <div class="stack">{@render knob('Drive', 'Drive', { color: ink })}{@render knob('Voice Spread', 'Spread', { color: ink })}</div>
      <div class="stack">{@render knob('Engine B Delay', 'B Delay', { color: ink })}{@render knob('Volume', 'Volume', { color: ink })}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={4}>
      {#snippet head()}{@render sub('Play', ink.primary)}{/snippet}
      {@render sw('Limiter On', 'Limiter', ink.primary)}{@render sw('Link Envelopes', 'Link Env', ink.primary)}
      {@render sw('Scale Aware', 'Scale', ink.primary)}{@render sw('Mono Legato', 'Legato', ink.primary)}
    </FaceSection>
  </FaceGrid>
{/if}
</div>

<style>

  .meld-page {
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
  .cell {
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  .pad {
    min-height: 0;
  }
  /* LFO 1's effects on the board: the two knobs on a row, each type
     across both columns under them. */
  .fx-pair {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: minmax(0, 1fr) auto auto;
    row-gap: 0.25rem;
    min-height: 0;
  }
  .fx-pair > .sw-cell {
    grid-column: 1 / -1;
    height: auto;
  }
  /* A switch or a chooser is one touch row, centred in its cell, so it
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
