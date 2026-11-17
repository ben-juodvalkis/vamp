<script lang="ts">
  import { press } from '$lib/actions/press';
  /**
   * Analog's board tiles (ADR-512, ADR-513), each a `BoardTile` panel
   * (ADR-516) hand-laid on the face grid (ADR-510): a header bar naming
   * the section with the section's switch at its right (Osc, Filter, Amp,
   * LFO, Vibrato and Noise each have one), then equal columns, identical
   * seams, every amount in the track's one ink and every knob of a tile
   * one size (ADR-544, 2026-11-17; a voice had a colour before). Every
   * control binds a parameter by Live's name through `usePanelParams`, and
   * a control inside a switched section writes with that section's switch,
   * so touching it while the section is off turns the section on first.
   *
   * Analog has more to show than any other instrument, so its board is
   * compact (8px inset and gap, ADR-434) and most columns hold two knobs,
   * small; a long pick is a `ChoicePicker` naming itself. The envelope
   * tiles draw each envelope as Live does (ADR-514), its stages two by two
   * beside the picture, knobs marked with their letter.
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
    /** The one ink every amount is drawn in: the selected track's (ADR-544). */
    ink: DeviceColorScheme;
    shapeGlyph: Snippet<[string]>;
  }

  let { page, params, ink, shapeGlyph }: Props = $props();

  /** A pick's value is a name in plain ink, never the amount's colour (ADR-544). */
  const PICK_INK = 'var(--label)';

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

