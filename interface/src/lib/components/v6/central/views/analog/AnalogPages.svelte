<script lang="ts">
  /**
   * Analog's section pages, each hand-laid on the face grid (ADR-510), as
   * Drift's are (`drift/DriftPages.svelte`): equal columns on a page,
   * identical seams, one header line whose first section carries the way
   * back ("‹ Osc 1"), knobs at their ADR-509 size (medium in a column of
   * two, large where a column holds one), switches one touch row centred,
   * tabs for a few values and `ChoicePicker` for long lists. They replace
   * the rule-laid panel pages (`panel/analogPanel.ts`) for Analog. Every
   * control binds a parameter by Live's name through `usePanelParams`, and
   * a control inside a switched section writes with that section's switch
   * as the panel did, so a write is exactly what the panel page wrote.
   *
   * Envelope stages stay value boxes on these pages (ADR-509): side by side
   * at full height, their heights draw the envelope.
   *
   * On the full-screen board (`board`, ADR-512) every page is a tile at
   * once, so a page's way back is its plain name and a link its plain text,
   * and each page has a compact variant: Analog has more to show than any
   * other instrument, so every board column holds two knobs (or a column of
   * touch rows), a tab whose cells a board column cannot hold at the touch
   * floor is a `ChoicePicker` or stands down its column, the filter's pad
   * is its Freq and Res knobs, and the Envelopes page draws both envelopes'
   * boxes as two rows.
   */
  import type { Snippet } from 'svelte';
  import DeviceSlider from '../../../device-panel/DeviceSlider.svelte';
  import DeviceXY from '../../../device-panel/DeviceXY.svelte';
  import ScrubTabs from '../../../device-panel/ScrubTabs.svelte';
  import type { ControlGlyphName } from '../../../device-panel/ControlGlyph.svelte';
  import FaceGrid from '../../FaceGrid.svelte';
  import FaceSection from '../../FaceSection.svelte';
  import FaceSeam from '../../FaceSeam.svelte';
  import ChoicePicker from '../../ChoicePicker.svelte';
  import EnvelopeGraph from '../../EnvelopeGraph.svelte';
  import LfoGraph from '../../LfoGraph.svelte';
  import HostedSwapPill from '../../HostedSwapPill.svelte';
  import PanelEyebrow from '../panel/PanelEyebrow.svelte';
  import type { PanelParams } from '../panel/usePanelParams.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';
  import { analogFilterCurve, FILTER_FREQ_RANGE } from '$lib/utils/instrumentFilterCurves';
  import {
    ANALOG_FILTER_FAMILIES,
    ANALOG_FILTER_TYPES,
    ANALOG_DRIVES,
    filterTypeForFamily,
    driveAmount,
    driveIsAsym,
    driveForAmount,
    driveToggleAsym
  } from '../analogParams';

  interface Props {
    page: string;
    params: PanelParams;
    /** The device's own ink (Global, Noise's page). */
    ink: DeviceColorScheme;
    /** Each voice's colour, as on the face: Voice 1 orange, Voice 2 blue. */
    voiceInks: { 1: DeviceColorScheme; 2: DeviceColorScheme };
    noiseInk: DeviceColorScheme;
    onOpen: (page: string) => void;
    onBack: () => void;
    shapeGlyph: Snippet<[string]>;
    /**
     * A tile of the full-screen board (ADR-512): every page is on screen, so
     * a page's way back is its plain name, a link its plain text, and the
     * page draws its compact board variant. Global hosts the swap pill.
     */
    board?: boolean;
  }

  let { page, params, ink, voiceInks, noiseInk, onOpen, onBack, shapeGlyph, board = false }: Props = $props();

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

  /** Where "‹" leads: a detail page to its parent, the rest to the face. */
  let parent = $derived(
    kind === 'aeg' || kind === 'feg' || kind === 'amp' ? `env${v}` : kind === 'vibrato' || kind === 'mpe' ? 'global' : null
  );

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
  /** A control in a switched section is ghosted while the section is off. */
  const ghosted = (p: string, sw?: string) => !params.has(p) || (!!sw && params.has(sw) && !isOn(sw));

  // Each voice's names, Live's spelling (docs/reference/instruments/Analog.md).
  let O = $derived(`OSC${v}`);
  let o = $derived(`O${v}`);
  let F = $derived(`F${v}`);
  let L = $derived(`LFO${v}`);
  let E = $derived(kind === 'feg' ? `FEG${v}` : `AEG${v}`);

  // ---- the filter page's pad: cutoff across, resonance up.
  let fType = $derived(Math.max(0, step(`${F} Type`)));
  let fCurve = $derived(analogFilterCurve(fType));
  let drive = $derived(Math.max(0, step(`${F} Drive`)));
  let lfoBeat = $derived(step(`${L} Sync`) === 1);
