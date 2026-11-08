<script lang="ts">
  /**
   * Analog's board tiles (ADR-512, ADR-513), each a `BoardTile` panel
   * (ADR-516) hand-laid on the face grid (ADR-510): a header bar naming
   * the section in its voice's colour with the section's switch at its
   * right (Osc, Filter, Amp, LFO, Vibrato and Noise each have one), then
   * equal columns, identical seams, knobs at their ADR-509 size. Every
   * control binds a parameter by Live's name through `usePanelParams`, and
   * a control inside a switched section writes with that section's switch,
   * so touching it while the section is off turns the section on first.
   *
   * Analog has more to show than any other instrument, so its board is
   * compact (8px inset and gap, ADR-434) and most columns hold two knobs,
   * small; a long pick is a `ChoicePicker` naming itself. The envelope
   * tiles draw each envelope as Live does (ADR-514), its stage knobs two
   * by two beside the picture.
   */
  import type { Snippet } from 'svelte';
  import DeviceSlider from '../../../device-panel/DeviceSlider.svelte';
  import ScrubTabs from '../../../device-panel/ScrubTabs.svelte';
  import type { ControlGlyphName } from '../../../device-panel/ControlGlyph.svelte';
  import FaceGrid from '../../FaceGrid.svelte';
  import FaceSection from '../../FaceSection.svelte';
  import FaceSeam from '../../FaceSeam.svelte';
  import BoardTile from '../../BoardTile.svelte';
  import ChoicePicker from '../../ChoicePicker.svelte';
  import EnvelopeGraph from '../../EnvelopeGraph.svelte';
  import LfoGraph from '../../LfoGraph.svelte';
  import HostedSwapPill from '../../HostedSwapPill.svelte';
  import type { PanelParams } from '../panel/usePanelParams.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';
  import {
    ANALOG_FILTER_FAMILIES,
    ANALOG_FILTER_TYPES,
    ANALOG_DRIVES,
    filterTypeForFamily
  } from '../analogParams';

  interface Props {
    page: string;
    params: PanelParams;
    /** The device's own ink (Global, MPE). */
    ink: DeviceColorScheme;
    /** Each voice's colour, as on the face: Voice 1 orange, Voice 2 blue. */
    voiceInks: { 1: DeviceColorScheme; 2: DeviceColorScheme };
    noiseInk: DeviceColorScheme;
    shapeGlyph: Snippet<[string]>;
  }

  let { page, params, ink, voiceInks, noiseInk, shapeGlyph }: Props = $props();

  const signed = (lo: number, hi: number) =>
    Array.from({ length: hi - lo + 1 }, (_, i) => {
      const n = lo + i;
      return n > 0 ? `+${n}` : String(n);
    });
  const OCTAVES = signed(-3, 3);
  const SEMIS = signed(-12, 12);
  const SHAPES = ['Sine', 'Saw', 'Rect', 'Noise'];
  const LOOP_MODES = ['Off', 'AD-R', 'ADR-R', 'ADS-AR'];
  const LFO_SHAPES = ['Sine', 'Tri', 'Rect', 'Noise1', 'Noise2'];
  const VOICES = ['Mono', '2', '4', '8', '12', '16', '20', '24', '28', '32'];
  const SYNC_RATES = [
    '4d', '4', '4t', '2d', '2', '2t', '1d', '1', '1t', '1/2d', '1/2', '1/2t',
    '1/4d', '1/4', '1/4t', '1/8d', '1/8', '1/8t', '1/16d', '1/16', '1/16t', '1/32d', '1/32', '1/32t'
  ];
  /** Live's MPE destinations, `Press Dest A` and its kin, 0..46. */
  const MPE_DESTS = [
    'None', 'Vib Amount', 'Vib Speed', 'Uni Detune', 'Noise Level', 'Noise Bal', 'Noise Color',
    'O1 Pitch', 'O1 LFO > Pitch', 'O1 Pitch Env', 'O1 PW', 'O1 LFO > PW', 'O1 Sub', 'O1 Sync',
    'O1 Level', 'O1 Balance', 'F1 Cutoff', 'F1 LFO > Cut', 'F1 Env > Cut', 'F1 Q', 'F1 LFO > Q',
    'F1 Env > Q', 'A1 Volume', 'A1 LFO > Vol', 'A1 Pan', 'A1 LFO > Pan', 'LFO 1 Rate',
    'O2 Pitch', 'O2 LFO > Pitch', 'O2 Pitch Env', 'O2 PW', 'O2 LFO > PW', 'O2 Sub', 'O2 Sync',
    'O2 Level', 'O2 Balance', 'F2 Cutoff', 'F2 LFO > Cut', 'F2 Env > Cut', 'F2 Q', 'F2 LFO > Q',
    'F2 Env > Q', 'A2 Volume', 'A2 LFO > Vol', 'A2 Pan', 'A2 LFO > Pan', 'LFO 2 Rate'
  ];

  /**
   * The LFO's five shapes as pictures, on the face's 24 x 12 glyph box:
   * Noise1 steps (sample and hold), Noise2 wanders.
   */
  const LFO_GLYPHS: Record<string, string> = {
    Sine: 'M0 6 Q3 0 6 6 T12 6 T18 6 T24 6',
    Tri: 'M0 6 L3 2 L9 10 L15 2 L21 10 L24 6',
    Rect: 'M0 10 L0 2 L6 2 L6 10 L12 10 L12 2 L18 2 L18 10 L24 10',
    Noise1: 'M0 7 L4 7 L4 3 L8 3 L8 9 L12 9 L12 5 L16 5 L16 10 L20 10 L20 4 L24 4',
    Noise2: 'M0 7 C3 2 5 3 7 6 C9 9 11 10 13 6 C15 2 18 3 20 7 C21 9 23 8 24 6'
  };

  /** Amounts centred on 0.5 of a 0..1 range: the balances and the pans. */
  const MID_ZERO = /Balance$|Pan$/;

  /** The page's voice (its id ends in 1 or 2), or none. */
  let v = $derived<1 | 2 | null>(/[12]$/.test(page) ? (Number(page.slice(-1)) as 1 | 2) : null);
  let vInk = $derived(v ? voiceInks[v] : ink);
  /** The kind of page, voice dropped: 'osc', 'filter', 'env', 'aeg', … */
  let kind = $derived(v ? page.slice(0, -1) : page);

  const TITLES: Record<string, string> = {
    osc: 'Osc', filter: 'Filter', env: 'Envelopes', aeg: 'Amp Env', feg: 'Filter Env', amp: 'Amp',
    lfo: 'LFO', noise: 'Noise', global: 'Global', vibrato: 'Vibrato', mpe: 'MPE'
  };
  let title = $derived(`${TITLES[kind] ?? kind}${v && kind !== 'aeg' && kind !== 'feg' ? ` ${v}` : ''}`);

  const lo = (p: string) => params.range(p)?.min ?? 0;
  const hi = (p: string) => params.range(p)?.max ?? 1;
  const step = (p: string) => {
    const x = params.raw(p);
    return x === undefined ? -1 : Math.round(x - lo(p));
  };
  const isOn = (p: string) => params.has(p) && (params.raw(p) ?? 0) >= 0.5;
  const flip = (p: string) => params.write(p, isOn(p) ? lo(p) : hi(p));
  /** A control in a switched section is ghosted while the section is off. */
  const ghosted = (p: string, sw?: string) => !params.has(p) || (!!sw && params.has(sw) && !isOn(sw));

  // Each voice's names, Live's spelling (docs/reference/instruments/Analog.md).
  let O = $derived(`OSC${v}`);
  let o = $derived(`O${v}`);
  let F = $derived(`F${v}`);
  let L = $derived(`LFO${v}`);
  let E = $derived(kind === 'feg' ? `FEG${v}` : `AEG${v}`);

  let fType = $derived(Math.max(0, step(`${F} Type`)));
  let lfoBeat = $derived(step(`${L} Sync`) === 1);
