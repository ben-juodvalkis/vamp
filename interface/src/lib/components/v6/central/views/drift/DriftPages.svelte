<script lang="ts">
  /**
   * Drift's section pages (Oscillators, Filter, Envelopes, LFO / Mod,
   * Global), each hand-laid on the face grid (ADR-510, user 2026-11-06):
   * equal columns on a page, identical seams, one header line, every knob
   * a medium 70px. They replace the rule-laid panel pages for Drift, whose
   * groups each took their own width and whose knobs came out at 49 to
   * 96px. Every control binds a parameter by Live's name
   * (docs/reference/instruments/Drift.md) through `usePanelParams`, so a
   * write is exactly what the panel page wrote.
   *
   * The first section's header line carries the page's name with a "‹" that
   * leads back to the face, so no column is spent on a back button.
   *
   * On the full-screen board (`board`, ADR-512) every page is a tile at
   * once: a page's way back is its plain name, the Filter page's pad takes
   * four columns rather than eight, the LFO stands Rate over Amount and its
   * rate mode is a `ChoicePicker` (its tab too narrow for a board column),
   * and Global stands the voice mode in one column and Play beside Output,
   * so their row keeps every caption whole.
   */
  import type { Snippet } from 'svelte';
  import DeviceSlider from '../../../device-panel/DeviceSlider.svelte';
  import ScrubTabs from '../../../device-panel/ScrubTabs.svelte';
  import FaceGrid from '../../FaceGrid.svelte';
  import FaceSection from '../../FaceSection.svelte';
  import FaceSeam from '../../FaceSeam.svelte';
  import ChoicePicker from '../../ChoicePicker.svelte';
  import type { PanelParams } from '../panel/usePanelParams.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';

  interface Props {
    page: string;
    params: PanelParams;
    ink: DeviceColorScheme;
    /** The sources' own colours, as on the face: Osc 1, Osc 2, Noise. */
    sourceInks: { osc1: DeviceColorScheme; osc2: DeviceColorScheme; noise: DeviceColorScheme };
    onBack: () => void;
    filterPad: Snippet;
    voiceModeTab: Snippet;
    waveGlyph: Snippet<[string]>;
    /** A Drift device property (the mod sources, voice count), or undefined. */
    prop: (name: string) => number | undefined;
    setProp: (name: string, value: number) => void;
    /**
     * A tile of the full-screen board (ADR-512): every page is on screen, so
     * a page's way back is its plain name.
     */
    board?: boolean;
  }

  let { page, params, ink, sourceInks, onBack, filterPad, voiceModeTab, waveGlyph, prop, setProp, board = false }: Props = $props();

  /**
   * Live's own lists, read off the running Drift (12.4.15b2, 2026-11-06):
   * every `mod_matrix_*_source_*_list` is these eight, every
   * `mod_matrix_target_*_list` these twelve, `voice_count_list` these
   * five. Only the indices ride the wire.
   */
  const SOURCES = ['Env 1', 'Env 2', 'LFO', 'Key', 'Vel', 'Mod', 'Press', 'Slide'];
  const TARGETS = [
    'None', 'Osc 1 Gain', 'Osc 1 Shape', 'Osc 2 Gain', 'Osc 2 Detune', 'Noise Gain',
    'LP Frequency', 'LP Resonance', 'HP Frequency', 'LFO Rate', 'Cyc Env Rate', 'Main Volume'
  ];
  const VOICES = ['4', '8', '16', '24', '32'];
  /** The voice mode on the board, the face's order (Mono first); `value` is `voice_mode_index`. */
  const VOICE_MODES = [
    { value: 1, label: 'Mono' },
    { value: 0, label: 'Poly' },
    { value: 2, label: 'Stereo' },
    { value: 3, label: 'Unison' }
  ];

  const TITLES: Record<string, string> = {
    oscillators: 'Oscillators',
    filter: 'Filter',
    envelopes: 'Envelopes',
    'lfo-mod': 'LFO / Mod',
    global: 'Global'
  };

  // Waveforms by the face's glyph names, in each oscillator's own order.
  const OSC1_WAVES = ['Sin', 'Tri', 'Shark', 'Bump', 'Saw', 'Pulse', 'Sqr'];
  const OSC2_WAVES = ['Sin', 'Tri', 'Bump', 'Saw', 'Sqr'];
  const RATE_MODES = ['Freq', 'Time', 'Ratio', 'Sync'];
  /** The rate parameter each mode moves, in `LFO Mode` / `Cyc Env Mode` order. */
  const LFO_RATE = ['LFO Freq', 'LFO Time', 'LFO Ratio', 'LFO Synced'];
  const CYC_RATE = ['Cyc Env Rate', 'Cyc Env Time', 'Cyc Env Ratio', 'Cyc Env Synced'];
  const LFO_WAVES = ['Sine', 'Tri', 'Saw Up', 'Saw Dn', 'Square', 'S & H', 'Wander', 'Lin Env', 'Exp Env'];
  /**
   * The LFO's nine shapes as pictures (user, 2026-11-06), in `LFO Wave`
   * order, on the face's 24 x 12 glyph box: the periodic five cross the
   * midline, S & H steps, Wander drifts, and the two envelopes fall once.
   */
  const LFO_GLYPHS: Record<string, string> = {
    Sine: 'M0 6 Q3 0 6 6 T12 6 T18 6 T24 6',
    Tri: 'M0 6 L3 2 L9 10 L15 2 L21 10 L24 6',
    'Saw Up': 'M0 10 L10 2 L10 10 L20 2 L20 10',
    'Saw Dn': 'M0 2 L10 10 L10 2 L20 10 L20 2',
    Square: 'M0 10 L0 2 L6 2 L6 10 L12 10 L12 2 L18 2 L18 10 L24 10',
    'S & H': 'M0 7 L4 7 L4 3 L8 3 L8 9 L12 9 L12 5 L16 5 L16 10 L20 10 L20 4 L24 4',
    // The last three after Live's own pictures (Ben's screenshots,
    // 2026-11-06): Wander swings once and settles; the envelopes fall to a
    // floor and stay there, straight or curved.
    Wander: 'M0 8 C2 8 3 1 5 2 C7 3 7 10 9 8 C11 6 12 5 14 6 C16 7 18 6.5 24 6.5',
    'Lin Env': 'M0 3 L11 8 L24 8',
    'Exp Env': 'M0 2 C2 7 5 8 11 8 L24 8'
  };

  /** Amounts that run -100 %..+100 % over 0..1, zero in the middle (Drift.md). */
  const BIPOLAR = new Set([
    'Osc 1 Shape Mod Amt', 'Pitch Mod Amt 1', 'Pitch Mod Amt 2', 'LP Mod Amt 1', 'LP Mod Amt 2',
    'LFO Mod Amt', 'Mod Matrix Amt 1', 'Mod Matrix Amt 2', 'Mod Matrix Amt 3'
  ]);

  const lo = (p: string) => params.range(p)?.min ?? 0;
  const hi = (p: string) => params.range(p)?.max ?? 1;
  const step = (p: string) => {
    const v = params.raw(p);
    return v === undefined ? -1 : Math.round(v - lo(p));
  };
  const isOn = (p: string) => params.has(p) && (params.raw(p) ?? 0) >= 0.5;

  let lfoRate = $derived(LFO_RATE[step('LFO Mode')] ?? 'LFO Freq');
  let cycRate = $derived(CYC_RATE[step('Cyc Env Mode')] ?? 'Cyc Env Rate');
  let env2Cyc = $derived(isOn('Env 2 Cyc On'));
  let o1 = $derived(sourceInks.osc1);
  let o2 = $derived(sourceInks.osc2);
  let nz = $derived(sourceInks.noise);
