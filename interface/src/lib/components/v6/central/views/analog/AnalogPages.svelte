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
  }

  let { page, params, ink, voiceInks, noiseInk, onOpen, onBack, shapeGlyph }: Props = $props();

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
     two, large alone. A parameter that steps but is not quantized (Live's
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
      knobSize={opt.size ?? 'm'}
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

<!-- A knob in a row of mod knobs: the same knob box, its name and value
     in the foot, so every knob in the row sits on one line. -->
{#snippet footKnob(param: string, title: string)}
  <div class="mod-cell" data-param={param}>
    <div class="mod-knob">{@render knob(param, title, { mark: ' ', size: 'l', color: ink })}</div>
    <div class="mod-foot foot-label" style="color: {ink.primary};">
      <span class="foot-title">{title}</span>
      <span class="foot-value">{params.display(param) ?? ''}</span>
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
      class="physical-button switch"
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
  <button class="page-back" style="color: {vInk.primary};" data-back={parent ?? 'face'} onclick={() => (parent ? onOpen(parent) : onBack())}>‹ {title}</button>
{/snippet}

{#snippet sub(text: string, color: string = vInk.primary)}<span class="sub" style="color: {color};">{text}</span>{/snippet}

{#snippet link(text: string, to: string, color: string = vInk.primary)}<PanelEyebrow title={text} page={to} {onOpen} {color} />{/snippet}

<div class="analog-page" data-analog-page={page}>
{#if kind === 'osc' && v}
  <!-- Eight columns (~105px): the oscillator's switch, shape, octave and
       mode as tabs, then its knobs two to a column, medium. -->
  <FaceGrid sections={[3, 2, 1, 2]}>
    <FaceSection span={3}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="col">
        <div class="touch">{@render sw(`${O} On/Off`, 'On')}</div>
        <div class="grow">{@render tab(`${O} Shape`, SHAPES, { glyph: 'osc', sw: `${O} On/Off` })}</div>
      </div>
      {@render tab(`${O} Octave`, OCTAVES, { up: true, sw: `${O} On/Off` })}
      <div class="col">
        <div class="grow">{@render tab(`${O} Mode`, ['Sub', 'Sync'], { sw: `${O} On/Off` })}</div>
        <div class="picker-row">{@render picker(`${O} Semi`, SEMIS, 'Semi', `${O} On/Off`)}</div>
      </div>
    </FaceSection>
    <FaceSeam ink={vInk.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render sub('Tone')}{/snippet}
      <div class="stack">{@render knob(`${o} Sub/Sync`, step(`${O} Mode`) === 1 ? 'Sync' : 'Sub', { sw: `${O} On/Off` })}{@render knob(`${O} Detune`, 'Detune', { sw: `${O} On/Off` })}</div>
      <div class="stack">{@render knob(`${O} PW`, 'PW', { sw: `${O} On/Off` })}{@render knob(`${o} Keytrack`, 'Key')}</div>
    </FaceSection>
    <FaceSeam ink={vInk.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render sub('Out')}{/snippet}
      <div class="stack">{@render knob(`${O} Level`, 'Level')}{@render knob(`${O} Balance`, 'F1 / F2')}</div>
    </FaceSection>
    <FaceSeam ink={vInk.primary} />
    <FaceSection span={2}>
      {#snippet head()}<div class="head-cols">{@render sub('Pitch Env')}{@render link(`LFO ${v}`, `lfo${v}`)}</div>{/snippet}
      <div class="stack">{@render knob(`PEG${v} Amount`, 'Amount')}{@render knob(`PEG${v} Time`, 'Time')}</div>
      <div class="stack">{@render knob(`${O} < LFO`, 'Pitch')}{@render knob(`${o} PW < LFO`, 'PW')}</div>
    </FaceSection>
  </FaceGrid>
{:else if kind === 'filter' && v}
  <!-- The pad is the filter's cutoff and resonance (the chain cell's pad
       is Filter 1's), the type and drive beside it, then what moves the
       cutoff and resonance: key, LFO and envelope, a column each. -->
  <FaceGrid sections={v === 1 ? [5, 1, 1, 1, 1] : [5, 1, 1, 1]}>
    <FaceSection span={5}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="col">
        <div class="touch">{@render sw(`${F} On/Off`, 'On')}</div>
        <div class="grow family-tab device-segmented" style="--btn-tint: {vInk.primary};">
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
        {#if v === 2}<div class="touch">{@render sw('F2 Slave', 'Follow F1', vInk.primary, `${F} On/Off`)}</div>{/if}
      </div>
      <!-- Drive: how much (Off, 1, 2, 3) and Asym for Live's asymmetric three. -->
      <div class="family-tab device-segmented" style="--btn-tint: {vInk.primary};" data-param="{F} Drive">
        {#each [0, 1, 2, 3] as amount}
          <button
            class="device-segment family-step"
            class:active={driveAmount(drive) === amount}
            title={ANALOG_DRIVES[driveForAmount(drive, amount)]}
            aria-label="Filter {v} drive {ANALOG_DRIVES[driveForAmount(drive, amount)]}"
            aria-pressed={driveAmount(drive) === amount}
            onclick={() => params.write(`${F} Drive`, driveForAmount(drive, amount), `${F} On/Off`)}
          >{amount === 0 ? 'Off' : `Drive ${amount}`}</button>
        {/each}
        <button
          class="device-segment family-step"
          class:active={driveIsAsym(drive)}
          aria-label="Filter {v} asymmetric drive"
          aria-pressed={driveIsAsym(drive)}
          onclick={() => params.write(`${F} Drive`, driveToggleAsym(drive), `${F} On/Off`)}
        >Asym</button>
      </div>
      <div class="face-span-3 pad">
        <DeviceXY
          xValue={params.unit(`${F} Freq`) ?? 1}
          yValue={params.unit(`${F} Resonance`) ?? 0}
          title="Filter {v}"
          showCurve={isOn(`${F} On/Off`)}
          curveType={fCurve.curveType}
          curveOrder={fCurve.order}
          curveFreqRange={FILTER_FREQ_RANGE.analog}
          onInteraction={(x, y) => {
            params.writeUnit(`${F} Freq`, x, `${F} On/Off`);
            params.writeUnit(`${F} Resonance`, y, `${F} On/Off`);
          }}
          color={vInk}
        />
      </div>
    </FaceSection>
    <FaceSeam ink={vInk.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render sub('Key')}{/snippet}
      <div class="stack">{@render knob(`${F} Freq < Key`, 'Freq')}{@render knob(`${F} Reso < Key`, 'Res')}</div>
    </FaceSection>
    <FaceSeam ink={vInk.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render link(`LFO ${v}`, `lfo${v}`)}{/snippet}
      <div class="stack">{@render knob(`${F} Freq < LFO`, 'Freq')}{@render knob(`${F} Res < LFO`, 'Res')}</div>
    </FaceSection>
    <FaceSeam ink={vInk.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render link('Env', `feg${v}`)}{/snippet}
      <div class="stack">{@render knob(`${F} Freq < Env`, 'Freq')}{@render knob(`${F} Res < Env`, 'Res')}</div>
    </FaceSection>
    {#if v === 1}
      <FaceSeam ink={vInk.primary} />
      <!-- Filter 1 feeds Filter 2 by this much. -->
      <FaceSection span={1}>
        {#snippet head()}{@render sub('To F2')}{/snippet}
        <div class="stack">{@render knob('F1 To F2', 'To F2', { sw: 'F1 On/Off' })}<div class="cell"></div></div>
      </FaceSection>
    {/if}
  </FaceGrid>
{:else if kind === 'env' && v}
  <!-- Both envelopes' stages as boxes, full height (ADR-509), ten columns
     (~88px). Each envelope's name opens its loop, mode and velocity; the
     amp's link opens its level, pan and their modulation. -->
  <FaceGrid sections={[5, 5]}>
    <FaceSection span={5}>
      {#snippet head()}{@render back()}{@render link('Amp Env', `aeg${v}`)}{@render link(`Amp ${v}`, `amp${v}`)}{/snippet}
      {@render stage(`AEG${v} Attack`, 'A', 'attack')}
      {@render stage(`AEG${v} Decay`, 'D', 'decay')}
      {@render stage(`AEG${v} Sustain`, 'S', 'sustain')}
      {@render stage(`AEG${v} S Time`, 'S Time', 'sustain')}
      {@render stage(`AEG${v} Rel`, 'R', 'release')}
    </FaceSection>
    <FaceSeam ink={vInk.primary} />
    <FaceSection span={5}>
      {#snippet head()}{@render link('Filter Env', `feg${v}`)}{/snippet}
      {@render stage(`FEG${v} Attack`, 'A', 'attack')}
      {@render stage(`FEG${v} Decay`, 'D', 'decay')}
      {@render stage(`FEG${v} Sustain`, 'S', 'sustain')}
      {@render stage(`FEG${v} S Time`, 'S Time', 'sustain')}
      {@render stage(`FEG${v} Rel`, 'R', 'release')}
    </FaceSection>
  </FaceGrid>
{:else if (kind === 'aeg' || kind === 'feg') && v}
  <!-- One envelope: its stages as boxes, then how it loops, its three
       modes and what velocity does to it. -->
  <FaceGrid sections={[5, 1, 1, 1]}>
    <FaceSection span={5}>
      {#snippet head()}{@render back()}{/snippet}
      {@render stage(`${E} Attack`, 'A', 'attack')}
      {@render stage(`${E} Decay`, 'D', 'decay')}
      {@render stage(`${E} Sustain`, 'S', 'sustain')}
      {@render stage(`${E} S Time`, 'S Time', 'sustain')}
      {@render stage(`${E} Rel`, 'R', 'release')}
    </FaceSection>
    <FaceSeam ink={vInk.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render sub('Loop')}{/snippet}
      {@render tab(`${E} Loop`, LOOP_MODES)}
    </FaceSection>
    <FaceSeam ink={vInk.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render sub('Mode')}{/snippet}
      <div class="stack">{@render sw(`${E} Exp`, 'Exp')}{@render sw(`${E} Free`, 'Free')}{@render sw(`${E} Legato`, 'Legato')}</div>
    </FaceSection>
    <FaceSeam ink={vInk.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render sub('Velocity')}{/snippet}
      <div class="stack">{@render knob(`${E} A < Vel`, 'Attack')}{@render knob(`${E} < Vel`, 'Level')}</div>
    </FaceSection>
  </FaceGrid>
{:else if kind === 'amp' && v}
  <!-- The amp: its switch, level and pan, then what moves each: key, LFO
       and (pan only) the envelope. Level on the top row, pan under it. -->
  <FaceGrid sections={[2, 1, 1, 1]}>
    <FaceSection span={2}>
      {#snippet head()}{@render back()}{/snippet}
      {@render sw(`AMP${v} On/Off`, 'On')}
      <div class="stack">{@render knob(`AMP${v} Level`, 'Level', { sw: `AMP${v} On/Off` })}{@render knob(`AMP${v} Pan`, 'Pan', { sw: `AMP${v} On/Off` })}</div>
    </FaceSection>
    <FaceSeam ink={vInk.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render sub('Key')}{/snippet}
      <div class="stack">{@render knob(`AMP${v} < Key`, 'Level', { sw: `AMP${v} On/Off` })}{@render knob(`A${v} Pan < Key`, 'Pan', { sw: `AMP${v} On/Off` })}</div>
    </FaceSection>
    <FaceSeam ink={vInk.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render link(`LFO ${v}`, `lfo${v}`)}{/snippet}
      <div class="stack">{@render knob(`AMP${v} < LFO`, 'Level')}{@render knob(`A${v} Pan < LFO`, 'Pan')}</div>
    </FaceSection>
    <FaceSeam ink={vInk.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render sub('Env')}{/snippet}
      <div class="stack"><div class="cell"></div>{@render knob(`A${v} Pan < Env`, 'Pan')}</div>
    </FaceSection>
  </FaceGrid>
{:else if kind === 'lfo' && v}
  <!-- Seven columns (~132px), every knob large in its own column: the
       shape as pictures between the switches and the Hz / Beat choice,
       then the rate (Speed, or the synced rate in Beat), pulse width,
       phase, delay and fade-in. -->
  <FaceGrid sections={[7]}>
    <FaceSection span={7}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="face-span-2 col">
        <div class="touch pair">{@render sw(`${L} On/Off`, 'On')}{@render sw(`${L} Retrig`, 'Retrig', vInk.primary, `${L} On/Off`)}</div>
        <div class="grow">{@render tab(`${L} Shape`, LFO_SHAPES, { cols: 3, glyph: 'lfo', sw: `${L} On/Off` })}</div>
        <div class="touch">{@render tab(`${L} Sync`, ['Hz', 'Beat'], { cols: 2, sw: `${L} On/Off` })}</div>
      </div>
      {#if lfoBeat}
        {@render knob(`${L} SncRate`, 'Rate', { sw: `${L} On/Off`, steps: SYNC_RATES.length, size: 'l' })}
      {:else}
        {@render knob(`${L} Speed`, 'Speed', { sw: `${L} On/Off`, size: 'l' })}
      {/if}
      {@render knob(`${L} PW`, 'PW', { sw: `${L} On/Off`, size: 'l' })}
      {@render knob(`${L} Phase`, 'Phase', { sw: `${L} On/Off`, size: 'l' })}
      {@render knob(`${L} Delay`, 'Delay', { sw: `${L} On/Off`, size: 'l' })}
      {@render knob(`${L} Fade In`, 'Fade In', { sw: `${L} On/Off`, size: 'l' })}
    </FaceSection>
  </FaceGrid>
{:else if kind === 'noise'}
  <!-- The three sources side by side, a row each: Osc 1, Osc 2, Noise.
       Their levels, their switches and where each goes (F1 / F2), then the
       noise's colour. -->
  <FaceGrid sections={[1, 1, 1, 1]}>
    <FaceSection span={1}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="stack">
        {@render knob('OSC1 Level', 'Osc 1', { mark: '1', color: voiceInks[1] })}
        {@render knob('OSC2 Level', 'Osc 2', { mark: '2', color: voiceInks[2] })}
        {@render knob('Noise Level', 'Noise', { mark: 'N', color: noiseInk, sw: 'Noise On/Off' })}
      </div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render sub('On', ink.primary)}{/snippet}
      <div class="stack">
        {@render sw('OSC1 On/Off', 'Osc 1', voiceInks[1].primary)}
        {@render sw('OSC2 On/Off', 'Osc 2', voiceInks[2].primary)}
        {@render sw('Noise On/Off', 'Noise', noiseInk.primary)}
      </div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render sub('F1 / F2', ink.primary)}{/snippet}
      <div class="stack">
        {@render knob('OSC1 Balance', 'Osc 1 F1 / F2', { mark: '1', color: voiceInks[1] })}
        {@render knob('OSC2 Balance', 'Osc 2 F1 / F2', { mark: '2', color: voiceInks[2] })}
        {@render knob('Noise Balance', 'Noise F1 / F2', { mark: 'N', color: noiseInk, sw: 'Noise On/Off' })}
      </div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render sub('Color', noiseInk.primary)}{/snippet}
      {@render knob('Noise Color', 'Color', { size: 'l', color: noiseInk, sw: 'Noise On/Off' })}
    </FaceSection>
  </FaceGrid>
{:else if kind === 'global'}
  <FaceGrid sections={[2, 2, 2, 2, 2]}>
    <FaceSection span={2}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="stack">{@render knob('Volume', 'Volume')}{@render knob('Detune', 'Detune')}</div>
      <div class="stack">
        {@render picker('Voices', VOICES, 'Voices')}
        {@render picker('Octave', OCTAVES, 'Octave')}
        {@render picker('Semitone', SEMIS, 'Semi')}
      </div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render sub('Keys')}{/snippet}
      {@render tab('Key Priority', ['High', 'Low', 'Last'])}
      <div class="stack">{@render knob('Key Stretch', 'Stretch')}{@render knob('Key Error', 'Error')}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render sub('Unison')}{/snippet}
      <div class="stack">
        {@render sw('Unison On/Off', 'On')}
        <div class="sw-cell">{@render tab('Unison Voices', ['2', '4'], { cols: 2, sw: 'Unison On/Off', touch: true })}</div>
      </div>
      <div class="stack">{@render knob('Unison Detune', 'Detune', { sw: 'Unison On/Off' })}{@render knob('Unison Delay', 'Delay', { sw: 'Unison On/Off' })}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render sub('Glide')}{/snippet}
      <div class="stack">{@render sw('Glide On/Off', 'On')}{@render sw('Glide Legato', 'Legato', ink.primary, 'Glide On/Off')}</div>
      <div class="stack">
        {@render knob('Glide Time', 'Time', { sw: 'Glide On/Off' })}
        <div class="sw-cell">{@render tab('Glide Mode', ['Prop', 'Const'], { cols: 2, sw: 'Glide On/Off', touch: true })}</div>
      </div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <!-- Vibrato and MPE share a section (one seam fewer), so ten columns
         are ~80px and every knob is its full medium. -->
    <FaceSection span={2}>
      {#snippet head()}<div class="head-cols">{@render link('Vibrato', 'vibrato', ink.primary)}{@render link('MPE', 'mpe', ink.primary)}</div>{/snippet}
      <div class="stack">{@render sw('Vib On/Off', 'On')}{@render knob('Vib Amount', 'Amount', { sw: 'Vib On/Off' })}</div>
      <div class="stack">{@render knob('PB Range', 'PB')}{@render knob('Note PB Range', 'Note PB')}</div>
    </FaceSection>
  </FaceGrid>
{:else if kind === 'vibrato'}
  <FaceGrid sections={[7]}>
    <FaceSection span={7}>
      {#snippet head()}{@render back()}{/snippet}
      {@render sw('Vib On/Off', 'On')}
      {@render knob('Vib Amount', 'Amount', { sw: 'Vib On/Off', size: 'l' })}
      {@render knob('Vib Speed', 'Speed', { sw: 'Vib On/Off', size: 'l' })}
      {@render knob('Vib Fade-In', 'Fade In', { sw: 'Vib On/Off', size: 'l' })}
      {@render knob('Vib Delay', 'Delay', { sw: 'Vib On/Off', size: 'l' })}
      {@render knob('Vib Error', 'Error', { sw: 'Vib On/Off', size: 'l' })}
      {@render knob('Vib < ModWh', 'Mod Wh', { sw: 'Vib On/Off', size: 'l' })}
    </FaceSection>
  </FaceGrid>
{:else if kind === 'mpe'}
  <!-- Each pressure and slide amount is a knob with its destination as its
       caption; the two bend ranges beside them on the same line. -->
  <FaceGrid sections={[2, 2, 2]}>
    <FaceSection span={2}>
      {#snippet head()}{@render back()}{@render sub('Pressure')}{/snippet}
      {@render modKnob('Press Amt A', 'A', 'Pressure A', 'Press Dest A')}
      {@render modKnob('Press Amt B', 'B', 'Pressure B', 'Press Dest B')}
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render sub('Slide')}{/snippet}
      {@render modKnob('Slide Amt A', 'A', 'Slide A', 'Slide Dest A')}
      {@render modKnob('Slide Amt B', 'B', 'Slide B', 'Slide Dest B')}
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render sub('Bend')}{/snippet}
      {@render footKnob('PB Range', 'PB')}
      {@render footKnob('Note PB Range', 'Note PB')}
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
  .touch.pair {
    display: flex;
    gap: var(--spacing-sm);
  }
  .touch.pair > :global(*) {
    flex: 1 1 0;
  }
  .picker-row {
    flex: none;
  }
  .cell {
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  .pad {
    min-height: 0;
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
  .stack > .picker-cell {
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
  .col > .family-tab {
    height: auto;
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
  .foot-label {
    align-items: center;
    font-size: 0.875rem;
    font-weight: 500;
  }
  .foot-value {
    font-size: 0.75rem;
    color: var(--signal-dim);
    font-variant-numeric: tabular-nums;
  }
  .glyph {
    width: 100%;
    height: 100%;
    max-height: 22px;
  }
  /* The header line: the page's way back, section names and links. */
  .head-cols {
    flex: 1 1 auto;
    align-self: stretch;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: var(--face-gutter);
    justify-items: center;
    align-items: center;
    min-width: 0;
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
  :global([data-grammar="flat"]) .analog-page .family-tab .device-segment.active {
    background: var(--btn-tint);
    color: var(--flat-on-fg);
  }
  :global([data-grammar="flat"]) .analog-page .family-tab .device-segment:not(.active) {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
</style>