</script>

<!-- A knob bound by name. `size` is its rank: small on the board unless
     a lead. A parameter that steps but is not quantized (Live's synced
     rates) rounds. -->
{#snippet knob(param: string, title: string, opt: { sw?: string; steps?: number; size?: 's' | 'm' | 'l'; mark?: string; color?: DeviceColorScheme; icon?: ControlGlyphName } = {})}
  {@const l = lo(param)}
  {@const h = hi(param)}
  {@const mid = MID_ZERO.test(param)}
  {@const bipolar = mid || (l < 0 && h > 0)}
  <div class="cell rank-{opt.size ?? 's'}" data-param={param}>
    <DeviceSlider
      value={params.raw(param) ?? l}
      {title}
      face="knob"
      knobSize={opt.size ?? 's'}
      min={l}
      max={h}
      centerOrigin={bipolar}
      centerValue={bipolar ? (mid ? (l + h) / 2 : 0) : undefined}
      steps={opt.steps}
      knobCaption={!opt.mark}
      knobMark={opt.mark}
      icon={opt.icon}
      orientation="vertical"
      labelSize="small"
      isGhost={ghosted(param, opt.sw)}
      color={opt.color ?? vInk}
      readout={params.display(param)}
      onInteraction={(x) => params.write(param, opt.steps ? Math.round(x) : x, opt.sw)}
    />
  </div>
{/snippet}

<!-- An envelope stage: a value box, full height, so the row draws the
     envelope (ADR-509). -->
{#snippet stage(param: string, title: string, icon: ControlGlyphName)}
  <div class="cell" data-param={param}>
    <DeviceSlider
      value={params.raw(param) ?? 0}
      {title}
      {icon}
      min={lo(param)}
      max={hi(param)}
      orientation="vertical"
      labelSize="small"
      isGhost={!params.has(param)}
      color={vInk}
      readout={params.display(param)}
      onInteraction={(x) => params.write(param, x)}
    />
  </div>
{/snippet}

<!-- A modulation amount: the knob, its mark inside, and its destination's
     field as its caption (Drift's modKnob). -->
{#snippet modKnob(param: string, mark: string, title: string, dest: string)}
  <div class="mod-cell" data-param={param}>
    <div class="mod-knob">{@render knob(param, title, { mark, size: 'l', color: ink })}</div>
    <div class="mod-foot">
      <ChoicePicker options={MPE_DESTS} selected={step(dest)} onSelect={(i) => params.write(dest, lo(dest) + i)} label="{title} destination" caption="To" tint={ink.primary} ghost={!params.has(dest)} />
    </div>
  </div>
{/snippet}

{#snippet lfoGlyph(label: string)}
  <svg class="glyph" viewBox="0 0 24 12" role="img" aria-label={label}>
    <path d={LFO_GLYPHS[label] ?? ''} fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
  </svg>
{/snippet}

<!-- A pick of named values, one cell each, scrubbed. `up` lists the last
     value first (an octave climbs as the eye does). -->
{#snippet tab(param: string, labels: readonly string[], opt: { cols?: number; up?: boolean; glyph?: 'osc' | 'lfo'; sw?: string; color?: string; touch?: boolean } = {})}
  {@const order = opt.up ? labels.map((_, i) => labels.length - 1 - i) : labels.map((_, i) => i)}
  <div class="cell panel-choice" class:touch-row={opt.touch} data-param={param}>
    <ScrubTabs
      options={order}
      selected={order.indexOf(step(param))}
      onSelect={(_, i) => params.write(param, lo(param) + i, opt.sw)}
      cols={opt.cols ?? 1}
      tint={opt.color ?? vInk.primary}
      inked
      ghost={ghosted(param, opt.sw)}
      label={(i) => labels[i]}
      groupLabel={param}
      style="height: 100%; --scrub-font-size: 0.75rem;"
    >
      {#snippet item(i)}{#if opt.glyph === 'lfo'}{@render lfoGlyph(labels[i])}{:else if opt.glyph === 'osc'}{@render shapeGlyph(labels[i])}{:else}{labels[i]}{/if}{/snippet}
    </ScrubTabs>
  </div>
{/snippet}

<!-- A list's pick: a field naming its value, its own name over it. -->
{#snippet picker(param: string, labels: readonly string[], title: string, sw?: string, color: string = vInk.primary)}
  <div class="cell sw-cell" data-param={param}>
    <ChoicePicker options={labels} selected={step(param)} onSelect={(i) => params.write(param, lo(param) + i, sw)} label={title} caption={title} tint={color} ghost={ghosted(param, sw)} />
  </div>
{/snippet}

<!-- An on/off parameter: one touch row, centred in its cell, lit while on. -->
{#snippet sw(param: string, title: string, color: string = vInk.primary, section?: string)}
  {@const on = isOn(param)}
  <div class="cell sw-cell">
    <button
      class="physical-button btn-toggle switch"
      class:active={on}
      aria-pressed={on}
      disabled={!params.has(param)}
      style="--btn-tint: {color};"
      data-param={param}
      onclick={() => params.write(param, on ? lo(param) : hi(param), section)}
    >{title}</button>
  </div>
{/snippet}

{#snippet sub(text: string, color: string = vInk.primary)}<span class="sub" style="color: {color};">{text}</span>{/snippet}

<!-- A section's header line: a name over each run of columns. -->
{#snippet heads(items: readonly (readonly [string, number])[], color: string = vInk.primary)}
  <div class="col-heads" style="grid-template-columns: repeat({items.reduce((n, [, span]) => n + span, 0)}, minmax(0, 1fr));">
    {#each items as [text, span], i (i)}<span class="sub" style="color: {color}; grid-column: span {span};">{text}</span>{/each}
  </div>
{/snippet}

<div class="analog-page" data-analog-page={page}>
{#if kind === 'osc' && v}
  <!-- The oscillator: its shape down a column, its mode, octave and
       semitone a field each, then the page's ten knobs two to a column
       under their columns' names. -->
  <BoardTile title={title} ink={vInk.primary} on={isOn(`${O} On/Off`)} onToggle={() => flip(`${O} On/Off`)} switchParam="{O} On/Off" switchDisabled={!params.has(`${O} On/Off`)}>
    <FaceGrid sections={[2, 5]}>
      <FaceSection span={2}>
        {@render tab(`${O} Shape`, SHAPES, { glyph: 'osc', sw: `${O} On/Off` })}
        <div class="col">
          {@render picker(`${O} Mode`, ['Sub', 'Sync'], 'Mode', `${O} On/Off`)}
          {@render picker(`${O} Octave`, OCTAVES, 'Octave', `${O} On/Off`)}
          {@render picker(`${O} Semi`, SEMIS, 'Semi', `${O} On/Off`)}
        </div>
      </FaceSection>
      <FaceSeam ink={vInk.primary} />
      <FaceSection span={5}>
        {#snippet head()}{@render heads([['Tone', 2], ['Out', 1], ['Pitch Env', 1], [`LFO ${v}`, 1]])}{/snippet}
        <div class="stack">{@render knob(`${o} Sub/Sync`, step(`${O} Mode`) === 1 ? 'Sync' : 'Sub', { sw: `${O} On/Off` })}{@render knob(`${O} Detune`, 'Detune', { sw: `${O} On/Off`, size: 'm' })}</div>
        <div class="stack">{@render knob(`${O} PW`, 'PW', { sw: `${O} On/Off` })}{@render knob(`${o} Keytrack`, 'Key')}</div>
        <div class="stack">{@render knob(`${O} Level`, 'Level', { size: 'm' })}{@render knob(`${O} Balance`, 'F1/F2')}</div>
        <div class="stack">{@render knob(`PEG${v} Amount`, 'Amount')}{@render knob(`PEG${v} Time`, 'Time')}</div>
        <div class="stack">{@render knob(`${O} < LFO`, 'Pitch')}{@render knob(`${o} PW < LFO`, 'PW')}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if kind === 'filter' && v}
  <!-- The filter: the five families down a column (a second tap on the lit
       one flips its slope), its drive and the link between the filters,
       the cutoff large over the resonance, then what moves them. -->
  <BoardTile title={title} ink={vInk.primary} on={isOn(`${F} On/Off`)} onToggle={() => flip(`${F} On/Off`)} switchParam="{F} On/Off" switchDisabled={!params.has(`${F} On/Off`)}>
    <FaceGrid sections={[3, 3]}>
      <FaceSection span={3}>
        <div class="family-tab device-segmented" style="--btn-tint: {vInk.primary};" data-param="{F} Type">
          {#each ANALOG_FILTER_FAMILIES as family, i}
            {@const t = Math.floor(fType / 2) === i ? fType : i * 2 + (fType % 2)}
            <button
              class="device-segment family-step"
              class:active={Math.floor(fType / 2) === i}
              title={ANALOG_FILTER_TYPES[t]}
              aria-label="Filter {v} {ANALOG_FILTER_TYPES[t]}"
              aria-pressed={Math.floor(fType / 2) === i}
              onclick={() => params.write(`${F} Type`, filterTypeForFamily(fType, i), `${F} On/Off`)}
            >
              <span>{family.label}</span>
              {#if Math.floor(fType / 2) === i}<span class="family-sub">{family.slopes[fType % 2]}</span>{/if}
            </button>
          {/each}
        </div>
        <div class="col">
          {@render picker(`${F} Drive`, ANALOG_DRIVES, 'Drive', `${F} On/Off`)}
          {#if v === 1}
            <div class="grow">{@render knob('F1 To F2', 'To F2', { sw: 'F1 On/Off' })}</div>
          {:else}
            <div class="grow sw-cell">{@render sw('F2 Slave', 'Follow F1', vInk.primary, `${F} On/Off`)}</div>
          {/if}
        </div>
        <div class="stack">{@render knob(`${F} Freq`, 'Freq', { sw: `${F} On/Off`, size: 'l' })}{@render knob(`${F} Resonance`, 'Res', { sw: `${F} On/Off`, size: 'm' })}</div>
      </FaceSection>
      <FaceSeam ink={vInk.primary} />
      <FaceSection span={3}>
        {#snippet head()}{@render heads([['Key', 1], [`LFO ${v}`, 1], ['Env', 1]])}{/snippet}
        <div class="stack">{@render knob(`${F} Freq < Key`, 'Freq')}{@render knob(`${F} Reso < Key`, 'Res')}</div>
        <div class="stack">{@render knob(`${F} Freq < LFO`, 'Freq')}{@render knob(`${F} Res < LFO`, 'Res')}</div>
        <div class="stack">{@render knob(`${F} Freq < Env`, 'Freq')}{@render knob(`${F} Res < Env`, 'Res')}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if kind === 'amp' && v}
  <!-- The amp: Level over Pan, and what moves each, two to a column. -->
  <BoardTile title={title} ink={vInk.primary} on={isOn(`AMP${v} On/Off`)} onToggle={() => flip(`AMP${v} On/Off`)} switchParam="AMP{v} On/Off" switchDisabled={!params.has(`AMP${v} On/Off`)}>
    <FaceGrid sections={[4]}>
      <FaceSection span={4}>
        {#snippet head()}{@render heads([['Amp', 1], ['Key', 1], [`LFO ${v}`, 1], ['Env', 1]])}{/snippet}
        <div class="stack">{@render knob(`AMP${v} Level`, 'Level', { sw: `AMP${v} On/Off`, size: 'm' })}{@render knob(`AMP${v} Pan`, 'Pan', { sw: `AMP${v} On/Off` })}</div>
        <div class="stack">{@render knob(`AMP${v} < Key`, 'Level', { sw: `AMP${v} On/Off` })}{@render knob(`A${v} Pan < Key`, 'Pan', { sw: `AMP${v} On/Off` })}</div>
        <div class="stack">{@render knob(`AMP${v} < LFO`, 'Level')}{@render knob(`A${v} Pan < LFO`, 'Pan')}</div>
        {@render knob(`A${v} Pan < Env`, 'Pan', { size: 'm' })}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if kind === 'env' && v}
  <!-- Both envelopes as Live draws them (ADR-514), Amp over Filter, their
       stage knobs two by two beside each picture; each row's name line
       carries its loop; Sustain Time, which Live draws as a number, a box. -->
  <BoardTile title={title} ink={vInk.primary}>
    <FaceGrid sections={[5]} heads={false}>
      <FaceSection span={5}>
        <div class="env-rows face-span-all">
          {#each [['Amp', 'AEG'], ['Filter', 'FEG']] as [label, pre] (pre)}
            {@const loopParam = `${pre}${v} Loop`}
            <div class="env-row">
              <div class="env-head">
                <span class="env-label" style="color: {vInk.primary};">{label}</span>
                <div class="loop-pick" data-param={loopParam}>
                  <ChoicePicker options={LOOP_MODES} selected={step(loopParam)} onSelect={(i) => params.write(loopParam, lo(loopParam) + i)} label="{label} Env {v} loop" caption="Loop" tint={vInk.primary} ghost={!params.has(loopParam)} />
                </div>
              </div>
              <div class="env-graph-cell"><EnvelopeGraph {params} ink={vInk.primary} names={{ attack: `${pre}${v} Attack`, decay: `${pre}${v} Decay`, sustain: `${pre}${v} Sustain`, release: `${pre}${v} Rel` }} knobs="side" /></div>
              {@render stage(`${pre}${v} S Time`, 'S‑Time', 'sustain')}
            </div>
          {/each}
        </div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if (kind === 'aeg' || kind === 'feg') && v}
  <!-- The envelope's three modes, and velocity's two amounts. (The loop is
       on the Envelopes tile, on its envelope's name line.) -->
  <BoardTile title={title} ink={vInk.primary}>
    <FaceGrid sections={[2]}>
      <FaceSection span={2}>
        {#snippet head()}{@render heads([['Mode', 1], ['Vel', 1]])}{/snippet}
        <div class="stack">{@render sw(`${E} Exp`, 'Exp')}{@render sw(`${E} Free`, 'Free')}{@render sw(`${E} Legato`, 'Legato')}</div>
        <div class="stack">{@render knob(`${E} A < Vel`, 'Attack')}{@render knob(`${E} < Vel`, 'Level')}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if kind === 'lfo' && v}
  <!-- The LFO: its wave across the tile; the shapes as pictures down a
       column, Retrig over Hz / Beat, then the five knobs two to a column. -->
  <BoardTile title={title} ink={vInk.primary} on={isOn(`${L} On/Off`)} onToggle={() => flip(`${L} On/Off`)} switchParam="{L} On/Off" switchDisabled={!params.has(`${L} On/Off`)}>
    <FaceGrid sections={[5]} heads={false}>
      <FaceSection span={5}>
        <div class="face-span-all graph-board" style="--graph-rows: minmax(0, 0.45fr) minmax(0, 1.7fr);">
        <div class="graph"><LfoGraph {params} ink={vInk.primary} shape={LFO_SHAPES[step(`${L} Shape`)]} rate={lfoBeat ? `${L} SncRate` : `${L} Speed`} sw={`${L} On/Off`} /></div>
        {@render tab(`${L} Shape`, LFO_SHAPES, { glyph: 'lfo', sw: `${L} On/Off` })}
        <div class="col">
          <div class="touch">{@render sw(`${L} Retrig`, 'Retrig', vInk.primary, `${L} On/Off`)}</div>
          <div class="grow">{@render tab(`${L} Sync`, ['Hz', 'Beat'], { sw: `${L} On/Off` })}</div>
        </div>
        <div class="stack">
          {#if lfoBeat}
            {@render knob(`${L} SncRate`, 'Rate', { sw: `${L} On/Off`, steps: SYNC_RATES.length, size: 'm' })}
          {:else}
            {@render knob(`${L} Speed`, 'Speed', { sw: `${L} On/Off`, size: 'm' })}
          {/if}
          {@render knob(`${L} PW`, 'PW', { sw: `${L} On/Off` })}
        </div>
        <div class="stack">{@render knob(`${L} Phase`, 'Phase', { sw: `${L} On/Off` })}{@render knob(`${L} Delay`, 'Delay', { sw: `${L} On/Off` })}</div>
        {@render knob(`${L} Fade In`, 'Fade In', { sw: `${L} On/Off` })}
        </div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if kind === 'noise'}
  <!-- Noise's own four (each oscillator's level, switch and route are on
       its Osc tile): the level, then its route over its colour. -->
  <BoardTile title="Noise" ink={noiseInk.primary} on={isOn('Noise On/Off')} onToggle={() => flip('Noise On/Off')} switchParam="Noise On/Off" switchDisabled={!params.has('Noise On/Off')}>
    <FaceGrid sections={[2]} heads={false}>
      <FaceSection span={2}>
        {@render knob('Noise Level', 'Level', { color: noiseInk, sw: 'Noise On/Off', size: 'm' })}
        <div class="stack">{@render knob('Noise Balance', 'F1/F2', { color: noiseInk, sw: 'Noise On/Off' })}{@render knob('Noise Color', 'Color', { color: noiseInk, sw: 'Noise On/Off' })}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if kind === 'global'}
  <!-- The swap pill over Volume, Detune and the octave and semitone fields
       (three columns, so the patch's name fits); then Keys (the voice
       count over the priority), Unison and Glide, each a column of touch
       rows beside its knobs. -->
  <BoardTile title="Global" ink={ink.primary}>
    <FaceGrid sections={[3, 2, 2, 2]}>
      <FaceSection span={3}>
        <div class="face-span-3 pill-block">
          <div class="pill-row"><HostedSwapPill /></div>
          {@render knob('Volume', 'Volume', { color: ink })}
          {@render knob('Detune', 'Detune', { color: ink })}
          <div class="col">
            {@render picker('Octave', OCTAVES, 'Octave', undefined, ink.primary)}
            {@render picker('Semitone', SEMIS, 'Semi', undefined, ink.primary)}
          </div>
        </div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={2}>
        {#snippet head()}{@render sub('Keys', ink.primary)}{/snippet}
        <div class="col">
          {@render picker('Voices', VOICES, 'Voices', undefined, ink.primary)}
          <div class="grow">{@render tab('Key Priority', ['High', 'Low', 'Last'], { color: ink.primary })}</div>
        </div>
        <div class="stack">{@render knob('Key Stretch', 'Stretch', { color: ink })}{@render knob('Key Error', 'Error', { color: ink })}</div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={2}>
        {#snippet head()}{@render sub('Unison', ink.primary)}{/snippet}
        <div class="col">
          <div class="touch">{@render sw('Unison On/Off', 'On', ink.primary)}</div>
          <div class="grow">{@render tab('Unison Voices', ['2', '4'], { sw: 'Unison On/Off', color: ink.primary })}</div>
        </div>
        <div class="stack">{@render knob('Unison Detune', 'Detune', { sw: 'Unison On/Off', color: ink })}{@render knob('Unison Delay', 'Delay', { sw: 'Unison On/Off', color: ink })}</div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={2}>
        {#snippet head()}{@render sub('Glide', ink.primary)}{/snippet}
        <div class="col">
          <div class="touch">{@render sw('Glide On/Off', 'On', ink.primary)}</div>
          <div class="touch">{@render sw('Glide Legato', 'Legato', ink.primary, 'Glide On/Off')}</div>
          <div class="grow">{@render tab('Glide Mode', ['Prop', 'Const'], { sw: 'Glide On/Off', color: ink.primary })}</div>
        </div>
        {@render knob('Glide Time', 'Time', { sw: 'Glide On/Off', color: ink, size: 'm' })}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if kind === 'vibrato'}
  <!-- The vibrato: its amount the lead, then the rest two to a column. -->
  <BoardTile title="Vibrato" ink={ink.primary} on={isOn('Vib On/Off')} onToggle={() => flip('Vib On/Off')} switchParam="Vib On/Off" switchDisabled={!params.has('Vib On/Off')}>
    <FaceGrid sections={[4]} heads={false}>
      <FaceSection span={4}>
        {@render knob('Vib Amount', 'Amount', { sw: 'Vib On/Off', size: 'm', color: ink })}
        <div class="stack">{@render knob('Vib Speed', 'Speed', { sw: 'Vib On/Off', size: 'm', color: ink })}{@render knob('Vib Fade-In', 'Fade In', { sw: 'Vib On/Off', color: ink })}</div>
        <div class="stack">{@render knob('Vib Delay', 'Delay', { sw: 'Vib On/Off', color: ink })}{@render knob('Vib Error', 'Error', { sw: 'Vib On/Off', color: ink })}</div>
        {@render knob('Vib < ModWh', 'Mod Wh', { sw: 'Vib On/Off', color: ink })}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if kind === 'mpe'}
  <!-- Each amount's knob over the field naming its destination, two
       columns wide so the name fits, A over B; the bend ranges. -->
  <BoardTile title="MPE" ink={ink.primary}>
    <FaceGrid sections={[5]}>
      <FaceSection span={5}>
        {#snippet head()}{@render heads([['Pressure', 2], ['Slide', 2], ['Bend', 1]], ink.primary)}{/snippet}
        <div class="face-span-2 stack">
          {@render modKnob('Press Amt A', 'A', 'Pressure A', 'Press Dest A')}
          {@render modKnob('Press Amt B', 'B', 'Pressure B', 'Press Dest B')}
        </div>
        <div class="face-span-2 stack">
          {@render modKnob('Slide Amt A', 'A', 'Slide A', 'Slide Dest A')}
          {@render modKnob('Slide Amt B', 'B', 'Slide B', 'Slide Dest B')}
        </div>
        <div class="stack">{@render knob('PB Range', 'PB', { color: ink })}{@render knob('Note PB Range', 'Note', { color: ink })}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{/if}
</div>

<style>
  .analog-page {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
  }
  .analog-page > :global(*) {
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
  /* A column of touch rows and a growing tab or knob. */
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
  }
  .col > :global(.sw-cell) {
    flex: none;
    height: var(--height-touch);
  }
  .grow {
    flex: 1 1 0;
    min-height: 0;
  }
  .touch {
    flex: none;
    height: var(--height-touch);
  }
  .cell {
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  /* A switch or a field: one touch row, centred in its cell, so it lines
     up with the knob beside it rather than filling the column. */
  .sw-cell {
    display: flex;
    align-items: center;
    min-height: 0;
  }
  .sw-cell > :global(*) {
    width: 100%;
  }
  .grow.sw-cell {
    display: flex;
    align-items: center;
  }
  .grow > .cell {
    height: 100%;
  }
  .touch-row {
    height: var(--height-touch);
  }
  .switch {
    width: 100%;
    height: var(--height-touch);
    font-size: 0.8125rem;
  }
  /* The filter's families down a column, the lit one naming its slope under it. */
  .family-tab {
    display: grid;
    grid-auto-rows: minmax(0, 1fr);
    min-height: 0;
    height: 100%;
  }
  .family-tab .device-segment + .device-segment {
    border-left: 0;
    border-top: 1px solid var(--line-faint);
  }
  .family-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 0;
    min-width: 0;
    padding: 2px;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.1;
  }
  .family-sub {
    font-size: 0.625rem;
    font-weight: 500;
    opacity: 0.85;
  }
  /* A mod amount: the knob takes what its field leaves. */
  .mod-cell {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-height: 0;
    height: 100%;
  }
  .mod-knob {
    flex: 1 1 0;
    min-height: 0;
  }
  .mod-foot {
    flex: none;
    height: var(--picker-h, 2.25rem);
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .glyph {
    width: 100%;
    height: 100%;
    max-height: 22px;
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
  /* Both envelopes, Amp over Filter, each named over its row with its loop. */
  .env-rows {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    row-gap: var(--spacing-sm);
    min-height: 0;
  }
  .env-row {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: auto minmax(0, 1fr);
    row-gap: 0.25rem;
    min-height: 0;
  }
  .env-head {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    align-items: center;
  }
  .env-label {
    grid-column: span 3;
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: 0.75rem;
    opacity: 0.8;
  }
  .loop-pick {
    grid-column: span 2;
    min-width: 0;
    /* The loop's field on the name line: the bar's height, not a touch row. */
    --picker-h: 2.25rem;
  }
  .env-graph-cell {
    grid-column: span 4;
    min-width: 0;
    min-height: 0;
  }
  /* A board column is ~50px: a pick's value keeps what its padding gave. */
  .analog-page :global(.picker-button) {
    padding: 0 0.125rem;
    gap: 0.125rem;
  }
  /* The swap pill, one touch row over two knobs and the pitch fields. */
  .pill-block {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: var(--height-touch) minmax(0, 1fr);
    row-gap: var(--spacing-sm);
    min-height: 0;
  }
  .pill-row {
    grid-column: 1 / -1;
    min-width: 0;
  }
  :global([data-grammar="flat"]) .analog-page .family-tab .device-segment.active {
    background: var(--btn-tint);
    color: var(--flat-on-fg);
  }
  :global([data-grammar="flat"]) .analog-page .family-tab .device-segment:not(.active) {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
</style>