</script>

<!-- A knob bound by name: medium, its name under it or beside it. A
     parameter that is not quantized but steps (the Synced rates) rounds. -->
{#snippet knob(param: string, title: string, steps?: number, mark?: string, color: DeviceColorScheme = ink, size: 's' | 'm' | 'l' = 'm')}
  {@const l = lo(param)}
  {@const h = hi(param)}
  {@const bipolar = BIPOLAR.has(param) || (l < 0 && h > 0)}
  <div class="cell" data-param={param}>
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
      knobCaption={!mark}
      knobMark={mark}
      orientation="vertical"
      labelSize="small"
      isGhost={!params.has(param)}
      {color}
      readout={params.display(param)}
      onInteraction={(v) => params.write(param, steps ? Math.round(v) : v)}
    />
  </div>
{/snippet}

<!-- A modulation amount: the knob with its mark inside, and under it the
     chooser naming its source, which is the knob's caption. A matrix slot
     adds a second chooser, its target. -->
{#snippet modKnob(param: string, mark: string, title: string, source: string, target?: string, color: DeviceColorScheme = ink, size: 's' | 'm' | 'l' = 'm', footed = false)}
  <div class="mod-cell" class:footed data-param={param}>
    <div class="mod-knob">{@render knob(param, title, undefined, mark, color, size)}</div>
    <div class="mod-foot">
      <ChoicePicker options={SOURCES} selected={prop(source)} onSelect={(i) => setProp(source, i)} label="{title} source" tint={color.primary} ghost={prop(source) === undefined} />
      {#if target}
        <ChoicePicker options={TARGETS} selected={prop(target)} onSelect={(i) => setProp(target, i)} label="{title} target" tint={color.primary} ghost={prop(target) === undefined} />
      {/if}
    </div>
  </div>
{/snippet}

<!-- A knob in a row of footed mod knobs: the same knob box, its name and
     value in the foot, so every knob in the row sits on one line. -->
{#snippet footKnob(param: string, title: string, steps?: number)}
  <div class="mod-cell footed" data-param={param}>
    <div class="mod-knob">{@render knob(param, title, steps, ' ', ink, 'l')}</div>
    <div class="mod-foot foot-label" style="color: {ink.primary};">
      <span class="foot-title">{title}</span>
      <span class="foot-value">{params.display(param) ?? ''}</span>
    </div>
  </div>
{/snippet}

{#snippet lfoGlyph(label: string)}
  <svg class="lfo-glyph" viewBox="0 0 24 12" role="img" aria-label={label}>
    <path d={LFO_GLYPHS[label] ?? ''} fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
  </svg>
{/snippet}

<!-- A pick of named values, one cell each, scrubbed. `up` lists the last
     value first (an octave climbs as the eye does). -->
{#snippet tab(param: string, labels: readonly string[], opts: { cols?: number; up?: boolean; glyph?: boolean; lfo?: boolean; color?: string } = {})}
  {@const order = opts.up ? labels.map((_, i) => labels.length - 1 - i) : labels.map((_, i) => i)}
  <div class="cell panel-choice" data-param={param}>
  <ScrubTabs
    options={order}
    selected={order.indexOf(step(param))}
    onSelect={(_, i) => params.write(param, lo(param) + i)}
    cols={opts.cols ?? 1}
    tint={opts.color ?? ink.primary}
    inked
    ghost={!params.has(param)}
    label={(i) => labels[i]}
    groupLabel={param}
    style="height: 100%; --scrub-font-size: 0.75rem;"
  >
    {#snippet item(i)}{#if opts.lfo}{@render lfoGlyph(labels[i])}{:else if opts.glyph}{@render waveGlyph(labels[i])}{:else}{labels[i]}{/if}{/snippet}
  </ScrubTabs>
  </div>
{/snippet}

<!-- An on/off parameter: one cell, lit while on. -->
{#snippet sw(param: string, title: string, color: string = ink.primary)}
  {@const on = isOn(param)}
  <div class="cell sw-cell">
  <button
    class="physical-button switch"
    class:active={on}
    aria-pressed={on}
    disabled={!params.has(param)}
    style="--btn-tint: {color};"
    data-param={param}
    onclick={() => params.write(param, on ? lo(param) : hi(param))}
  >{title}</button>
  </div>
{/snippet}

{#snippet back()}
  {#if board}
    <span class="sub" style="color: {ink.primary};">{TITLES[page] ?? page}</span>
  {:else}
    <button class="page-back" style="color: {ink.primary};" onclick={onBack}>‹ {TITLES[page] ?? page}</button>
  {/if}
{/snippet}

<!-- A pick as a button naming the value, opening the values over the
     view: a board tile's column is too narrow for its tab. -->
{#snippet pick(param: string, labels: readonly string[], title: string)}
  <div class="cell sw-cell" data-param={param}>
    <ChoicePicker options={labels} selected={params.has(param) ? step(param) : undefined} onSelect={(i) => params.write(param, lo(param) + i)} label={title} tint={ink.primary} ghost={!params.has(param)} />
  </div>
{/snippet}

<div class="drift-page" data-drift-page={page}>
{#if page === 'oscillators'}
  <FaceGrid sections={[3, 3, 1, 1, 1, 1]}>
    <FaceSection span={3}>
      {#snippet head()}{@render back()}<span class="sub" style="color: {o1.primary};">Osc 1</span>{/snippet}
      {@render tab('Osc 1 Wave', OSC1_WAVES, { glyph: true, color: o1.primary })}
      {@render tab('Osc 1 Oct', ['-2', '-1', '0', '+1', '+2', '+3'], { up: true, color: o1.primary })}
      <div class="stack">{@render knob('Osc 1 Shape', 'Shape', undefined, undefined, o1)}{@render modKnob('Osc 1 Shape Mod Amt', 'M', 'Shape Mod', 'mod_matrix_shape_source_index', undefined, o1)}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={3}>
      {#snippet head()}<span class="sub" style="color: {o2.primary};">Osc 2</span>{/snippet}
      {@render tab('Osc 2 Wave', OSC2_WAVES, { glyph: true, color: o2.primary })}
      {@render tab('Osc 2 Oct', ['-3', '-2', '-1', '0', '+1', '+2'], { up: true, color: o2.primary })}
      <div class="stack">{@render knob('Osc 2 Detune', 'Detune', undefined, undefined, o2)}<div class="cell"></div></div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <!-- Each source's level, its switch and its route to the filter, in
         rows: Osc 1, Osc 2, Noise. -->
    <FaceSection span={1}>
      {#snippet head()}<span class="sub" style="color: {ink.primary};">Level</span>{/snippet}
      <div class="stack">{@render knob('Osc 1 Gain', 'Osc 1', undefined, '1', o1)}{@render knob('Osc 2 Gain', 'Osc 2', undefined, '2', o2)}{@render knob('Noise Gain', 'Noise', undefined, 'N', nz)}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}<span class="sub" style="color: {ink.primary};">On</span>{/snippet}
      <div class="stack">{@render sw('Osc 1 On', 'Osc 1', o1.primary)}{@render sw('Osc 2 On', 'Osc 2', o2.primary)}{@render sw('Noise On', 'Noise', nz.primary)}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}<span class="sub" style="color: {ink.primary};">To Filter</span>{/snippet}
      <div class="stack">{@render sw('Osc 1 Flt On', 'Osc 1', o1.primary)}{@render sw('Osc 2 Flt On', 'Osc 2', o2.primary)}{@render sw('Noise Flt On', 'Noise', nz.primary)}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}<span class="sub" style="color: {ink.primary};">Pitch Mod</span>{/snippet}
      <div class="stack">{@render modKnob('Pitch Mod Amt 1', '1', 'Pitch Mod 1', 'mod_matrix_pitch_source_1_index')}{@render modKnob('Pitch Mod Amt 2', '2', 'Pitch Mod 2', 'mod_matrix_pitch_source_2_index')}</div>
    </FaceSection>
  </FaceGrid>
{:else if page === 'filter' && board}
  <!-- On the board (ADR-512) the pad takes four columns, so the page sits
       beside the Envelopes. -->
  <FaceGrid sections={[4, 1, 1]}>
    <FaceSection span={4}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="face-span-all pad">{@render filterPad()}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}<span class="sub" style="color: {ink.primary};">Low Pass</span>{/snippet}
      <div class="stack">{@render tab('LP Type', ['I', 'II'])}{@render knob('Key > LPF', 'Key')}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}<span class="sub" style="color: {ink.primary};">Mod</span>{/snippet}
      <div class="stack">{@render modKnob('LP Mod Amt 1', '1', 'Filter Mod 1', 'mod_matrix_filter_source_1_index')}{@render modKnob('LP Mod Amt 2', '2', 'Filter Mod 2', 'mod_matrix_filter_source_2_index')}</div>
    </FaceSection>
  </FaceGrid>
{:else if page === 'filter'}
  <!-- The pad sets LP Freq, LP Res and HP Freq (its two dots), so they
       have no knobs here (user, 2026-11-06). -->
  <FaceGrid sections={[8, 1, 1]}>
    <FaceSection span={8}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="face-span-all pad">{@render filterPad()}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}<span class="sub" style="color: {ink.primary};">Low Pass</span>{/snippet}
      <div class="stack">{@render tab('LP Type', ['I', 'II'])}{@render knob('Key > LPF', 'Key')}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}<span class="sub" style="color: {ink.primary};">Mod</span>{/snippet}
      <div class="stack">{@render modKnob('LP Mod Amt 1', '1', 'Filter Mod 1', 'mod_matrix_filter_source_1_index')}{@render modKnob('LP Mod Amt 2', '2', 'Filter Mod 2', 'mod_matrix_filter_source_2_index')}</div>
    </FaceSection>
  </FaceGrid>
{:else if page === 'envelopes'}
  <FaceGrid sections={[4, 5]}>
    <FaceSection span={4}>
      {#snippet head()}{@render back()}<span class="sub" style="color: {ink.primary};">Env 1 (Amp)</span>{/snippet}
      {@render knob('Env 1 Attack', 'Attack')}
      {@render knob('Env 1 Decay', 'Decay')}
      {@render knob('Env 1 Sustain', 'Sustain')}
      {@render knob('Env 1 Release', 'Release')}
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <!-- Env 2 is an ADSR or, switched to Cyc, the cycling envelope: the
         four columns after the switch draw whichever it is. -->
    <FaceSection span={5}>
      {#snippet head()}<span class="sub" style="color: {ink.primary};">Env 2</span>{/snippet}
      {@render tab('Env 2 Cyc On', ['Env', 'Cyc'])}
      {#if env2Cyc}
        {@render tab('Cyc Env Mode', RATE_MODES)}
        {@render knob(cycRate, step('Cyc Env Mode') === 3 ? 'Sync' : 'Rate', step('Cyc Env Mode') === 3 ? 22 : undefined)}
        {@render knob('Cyc Env Tilt', 'Tilt')}
        {@render knob('Cyc Env Hold', 'Hold')}
      {:else}
        {@render knob('Env 2 Attack', 'Attack')}
        {@render knob('Env 2 Decay', 'Decay')}
        {@render knob('Env 2 Sustain', 'Sustain')}
        {@render knob('Env 2 Release', 'Release')}
      {/if}
    </FaceSection>
  </FaceGrid>
{:else if page === 'lfo-mod' && board}
  <!-- On the board (ADR-512) seven columns, so Global beside it keeps every
       caption: Rate over Amount in one column, and the rate mode a pick
       (four cells are too narrow for a board column). -->
  <FaceGrid sections={[4, 3]}>
    <FaceSection span={4}>
      {#snippet head()}{@render back()}<span class="sub" style="color: {ink.primary};">LFO</span>{/snippet}
      <div class="face-span-2 lfo-shape">
        <div class="lfo-waves">{@render tab('LFO Wave', LFO_WAVES, { cols: 3, lfo: true })}</div>
        <div class="lfo-mode">{@render pick('LFO Mode', RATE_MODES, 'LFO rate mode')}</div>
        {@render sw('LFO Retrig On', 'Retrig')}
      </div>
      <div class="stack">
        {@render knob(lfoRate, step('LFO Mode') === 3 ? 'Sync' : 'Rate', step('LFO Mode') === 3 ? 22 : undefined)}
        {@render knob('LFO Amount', 'Amount')}
      </div>
      {@render modKnob('LFO Mod Amt', 'M', 'LFO Mod', 'mod_matrix_lfo_source_index', undefined, ink, 'l', true)}
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={3}>
      {#snippet head()}<span class="sub" style="color: {ink.primary};">Matrix</span>{/snippet}
      {@render modKnob('Mod Matrix Amt 1', '1', 'Matrix 1', 'mod_matrix_source_1_index', 'mod_matrix_target_1_index', ink, 'l', true)}
      {@render modKnob('Mod Matrix Amt 2', '2', 'Matrix 2', 'mod_matrix_source_2_index', 'mod_matrix_target_2_index', ink, 'l', true)}
      {@render modKnob('Mod Matrix Amt 3', '3', 'Matrix 3', 'mod_matrix_source_3_index', 'mod_matrix_target_3_index', ink, 'l', true)}
    </FaceSection>
  </FaceGrid>
{:else if page === 'lfo-mod'}
  <!-- Eight columns (~111px), so every knob is large (user, 2026-11-06):
       the shape as pictures over the rate mode and Retrig in two columns,
       then Rate, Amount and LFO Mod a column each; the matrix's three slots
       a column each, the amount over its source and target. -->
  <FaceGrid sections={[5, 3]}>
    <FaceSection span={5}>
      {#snippet head()}{@render back()}<span class="sub" style="color: {ink.primary};">LFO</span>{/snippet}
      <div class="face-span-2 lfo-shape">
        <div class="lfo-waves">{@render tab('LFO Wave', LFO_WAVES, { cols: 3, lfo: true })}</div>
        <div class="lfo-mode">{@render tab('LFO Mode', RATE_MODES, { cols: 4 })}</div>
        {@render sw('LFO Retrig On', 'Retrig')}
      </div>
      {@render footKnob(lfoRate, step('LFO Mode') === 3 ? 'Sync' : 'Rate', step('LFO Mode') === 3 ? 22 : undefined)}
      {@render footKnob('LFO Amount', 'Amount')}
      {@render modKnob('LFO Mod Amt', 'M', 'LFO Mod', 'mod_matrix_lfo_source_index', undefined, ink, 'l', true)}
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <!-- Drift's matrix: three slots, each an amount, a source and a target. -->
    <FaceSection span={3}>
      {#snippet head()}<span class="sub" style="color: {ink.primary};">Matrix</span>{/snippet}
      {@render modKnob('Mod Matrix Amt 1', '1', 'Matrix 1', 'mod_matrix_source_1_index', 'mod_matrix_target_1_index', ink, 'l', true)}
      {@render modKnob('Mod Matrix Amt 2', '2', 'Matrix 2', 'mod_matrix_source_2_index', 'mod_matrix_target_2_index', ink, 'l', true)}
      {@render modKnob('Mod Matrix Amt 3', '3', 'Matrix 3', 'mod_matrix_source_3_index', 'mod_matrix_target_3_index', ink, 'l', true)}
    </FaceSection>
  </FaceGrid>
{:else if page === 'global' && board}
  <!-- On the board (ADR-512) seven columns in two sections: the voice
       mode, one pick a row, over the voice count, then the Voice knobs;
       Play beside Output. -->
  <FaceGrid sections={[4, 3]}>
    <FaceSection span={4}>
      {#snippet head()}{@render back()}<span class="sub" style="color: {ink.primary};">Voice</span>{/snippet}
      <div class="stack">
        <div class="voice-mode">
          <ScrubTabs
            options={VOICE_MODES}
            selected={VOICE_MODES.findIndex((o) => o.value === prop('voice_mode_index'))}
            onSelect={(_, o) => setProp('voice_mode_index', o.value)}
            cols={1}
            tint={ink.primary}
            label={(o) => o.label}
            class="h-full"
            style="--scrub-font-size: 0.75rem; --scrub-font-weight: 500; --scrub-padding: 0 0.25rem;"
          />
        </div>
        <div class="voices-col">
          <span class="sub" style="color: {ink.primary};">Voices</span>
          <ChoicePicker options={VOICES} selected={prop('voice_count_index')} onSelect={(i) => setProp('voice_count_index', i)} label="Voices" tint={ink.primary} ghost={prop('voice_count_index') === undefined} />
        </div>
      </div>
      <div class="stack">{@render knob('Poly Voice Depth', 'Depth')}{@render knob('Thickness', 'Thick')}</div>
      <div class="stack">{@render knob('Spread', 'Spread')}{@render knob('Glide Time', 'Glide')}</div>
      <div class="stack">{@render knob('Strength', 'Strength')}{@render sw('Legato On', 'Legato')}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={3}>
      {#snippet head()}<span class="sub" style="color: {ink.primary};">Play · Output</span>{/snippet}
      <div class="stack">{@render knob('Drift', 'Drift')}{@render knob('Vel > Vol', 'Vel > Vol')}</div>
      <div class="stack">{@render sw('Osc Retrig On', 'Retrig')}{@render sw('Note Pitch Bend On', 'Note PB')}</div>
      <div class="stack">{@render knob('Transpose', 'Transp')}{@render knob('Volume', 'Volume')}</div>
    </FaceSection>
  </FaceGrid>
{:else if page === 'global'}
  <FaceGrid sections={[2, 3, 2, 1]}>
    <FaceSection span={2}>
      {#snippet head()}{@render back()}{/snippet}
      <div class="face-span-all stack">
        <div class="voice-mode">{@render voiceModeTab()}</div>
        <div class="voices">
          <span class="sub" style="color: {ink.primary};">Voices</span>
          <ChoicePicker options={VOICES} selected={prop('voice_count_index')} onSelect={(i) => setProp('voice_count_index', i)} label="Voices" tint={ink.primary} ghost={prop('voice_count_index') === undefined} />
        </div>
      </div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={3}>
      {#snippet head()}<span class="sub" style="color: {ink.primary};">Voice</span>{/snippet}
      <div class="stack">{@render knob('Poly Voice Depth', 'Depth')}{@render knob('Thickness', 'Thick')}</div>
      <div class="stack">{@render knob('Spread', 'Spread')}{@render knob('Glide Time', 'Glide')}</div>
      <div class="stack">{@render knob('Strength', 'Strength')}{@render sw('Legato On', 'Legato')}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={2}>
      {#snippet head()}<span class="sub" style="color: {ink.primary};">Play</span>{/snippet}
      <div class="stack">{@render knob('Drift', 'Drift')}{@render knob('Vel > Vol', 'Vel > Vol')}</div>
      <div class="stack">{@render sw('Osc Retrig On', 'Retrig')}{@render sw('Note Pitch Bend On', 'Note PB')}</div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}<span class="sub" style="color: {ink.primary};">Output</span>{/snippet}
      <div class="stack">{@render knob('Transpose', 'Transp')}{@render knob('Volume', 'Volume')}</div>
    </FaceSection>
  </FaceGrid>
{/if}
</div>

<style>
  .drift-page {
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
  .cell,
  :global(.cell) {
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  .cells {
    display: flex;
    min-height: 0;
  }
  .cells > :global(*) {
    flex: 1 1 0;
  }
  .pad {
    min-height: 0;
  }
  /* A mod amount: the knob takes what the choosers leave. */
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
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  /* In a row of footed knobs every foot is two choosers tall, so the
     knobs above them line up whatever each foot holds. */
  .mod-cell.footed .mod-foot {
    flex: none;
    height: calc(2 * 2.25rem + 0.25rem);
  }
  .foot-label {
    align-items: center;
    justify-content: flex-start;
    font-size: 0.875rem;
    font-weight: 500;
  }
  .foot-value {
    font-size: 0.75rem;
    color: var(--signal-dim);
    font-variant-numeric: tabular-nums;
  }
  /* The LFO's shape grid over its rate mode and Retrig. */
  .lfo-shape {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    min-height: 0;
  }
  .lfo-waves {
    flex: 1 1 0;
    min-height: 0;
  }
  .lfo-mode,
  .lfo-shape > .sw-cell {
    flex: none;
    height: var(--height-touch);
  }
  .lfo-glyph {
    width: 100%;
    height: 100%;
    max-height: 22px;
  }
  .stack > .voice-mode {
    flex: 1 1 0;
  }
  /* On the board the voice mode stands in one column, a pick a row, over
     the voice count. */
  .stack > .voices-col {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }
  .stack > .voices {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }
  /* A switch is one touch-height button, centred in its cell, so it lines
     up with the knob beside it rather than filling the column. */
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