<!-- A knob bound by name: small on the board, one size a tile. A
     parameter that steps but is not quantized (Live's synced rates) rounds.
     An amount about zero on a -1..1 range (a modulation's depth) is drawn
     over 0..1, so it reads as the continuous amount it is and shows no
     number at rest; what it writes is the same. -->
{#snippet knob(param: string, title: string, opt: { sw?: string; steps?: number; size?: 's' | 'm' | 'l'; mark?: string; bare?: boolean; icon?: ControlGlyphName } = {})}
  {@const l = lo(param)}
  {@const h = hi(param)}
  {@const mid = MID_ZERO.test(param)}
  {@const bipolar = mid || (l < 0 && h > 0)}
  {@const zero = mid ? (l + h) / 2 : 0}
  {@const unit = bipolar && !opt.steps && h - l <= 2 && h > l}
  {@const raw = params.raw(param)}
  <div class="cell" data-param={param}>
    <DeviceSlider
      value={unit ? ((raw ?? zero) - l) / (h - l) : (raw ?? l)}
      {title}
      face="knob"
      knobSize={opt.size ?? 's'}
      min={unit ? 0 : l}
      max={unit ? 1 : h}
      centerOrigin={bipolar}
      centerValue={bipolar ? (unit ? (zero - l) / (h - l) : zero) : undefined}
      steps={opt.steps}
      knobCaption={!opt.mark && !opt.bare}
      knobMark={opt.mark}
      icon={opt.icon}
      orientation="vertical"
      labelSize="small"
      isGhost={ghosted(param, opt.sw)}
      color={ink}
      readout={params.display(param)}
      onInteraction={(x) => params.write(param, opt.steps ? Math.round(x) : unit ? l + x * (h - l) : x, opt.sw)}
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
      color={ink}
      readout={params.display(param)}
      onInteraction={(x) => params.write(param, x)}
    />
  </div>
{/snippet}

<!-- A modulation amount: the knob, its mark inside, and its destination's
     field as its caption (Drift's modKnob). -->
{#snippet modKnob(param: string, mark: string, title: string, dest: string)}
  <div class="mod-cell" data-param={param}>
    <div class="mod-knob">{@render knob(param, title, { mark })}</div>
    <div class="mod-foot">
      <ChoicePicker options={MPE_DESTS} selected={step(dest)} onSelect={(i) => params.write(dest, lo(dest) + i)} label="{title} destination" caption="To" tint={PICK_INK} ghost={!params.has(dest)} />
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
{#snippet tab(param: string, labels: readonly string[], opt: { cols?: number; up?: boolean; glyph?: 'osc' | 'lfo'; sw?: string; touch?: boolean } = {})}
  {@const order = opt.up ? labels.map((_, i) => labels.length - 1 - i) : labels.map((_, i) => i)}
  <div class="cell panel-choice" class:touch-row={opt.touch} data-param={param}>
    <ScrubTabs
      options={order}
      selected={order.indexOf(step(param))}
      onSelect={(_, i) => params.write(param, lo(param) + i, opt.sw)}
      cols={opt.cols ?? 1}
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
{#snippet picker(param: string, labels: readonly string[], title: string, sw?: string)}
  <div class="cell sw-cell" data-param={param}>
    <ChoicePicker options={labels} selected={step(param)} onSelect={(i) => params.write(param, lo(param) + i, sw)} label={title} caption={title} tint={PICK_INK} ghost={ghosted(param, sw)} />
  </div>
{/snippet}

<!-- An on/off parameter: one touch row, centred in its cell, lit while on. -->
{#snippet sw(param: string, title: string, section?: string)}
  {@const on = isOn(param)}
  <div class="cell sw-cell">
    <button
      class="physical-button btn-toggle switch"
      class:active={on}
      aria-pressed={on}
      disabled={!params.has(param)}
      data-param={param}
      use:press={{ onPress: () => params.write(param, on ? lo(param) : hi(param), section), disabled: !params.has(param) }}
    >{title}</button>
  </div>
{/snippet}

{#snippet sub(text: string)}<span class="sub">{text}</span>{/snippet}

<!-- A section's header line: a name over each run of columns. -->
{#snippet heads(items: readonly (readonly [string, number])[])}
  <div class="col-heads" style="grid-template-columns: repeat({items.reduce((n, [, span]) => n + span, 0)}, minmax(0, 1fr));">
    {#each items as [text, span], i (i)}<span class="sub" style="grid-column: span {span};">{text}</span>{/each}
  </div>
{/snippet}

<div class="analog-page" data-analog-page={page}>
{#if kind === 'osc' && v}
  <!-- The oscillator: its shape down a column, its mode, octave and
       semitone a field each, then the page's ten knobs two to a column
       under their columns' names. -->
  <BoardTile title={title} ink={ink.primary} on={isOn(`${O} On/Off`)} onToggle={() => flip(`${O} On/Off`)} switchParam="{O} On/Off" switchDisabled={!params.has(`${O} On/Off`)}>
    <FaceGrid sections={[2, 5]}>
      <FaceSection span={2}>
        {@render tab(`${O} Shape`, SHAPES, { glyph: 'osc', sw: `${O} On/Off` })}
        <div class="col">
          {@render picker(`${O} Mode`, ['Sub', 'Sync'], 'Mode', `${O} On/Off`)}
          {@render picker(`${O} Octave`, OCTAVES, 'Octave', `${O} On/Off`)}
          {@render picker(`${O} Semi`, SEMIS, 'Semi', `${O} On/Off`)}
        </div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={5}>
        {#snippet head()}{@render heads([['Tone', 2], ['Out', 1], ['Pitch Env', 1], [`LFO ${v}`, 1]])}{/snippet}
        <div class="pair">{@render knob(`${o} Sub/Sync`, step(`${O} Mode`) === 1 ? 'Sync' : 'Sub', { sw: `${O} On/Off` })}{@render knob(`${O} Detune`, 'Detune', { sw: `${O} On/Off` })}</div>
        <div class="pair">{@render knob(`${O} PW`, 'PW', { sw: `${O} On/Off` })}{@render knob(`${o} Keytrack`, 'Key')}</div>
        <div class="pair">{@render knob(`${O} Level`, 'Level', {})}{@render knob(`${O} Balance`, 'F1/F2')}</div>
        <div class="pair">{@render knob(`PEG${v} Amount`, 'Amount')}{@render knob(`PEG${v} Time`, 'Time')}</div>
        <div class="pair">{@render knob(`${O} < LFO`, 'Pitch')}{@render knob(`${o} PW < LFO`, 'PW')}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if kind === 'filter' && v}
  <!-- The filter: the five families down a column (a second tap on the lit
       one flips its slope), its drive over the link between the filters,
       the cutoff over the resonance, then what moves them: every knob on
       one of the tile's two lines, one size. -->
  <BoardTile title={title} ink={ink.primary} on={isOn(`${F} On/Off`)} onToggle={() => flip(`${F} On/Off`)} switchParam="{F} On/Off" switchDisabled={!params.has(`${F} On/Off`)}>
    <FaceGrid sections={[3, 3]}>
      <FaceSection span={3}>
        <div class="family-tab device-segmented" data-param="{F} Type">
          {#each ANALOG_FILTER_FAMILIES as family, i}
            {@const t = Math.floor(fType / 2) === i ? fType : i * 2 + (fType % 2)}
            <button
              class="device-segment family-step"
              class:active={Math.floor(fType / 2) === i}
              title={ANALOG_FILTER_TYPES[t]}
              aria-label="Filter {v} {ANALOG_FILTER_TYPES[t]}"
              aria-pressed={Math.floor(fType / 2) === i}
              use:press={{ onPress: () => params.write(`${F} Type`, filterTypeForFamily(fType, i), `${F} On/Off`) }}
            >
              <span>{family.label}</span>
              {#if Math.floor(fType / 2) === i}<span class="family-sub">{family.slopes[fType % 2]}</span>{/if}
            </button>
          {/each}
        </div>
        <div class="pair">
          {@render picker(`${F} Drive`, ANALOG_DRIVES, 'Drive', `${F} On/Off`)}
          {#if v === 1}
            {@render knob('F1 To F2', 'To F2', { sw: 'F1 On/Off' })}
          {:else}
            {@render sw('F2 Slave', 'Follow F1', `${F} On/Off`)}
          {/if}
        </div>
        <div class="pair">{@render knob(`${F} Freq`, 'Freq', { sw: `${F} On/Off` })}{@render knob(`${F} Resonance`, 'Res', { sw: `${F} On/Off` })}</div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={3}>
        {#snippet head()}{@render heads([['Key', 1], [`LFO ${v}`, 1], ['Env', 1]])}{/snippet}
        <div class="pair">{@render knob(`${F} Freq < Key`, 'Freq')}{@render knob(`${F} Reso < Key`, 'Res')}</div>
        <div class="pair">{@render knob(`${F} Freq < LFO`, 'Freq')}{@render knob(`${F} Res < LFO`, 'Res')}</div>
        <div class="pair">{@render knob(`${F} Freq < Env`, 'Freq')}{@render knob(`${F} Res < Env`, 'Res')}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if kind === 'amp' && v}
  <!-- The amp: Level over Pan, and what moves each, two to a column; the
       envelope moves the pan alone, so its knob stands on the Pan line. -->
  <BoardTile title={title} ink={ink.primary} on={isOn(`AMP${v} On/Off`)} onToggle={() => flip(`AMP${v} On/Off`)} switchParam="AMP{v} On/Off" switchDisabled={!params.has(`AMP${v} On/Off`)}>
    <FaceGrid sections={[4]}>
      <FaceSection span={4}>
        {#snippet head()}{@render heads([['Amp', 1], ['Key', 1], [`LFO ${v}`, 1], ['Env', 1]])}{/snippet}
        <div class="pair">{@render knob(`AMP${v} Level`, 'Level', { sw: `AMP${v} On/Off` })}{@render knob(`AMP${v} Pan`, 'Pan', { sw: `AMP${v} On/Off` })}</div>
        <div class="pair">{@render knob(`AMP${v} < Key`, 'Level', { sw: `AMP${v} On/Off` })}{@render knob(`A${v} Pan < Key`, 'Pan', { sw: `AMP${v} On/Off` })}</div>
        <div class="pair">{@render knob(`AMP${v} < LFO`, 'Level')}{@render knob(`A${v} Pan < LFO`, 'Pan')}</div>
        <div class="pair"><div class="cell"></div>{@render knob(`A${v} Pan < Env`, 'Pan')}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if kind === 'env' && v}
  <!-- Both envelopes as Live draws them (ADR-514), Amp over Filter. A row
       is the picture, named in its top right corner (the one corner the
       line never reaches), over Sustain Time (which Live
       draws as a number: a box) and the loop; beside it the four stages
       two by two, each a knob marked with its letter. (Until 2026-11-17
       the stages were captioned knobs in cells too short for them, and
       the top pair's letters were cut by the pair under.) -->
  <BoardTile title={title} ink={ink.primary}>
    <FaceGrid sections={[5]} heads={false}>
      <FaceSection span={5}>
        <div class="env-rows face-span-all">
          {#each [['Amp', 'AEG'], ['Filter', 'FEG']] as [label, pre] (pre)}
            {@const loopParam = `${pre}${v} Loop`}
            <div class="env-row">
              <div class="env-picture"><span class="env-name">{label}</span><EnvelopeGraph {params} ink={ink.primary} names={{ attack: `${pre}${v} Attack`, decay: `${pre}${v} Decay`, sustain: `${pre}${v} Sustain`, release: `${pre}${v} Rel` }} knobs={false} /></div>
              <div class="env-foot">
                <div class="env-stime">{@render stage(`${pre}${v} S Time`, 'S‑Time', 'sustain')}</div>
                <div class="loop-pick" data-param={loopParam}>
                  <ChoicePicker options={LOOP_MODES} selected={step(loopParam)} onSelect={(i) => params.write(loopParam, lo(loopParam) + i)} label="{label} Env {v} loop" caption="Loop" tint={PICK_INK} ghost={!params.has(loopParam)} />
                </div>
              </div>
              <div class="env-stages">
                {@render knob(`${pre}${v} Attack`, 'Attack', { mark: 'A' })}
                {@render knob(`${pre}${v} Decay`, 'Decay', { mark: 'D' })}
                {@render knob(`${pre}${v} Sustain`, 'Sustain', { mark: 'S' })}
                {@render knob(`${pre}${v} Rel`, 'Release', { mark: 'R' })}
              </div>
            </div>
          {/each}
        </div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if (kind === 'aeg' || kind === 'feg') && v}
  <!-- The envelope's three modes, and velocity's two amounts. (The loop is
       on the Envelopes tile, on its envelope's name line.) -->
  <BoardTile title={title} ink={ink.primary}>
    <FaceGrid sections={[2]}>
      <FaceSection span={2}>
        {#snippet head()}{@render heads([['Mode', 1], ['Vel', 1]])}{/snippet}
        <div class="pair">{@render sw(`${E} Exp`, 'Exp')}{@render sw(`${E} Free`, 'Free')}{@render sw(`${E} Legato`, 'Legato')}</div>
        <div class="pair">{@render knob(`${E} A < Vel`, 'Attack')}{@render knob(`${E} < Vel`, 'Level')}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if kind === 'lfo' && v}
  <!-- The LFO (ADR-514): its shapes as pictures and Hz / Beat on the bar,
       as Wavetable's LFOs carry theirs, so the wave has the body; under it
       one row, Retrig and the five knobs, one size. (Until 2026-11-17 the
       shapes were a column of five 19px rows and the knobs about 25px.) -->
  <BoardTile title={title} ink={ink.primary} on={isOn(`${L} On/Off`)} onToggle={() => flip(`${L} On/Off`)} switchParam="{L} On/Off" switchDisabled={!params.has(`${L} On/Off`)}>
    {#snippet tools()}
      <div class="bar-tools">
        <div class="bar-shapes">{@render tab(`${L} Shape`, LFO_SHAPES, { glyph: 'lfo', cols: 5, sw: `${L} On/Off` })}</div>
        <div class="bar-sync">{@render tab(`${L} Sync`, ['Hz', 'Beat'], { cols: 2, sw: `${L} On/Off` })}</div>
      </div>
    {/snippet}
    <FaceGrid sections={[6]} heads={false}>
      <FaceSection span={6}>
        <div class="face-span-all picture-over-row">
          <div class="picture"><LfoGraph {params} ink={ink.primary} shape={LFO_SHAPES[step(`${L} Shape`)]} rate={lfoBeat ? `${L} SncRate` : `${L} Speed`} sw={`${L} On/Off`} /></div>
          {@render sw(`${L} Retrig`, 'Retrig', `${L} On/Off`)}
          {#if lfoBeat}
            {@render knob(`${L} SncRate`, 'Rate', { sw: `${L} On/Off`, steps: SYNC_RATES.length })}
          {:else}
            {@render knob(`${L} Speed`, 'Speed', { sw: `${L} On/Off` })}
          {/if}
          {@render knob(`${L} PW`, 'PW', { sw: `${L} On/Off` })}
          {@render knob(`${L} Phase`, 'Phase', { sw: `${L} On/Off` })}
          {@render knob(`${L} Delay`, 'Delay', { sw: `${L} On/Off` })}
          {@render knob(`${L} Fade In`, 'Fade In', { sw: `${L} On/Off` })}
        </div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if kind === 'noise'}
  <!-- Noise's own four (each oscillator's level, switch and route are on
       its Osc tile): the level, then its route over its colour. -->
  <BoardTile title="Noise" ink={ink.primary} on={isOn('Noise On/Off')} onToggle={() => flip('Noise On/Off')} switchParam="Noise On/Off" switchDisabled={!params.has('Noise On/Off')}>
    <FaceGrid sections={[2]} heads={false}>
      <FaceSection span={2}>
        {@render knob('Noise Level', 'Level', { sw: 'Noise On/Off' })}
        <div class="pair">{@render knob('Noise Balance', 'F1/F2', { sw: 'Noise On/Off' })}{@render knob('Noise Color', 'Color', { sw: 'Noise On/Off' })}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if kind === 'global'}
  <!-- The swap pill over Volume, Detune and the octave and semitone fields
       (four columns, so the patch's name fits; three cut it); then Keys
       (the voice count over the priority), Unison and Glide, each a column
       of touch rows beside its knobs. Every knob is one size, on the
       tile's two lines. -->
  <BoardTile title="Global" ink={ink.primary}>
    <FaceGrid sections={[4, 2, 2, 2]}>
      <FaceSection span={4}>
        <div class="face-span-4 pill-block">
          <div class="pill-row"><HostedSwapPill /></div>
          {@render knob('Volume', 'Volume')}
          {@render knob('Detune', 'Detune')}
          {@render picker('Octave', OCTAVES, 'Octave')}
          {@render picker('Semitone', SEMIS, 'Semi')}
        </div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={2}>
        {#snippet head()}{@render sub('Keys')}{/snippet}
        <div class="col">
          {@render picker('Voices', VOICES, 'Voices')}
          <div class="grow">{@render tab('Key Priority', ['High', 'Low', 'Last'])}</div>
        </div>
        <div class="pair">{@render knob('Key Stretch', 'Stretch')}{@render knob('Key Error', 'Error')}</div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={2}>
        {#snippet head()}{@render sub('Unison')}{/snippet}
        <div class="col">
          <div class="touch">{@render sw('Unison On/Off', 'On')}</div>
          <div class="grow">{@render tab('Unison Voices', ['2', '4'], { sw: 'Unison On/Off' })}</div>
        </div>
        <div class="pair">{@render knob('Unison Detune', 'Detune', { sw: 'Unison On/Off' })}{@render knob('Unison Delay', 'Delay', { sw: 'Unison On/Off' })}</div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={2}>
        {#snippet head()}{@render sub('Glide')}{/snippet}
        <div class="col">
          <div class="touch">{@render sw('Glide On/Off', 'On')}</div>
          <div class="touch">{@render sw('Glide Legato', 'Legato', 'Glide On/Off')}</div>
          <div class="grow">{@render tab('Glide Mode', ['Prop', 'Const'], { sw: 'Glide On/Off' })}</div>
        </div>
        <div class="pair">{@render knob('Glide Time', 'Time', { sw: 'Glide On/Off' })}<div class="cell"></div></div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if kind === 'vibrato'}
  <!-- The vibrato's six, two to a column, one size. -->
  <BoardTile title="Vibrato" ink={ink.primary} on={isOn('Vib On/Off')} onToggle={() => flip('Vib On/Off')} switchParam="Vib On/Off" switchDisabled={!params.has('Vib On/Off')}>
    <FaceGrid sections={[3]} heads={false}>
      <FaceSection span={3}>
        <div class="pair">{@render knob('Vib Amount', 'Amount', { sw: 'Vib On/Off' })}{@render knob('Vib Fade-In', 'Fade In', { sw: 'Vib On/Off' })}</div>
        <div class="pair">{@render knob('Vib Speed', 'Speed', { sw: 'Vib On/Off' })}{@render knob('Vib Error', 'Error', { sw: 'Vib On/Off' })}</div>
        <div class="pair">{@render knob('Vib Delay', 'Delay', { sw: 'Vib On/Off' })}{@render knob('Vib < ModWh', 'Mod Wh', { sw: 'Vib On/Off' })}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if kind === 'mpe'}
  <!-- Each amount's knob over the field naming its destination, two
       columns wide so the name fits, A over B; the bend ranges. -->
  <BoardTile title="MPE" ink={ink.primary}>
    <FaceGrid sections={[5]}>
      <FaceSection span={5}>
        {#snippet head()}{@render heads([['Pressure', 2], ['Slide', 2], ['Bend', 1]])}{/snippet}
        <div class="face-span-2 pair">
          {@render modKnob('Press Amt A', 'A', 'Pressure A', 'Press Dest A')}
          {@render modKnob('Press Amt B', 'B', 'Pressure B', 'Press Dest B')}
        </div>
        <div class="face-span-2 pair">
          {@render modKnob('Slide Amt A', 'A', 'Slide A', 'Slide Dest A')}
          {@render modKnob('Slide Amt B', 'B', 'Slide B', 'Slide Dest B')}
        </div>
        <!-- The bend ranges stand as the amounts beside them do: the knob,
             and its name where an amount's field is. -->
        <div class="pair">
          {#each [['PB Range', 'PB'], ['Note PB Range', 'Note']] as [param, name] (param)}
            <div class="mod-cell">
              <div class="mod-knob">{@render knob(param, name, { bare: true })}</div>
              <div class="mod-foot foot-name">{name}</div>
            </div>
          {/each}
        </div>
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
  /* Two or three controls to a column, on the tile's lines: equal shares,
     so the knobs of every column are one size (ADR-544; a higher rank took
     the larger share before) and a switch stands level with the knob
     beside it. */
  .pair {
    display: grid;
    grid-auto-rows: minmax(0, 1fr);
    row-gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
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
    color: var(--value);
  }
  /* Both envelopes, Amp over Filter: a row is the picture over Sustain
     Time and the loop, three columns, and the four stages two by two on
     the other two. */
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
    grid-template-rows: minmax(0, 1fr) 2.25rem;
    row-gap: 0.25rem;
    min-height: 0;
  }
  .env-picture {
    position: relative;
    grid-column: span 3;
    min-width: 0;
    min-height: 0;
  }
  /* The envelope's name, a section name, in the picture's clear corner. */
  .env-name {
    position: absolute;
    top: 0.25rem;
    right: 0.375rem;
    z-index: 1;
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: 0.75rem;
    color: var(--value);
    pointer-events: none;
  }
  .env-foot {
    grid-column: 1 / span 3;
    grid-row: 2;
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: var(--face-gutter);
    min-width: 0;
  }
  .env-stages {
    grid-column: 4 / span 2;
    grid-row: 1 / span 2;
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    row-gap: 0.25rem;
    min-width: 0;
    min-height: 0;
  }
  .env-stime {
    height: 2.25rem;
    min-width: 0;
  }
  /* On the name line the box is one bar high: its word at a label's size. */
  .env-stime :global(.slider-label-text) {
    font-size: 0.6875rem !important;
    letter-spacing: 0.02em;
  }
  .env-stime :global(.slider-icon) {
    display: none;
  }
  .loop-pick {
    min-width: 0;
    /* The loop's field on the name line: the bar's height, not a touch row. */
    --picker-h: 2.25rem;
  }
  /* A picture across the tile over one row: a switch and the knobs, a
     small knob and its name tall. */
  .picture-over-row {
    display: grid;
    /* Six across on a tighter gutter than the face's: at its 8px "Fade In"
       was a pixel too wide for its column. */
    grid-template-columns: repeat(6, minmax(0, 1fr));
    column-gap: 0.25rem;
    grid-template-rows: minmax(0, 1fr) 4.75rem;
    row-gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
  }
  .picture-over-row > .picture {
    grid-column: 1 / -1;
    min-height: 0;
    min-width: 0;
  }
  /* The LFO's shapes and its Hz / Beat on its bar, at the bar's height. */
  .bar-tools {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    width: 100%;
  }
  .bar-shapes,
  .bar-sync {
    height: var(--picker-h);
    min-width: 0;
  }
  .bar-shapes { flex: 2.4 1 0; }
  .bar-sync { flex: 1 1 0; }
  /* A bend range's name, where an amount's field stands. */
  .foot-name {
    align-items: center;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--label);
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
</style>