</script>

<!-- A knob bound by name. `size` is its column's: medium in a column of
     two, large alone; small on the board, whose columns are ~50px. A parameter that steps but is not quantized (Live's
     synced rates) rounds. -->
{#snippet knob(param: string, title: string, opt: { sw?: string; steps?: number; size?: 's' | 'm' | 'l'; mark?: string; color?: DeviceColorScheme; icon?: ControlGlyphName } = {})}
  {@const l = lo(param)}
  {@const h = hi(param)}
  {@const mid = MID_ZERO.test(param)}
  {@const bipolar = mid || (l < 0 && h > 0)}
  <div class="cell" data-param={param}>
    <DeviceSlider
      value={params.raw(param) ?? l}
      {title}
      face="knob"
      knobSize={opt.size ?? (board ? 's' : 'm')}
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
     chooser as its caption (Drift's modKnob). -->
{#snippet modKnob(param: string, mark: string, title: string, dest: string)}
  <div class="mod-cell" data-param={param}>
    <div class="mod-knob">{@render knob(param, title, { mark, size: 'l', color: ink })}</div>
    <div class="mod-foot">
      <ChoicePicker options={MPE_DESTS} selected={step(dest)} onSelect={(i) => params.write(dest, lo(dest) + i)} label="{title} destination" tint={ink.primary} ghost={!params.has(dest)} />
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

<!-- A long list: its name over a chooser, centred in its cell. -->
{#snippet picker(param: string, labels: readonly string[], title: string, sw?: string)}
  <div class="cell picker-cell" data-param={param}>
    <span class="sub" style="color: {vInk.primary};">{title}</span>
    <ChoicePicker options={labels} selected={step(param)} onSelect={(i) => params.write(param, lo(param) + i, sw)} label={title} tint={vInk.primary} ghost={ghosted(param, sw)} />
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

{#snippet back()}
  {#if board}
    <span class="sub" style="color: {vInk.primary};">{title}</span>
  {:else}
    <button class="page-back" style="color: {vInk.primary};" data-back={parent ?? 'face'} onclick={() => (parent ? onOpen(parent) : onBack())}>‹ {title}</button>
  {/if}
{/snippet}

{#snippet sub(text: string, color: string = vInk.primary)}<span class="sub" style="color: {color};">{text}</span>{/snippet}

<!-- A pick as a button naming the value, opening the values over the
     view: a board column is too narrow for its tab. -->
{#snippet pick(param: string, labels: readonly string[], label: string, sw?: string)}
  <div class="cell pick-cell" data-param={param}>
    <ChoicePicker options={labels} selected={step(param)} onSelect={(i) => params.write(param, lo(param) + i, sw)} {label} tint={vInk.primary} ghost={ghosted(param, sw)} />
  </div>
{/snippet}

<!-- A board tile's header line: a name over each run of columns. -->
{#snippet heads(items: readonly (readonly [string, number])[], color: string = vInk.primary)}
  <div class="board-heads" style="grid-template-columns: repeat({items.reduce((n, [, span]) => n + span, 0)}, minmax(0, 1fr));">
    {#each items as [text, span], i (i)}<span class="sub" style="color: {color}; grid-column: span {span};">{text}</span>{/each}
  </div>
{/snippet}

<div class="analog-page" class:board data-analog-page={page}>
{#if board && kind === 'osc' && v}
  <!-- Seven columns: the shape down its column, the switch over the mode,
       octave and semitone, then the page's ten knobs two to a column. -->
  <FaceGrid sections={[2, 5]}>
    <FaceSection span={2}>
      {#snippet head()}{@render back()}{/snippet}
      {@render tab(`${O} Shape`, SHAPES, { glyph: 'osc', sw: `${O} On/Off` })}
      <div class="col">
        <div class="touch">{@render sw(`${O} On/Off`, 'On')}</div>
        <div class="pick-row">{@render pick(`${O} Mode`, ['Sub', 'Sync'], `Osc ${v} mode`, `${O} On/Off`)}</div>
        <div class="picker-row">{@render picker(`${O} Octave`, OCTAVES, 'Octave', `${O} On/Off`)}</div>
        <div class="picker-row">{@render picker(`${O} Semi`, SEMIS, 'Semi', `${O} On/Off`)}</div>
      </div>
    </FaceSection>
    <FaceSeam ink={vInk.primary} />
    <FaceSection span={5}>
      {#snippet head()}{@render heads([['Tone', 2], ['Out', 1], ['Pitch Env', 1], [`LFO ${v}`, 1]])}{/snippet}
      <div class="stack">{@render knob(`${o} Sub/Sync`, step(`${O} Mode`) === 1 ? 'Sync' : 'Sub', { sw: `${O} On/Off` })}{@render knob(`${O} Detune`, 'Detune', { sw: `${O} On/Off` })}</div>
      <div class="stack">{@render knob(`${O} PW`, 'PW', { sw: `${O} On/Off` })}{@render knob(`${o} Keytrack`, 'Key')}</div>
      <div class="stack">{@render knob(`${O} Level`, 'Level')}{@render knob(`${O} Balance`, 'F1/F2')}</div>
      <div class="stack">{@render knob(`PEG${v} Amount`, 'Amount')}{@render knob(`PEG${v} Time`, 'Time')}</div>
      <div class="stack">{@render knob(`${O} < LFO`, 'Pitch')}{@render knob(`${o} PW < LFO`, 'PW')}</div>
    </FaceSection>
  </FaceGrid>
{:else if board && kind === 'filter' && v}
  <!-- Six columns: the five families down a column (a second tap on the lit
       one flips its slope, as on the face), the switch over the drive and
       the link between the filters, the cutoff and resonance as knobs (the
       page's pad), then what moves them. -->
  <FaceGrid sections={[3, 3]}>
    <FaceSection span={3}>
      {#snippet head()}{@render back()}{/snippet}
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
        <div class="touch">{@render sw(`${F} On/Off`, 'On')}</div>
        <div class="picker-row">{@render picker(`${F} Drive`, ANALOG_DRIVES, 'Drive', `${F} On/Off`)}</div>
        {#if v === 1}
          <div class="grow">{@render knob('F1 To F2', 'To F2', { sw: 'F1 On/Off' })}</div>
        {:else}
          <div class="grow sw-cell">{@render sw('F2 Slave', 'Follow', vInk.primary, `${F} On/Off`)}</div>
        {/if}
      </div>
      <div class="stack">{@render knob(`${F} Freq`, 'Freq', { sw: `${F} On/Off` })}{@render knob(`${F} Resonance`, 'Res', { sw: `${F} On/Off` })}</div>
    </FaceSection>
    <FaceSeam ink={vInk.primary} />
    <FaceSection span={3}>
      {#snippet head()}{@render heads([['Key', 1], [`LFO ${v}`, 1], ['Env', 1]])}{/snippet}
      <div class="stack">{@render knob(`${F} Freq < Key`, 'Freq')}{@render knob(`${F} Reso < Key`, 'Res')}</div>
      <div class="stack">{@render knob(`${F} Freq < LFO`, 'Freq')}{@render knob(`${F} Res < LFO`, 'Res')}</div>
      <div class="stack">{@render knob(`${F} Freq < Env`, 'Freq')}{@render knob(`${F} Res < Env`, 'Res')}</div>
    </FaceSection>
  </FaceGrid>
{:else if board && kind === 'amp' && v}
  <!-- Four columns: Level over Pan, and what moves each, two to a column;
       the switch over the envelope's amount on the pan, in the Pan row. -->
  <FaceGrid sections={[4]}>
    <FaceSection span={4}>
      {#snippet head()}{@render heads([[title, 1], ['Key', 1], [`LFO ${v}`, 1], ['', 1]])}{/snippet}
      <div class="stack">{@render knob(`AMP${v} Level`, 'Level', { sw: `AMP${v} On/Off` })}{@render knob(`AMP${v} Pan`, 'Pan', { sw: `AMP${v} On/Off` })}</div>
      <div class="stack">{@render knob(`AMP${v} < Key`, 'Level', { sw: `AMP${v} On/Off` })}{@render knob(`A${v} Pan < Key`, 'Pan', { sw: `AMP${v} On/Off` })}</div>
      <div class="stack">{@render knob(`AMP${v} < LFO`, 'Level')}{@render knob(`A${v} Pan < LFO`, 'Pan')}</div>
      <div class="stack">{@render sw(`AMP${v} On/Off`, 'On')}{@render knob(`A${v} Pan < Env`, 'Env')}</div>
    </FaceSection>
  </FaceGrid>
{:else if board && kind === 'env' && v}
  <!-- Both envelopes' stages as boxes (ADR-509), Amp over Filter, a stage a
       column, as on the face; each row's name line carries its loop, two
       columns wide so every mode's name fits. -->
  <FaceGrid sections={[5]}>
    <FaceSection span={5}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="env-rows face-span-all">
        {#each [['Amp', 'AEG'], ['Filter', 'FEG']] as [label, pre] (pre)}
          {@const loopParam = `${pre}${v} Loop`}
          <div class="env-row">
            <div class="env-head">
              <span class="env-label" style="color: {vInk.primary};">{label}</span>
              <span class="env-label loop-label" style="color: {vInk.primary};">Loop</span>
              <div class="loop-pick" data-param={loopParam}>
                <ChoicePicker options={LOOP_MODES} selected={step(loopParam)} onSelect={(i) => params.write(loopParam, lo(loopParam) + i)} label="{label} Env {v} loop" tint={vInk.primary} ghost={!params.has(loopParam)} />
              </div>
            </div>
            <!-- The envelope as Live draws it (ADR-514), A, D, S and R dragged
                 on it; Sustain Time, which Live draws as a number, a box. -->
            <div class="env-graph-cell"><EnvelopeGraph {params} ink={vInk.primary} names={{ attack: `${pre}${v} Attack`, decay: `${pre}${v} Decay`, sustain: `${pre}${v} Sustain`, release: `${pre}${v} Rel` }} knobs="side" /></div>
            {@render stage(`${pre}${v} S Time`, 'S\u2011Time', 'sustain')}
          </div>
        {/each}
      </div>
    </FaceSection>
  </FaceGrid>
{:else if board && (kind === 'aeg' || kind === 'feg') && v}
  <!-- Two columns: the three modes, and velocity's two amounts. (The
       loop is on the Envelopes tile, on its envelope's name line.) -->
  <FaceGrid sections={[2]}>
    <FaceSection span={2}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="stack">{@render sw(`${E} Exp`, 'Exp')}{@render sw(`${E} Free`, 'Free')}{@render sw(`${E} Legato`, 'Legato')}</div>
      <div class="col">
        <span class="sub vel-label" style="color: {vInk.primary};">Vel</span>
        <div class="grow stack">{@render knob(`${E} A < Vel`, 'Attack')}{@render knob(`${E} < Vel`, 'Level')}</div>
      </div>
    </FaceSection>
  </FaceGrid>
{:else if board && kind === 'lfo' && v}
  <!-- Five columns: the shapes as pictures down a column, the switches over
       Hz / Beat, then the five knobs two to a column. -->
  <FaceGrid sections={[5]}>
    <FaceSection span={5}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="face-span-all graph-board" style="--graph-rows: minmax(0, 0.45fr) minmax(0, 1.7fr);">
      <div class="graph"><LfoGraph {params} ink={vInk.primary} shape={LFO_SHAPES[step(`${L} Shape`)]} rate={lfoBeat ? `${L} SncRate` : `${L} Speed`} sw={`${L} On/Off`} /></div>
      {@render tab(`${L} Shape`, LFO_SHAPES, { glyph: 'lfo', sw: `${L} On/Off` })}
      <div class="col">
        <div class="touch">{@render sw(`${L} On/Off`, 'On')}</div>
        <div class="touch">{@render sw(`${L} Retrig`, 'Retrig', vInk.primary, `${L} On/Off`)}</div>
        <div class="grow">{@render tab(`${L} Sync`, ['Hz', 'Beat'], { sw: `${L} On/Off` })}</div>
      </div>
      <div class="stack">
        {#if lfoBeat}
          {@render knob(`${L} SncRate`, 'Rate', { sw: `${L} On/Off`, steps: SYNC_RATES.length })}
        {:else}
          {@render knob(`${L} Speed`, 'Speed', { sw: `${L} On/Off` })}
        {/if}
        {@render knob(`${L} PW`, 'PW', { sw: `${L} On/Off` })}
      </div>
      <div class="stack">{@render knob(`${L} Phase`, 'Phase', { sw: `${L} On/Off` })}{@render knob(`${L} Delay`, 'Delay', { sw: `${L} On/Off` })}</div>
      <div class="stack">{@render knob(`${L} Fade In`, 'Fade In', { sw: `${L} On/Off` })}<div class="cell"></div></div>
      </div>
    </FaceSection>
  </FaceGrid>
{:else if board && kind === 'noise'}
  <!-- Noise's own four (each oscillator's level, switch and route are on
       its Osc tile): the switch over the level, the route over the colour. -->
  <FaceGrid sections={[2]}>
    <FaceSection span={2}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="col">
        <div class="touch">{@render sw('Noise On/Off', 'On', noiseInk.primary)}</div>
        <div class="grow">{@render knob('Noise Level', 'Level', { color: noiseInk, sw: 'Noise On/Off' })}</div>
      </div>
      <div class="stack">{@render knob('Noise Balance', 'F1/F2', { color: noiseInk, sw: 'Noise On/Off' })}{@render knob('Noise Color', 'Color', { color: noiseInk, sw: 'Noise On/Off' })}</div>
    </FaceSection>
  </FaceGrid>
{:else if board && kind === 'global'}
  <!-- Nine columns: the swap pill over Volume, Detune, octave and
       semitone (three columns, so the patch's name fits); then Keys (the
       voice count over the priority), Unison and Glide, each a column of
       touch rows (a short pick standing down it) beside two knobs. Vibrato's
       switch and amount and the bend ranges are on their own tiles. -->
  <FaceGrid sections={[3, 2, 2, 2]}>
    <FaceSection span={3}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="face-span-3 pill-block">
        <div class="pill-row"><HostedSwapPill /></div>
        {@render knob('Volume', 'Volume')}
        {@render knob('Detune', 'Detune')}
        <div class="col">
          <div class="picker-row">{@render picker('Octave', OCTAVES, 'Octave')}</div>
          <div class="picker-row">{@render picker('Semitone', SEMIS, 'Semi')}</div>
        </div>
      </div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render sub('Keys')}{/snippet}
      <div class="col">
        <div class="picker-row">{@render picker('Voices', VOICES, 'Voices')}</div>
        <div class="grow">{@render tab('Key Priority', ['High', 'Low', 'Last'])}</div>
      </div>
      <div class="stack">{@render knob('Key Stretch', 'Stretch')}{@render knob('Key Error', 'Error')}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render sub('Unison')}{/snippet}
      <div class="col">
        <div class="touch">{@render sw('Unison On/Off', 'On')}</div>
        <div class="grow">{@render tab('Unison Voices', ['2', '4'], { sw: 'Unison On/Off' })}</div>
      </div>
      <div class="stack">{@render knob('Unison Detune', 'Detune', { sw: 'Unison On/Off' })}{@render knob('Unison Delay', 'Delay', { sw: 'Unison On/Off' })}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render sub('Glide')}{/snippet}
      <div class="col">
        <div class="touch">{@render sw('Glide On/Off', 'On')}</div>
        <div class="touch">{@render sw('Glide Legato', 'Legato', ink.primary, 'Glide On/Off')}</div>
        <div class="grow">{@render tab('Glide Mode', ['Prop', 'Const'], { sw: 'Glide On/Off' })}</div>
      </div>
      <div class="stack">{@render knob('Glide Time', 'Time', { sw: 'Glide On/Off' })}<div class="cell"></div></div>
    </FaceSection>
  </FaceGrid>
{:else if board && kind === 'vibrato'}
  <!-- Four columns: the switch over the amount, then the rest two to a column. -->
  <FaceGrid sections={[4]}>
    <FaceSection span={4}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="col">
        <div class="touch">{@render sw('Vib On/Off', 'On')}</div>
        <div class="grow">{@render knob('Vib Amount', 'Amount', { sw: 'Vib On/Off' })}</div>
      </div>
      <div class="stack">{@render knob('Vib Speed', 'Speed', { sw: 'Vib On/Off' })}{@render knob('Vib Fade-In', 'Fade In', { sw: 'Vib On/Off' })}</div>
      <div class="stack">{@render knob('Vib Delay', 'Delay', { sw: 'Vib On/Off' })}{@render knob('Vib Error', 'Error', { sw: 'Vib On/Off' })}</div>
      <div class="stack">{@render knob('Vib < ModWh', 'Mod Wh', { sw: 'Vib On/Off' })}<div class="cell"></div></div>
    </FaceSection>
  </FaceGrid>
{:else if board && kind === 'mpe'}
  <!-- Five columns: each amount's knob over its destination, two columns
       wide so the destination's name fits, A over B; the bend ranges. -->
  <FaceGrid sections={[5]}>
    <FaceSection span={5}>
      {#snippet head()}{@render heads([['MPE Pressure', 2], ['Slide', 2], ['Bend', 1]], ink.primary)}{/snippet}
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
{/if}
</div>

<style>
  .analog-page {
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
  /* A column of a touch row, a growing tab and another touch row. */
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
  }
  .grow {
    flex: 1 1 0;
    min-height: 0;
  }
  .touch {
    flex: none;
    height: var(--height-touch);
  }
  .picker-row {
    flex: none;
  }
  .cell {
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  /* A switch or a short tab: one touch row, centred in its cell, so it
     lines up with the knob beside it rather than filling the column. */
  .sw-cell {
    display: flex;
    align-items: center;
    min-height: 0;
  }
  .sw-cell > :global(*) {
    width: 100%;
  }
  .touch-row {
    height: var(--height-touch);
  }
  .switch {
    width: 100%;
    height: var(--height-touch);
    font-size: 0.8125rem;
  }
  .picker-cell {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.25rem;
    height: auto;
  }
  /* The filter's families and its drive: a column of cells, the lit
     family naming its slope under it. */
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
  /* A mod amount: the knob takes what its chooser leaves. */
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
    height: 2.25rem;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .glyph {
    width: 100%;
    height: 100%;
    max-height: 22px;
  }
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
  .picker-cell .sub {
    text-align: center;
  }
  /* ---- The board (ADR-512). */
  .pick-row {
    flex: none;
  }
  .pick-cell {
    display: flex;
    align-items: center;
    height: auto;
  }
  .pick-cell > :global(*) {
    width: 100%;
  }
  .board-heads {
    flex: 1 1 auto;
    align-self: stretch;
    display: grid;
    column-gap: var(--face-gutter);
    justify-items: center;
    align-items: center;
    min-width: 0;
  }
  .grow.sw-cell {
    display: flex;
    align-items: center;
  }
  .grow > .cell {
    height: 100%;
  }
  /* Both envelopes' boxes, Amp over Filter, each named over its row. */
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
    row-gap: 2px;
    min-height: 0;
  }
  .env-head {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    align-items: center;
  }
  .env-label {
    grid-column: span 2;
    font-size: 0.6875rem;
    font-weight: 700;
    line-height: 0.75rem;
  }
  .env-label.loop-label {
    grid-column: span 1;
    justify-self: end;
  }
  .loop-pick {
    grid-column: span 2;
    min-width: 0;
  }
  .env-graph-cell {
    grid-column: span 4;
    min-width: 0;
    min-height: 0;
  }
  .vel-label {
    text-align: center;
  }
  /* A board column is ~50px: a pick's value keeps what its padding gave. */
  .analog-page.board :global(.picker-button) {
    padding: 0 0.125rem;
    gap: 0.125rem;
  }
  /* The swap pill, one touch row over two knobs. */
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
