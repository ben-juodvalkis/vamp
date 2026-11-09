<script lang="ts">
  /**
   * Drift's board tiles (ADR-512, ADR-513), each a `BoardTile` panel
   * (ADR-516) hand-laid on the face grid (ADR-510): a header bar naming
   * the section, then equal columns, identical seams, knobs at their
   * ADR-509 size. Every control binds a parameter by Live's name
   * (docs/reference/instruments/Drift.md) through `usePanelParams`; the
   * modulation sources, the matrix targets and the voice count are device
   * properties (`prop` / `setProp`).
   *
   * Tiles: `oscillators` (Osc 1, Osc 2, and the Mixer: a row a source, its
   * level, its switch and its route to the filter, where three columns of
   * lamps stood before ADR-516), `pitch-mod`, `filter`, `envelopes`, `lfo`,
   * `matrix` and `global`.
   */
  import type { Snippet } from 'svelte';
  import DeviceSlider from '../../../device-panel/DeviceSlider.svelte';
  import EnvelopeGraph from '../../EnvelopeGraph.svelte';
  import LfoGraph from '../../LfoGraph.svelte';
  import ScrubTabs from '../../../device-panel/ScrubTabs.svelte';
  import FaceGrid from '../../FaceGrid.svelte';
  import FaceSection from '../../FaceSection.svelte';
  import FaceSeam from '../../FaceSeam.svelte';
  import BoardTile from '../../BoardTile.svelte';
  import ChoicePicker from '../../ChoicePicker.svelte';
  import type { PanelParams } from '../panel/usePanelParams.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';

  interface Props {
    page: string;
    params: PanelParams;
    ink: DeviceColorScheme;
    /** The sources' own colours, as on the face: Osc 1, Osc 2, Noise. */
    sourceInks: { osc1: DeviceColorScheme; osc2: DeviceColorScheme; noise: DeviceColorScheme };
    filterPad: Snippet;
    waveGlyph: Snippet<[string]>;
    /** A Drift device property (the mod sources, voice count), or undefined. */
    prop: (name: string) => number | undefined;
    setProp: (name: string, value: number) => void;
  }

  let { page, params, ink, sourceInks, filterPad, waveGlyph, prop, setProp }: Props = $props();

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

  /** The mixer's rows: a source, its ink, its level, its switch and its route to the filter. */
  let mixer = $derived([
    { title: 'Osc 1', mark: '1', ink: o1, gain: 'Osc 1 Gain', on: 'Osc 1 On', flt: 'Osc 1 Flt On' },
    { title: 'Osc 2', mark: '2', ink: o2, gain: 'Osc 2 Gain', on: 'Osc 2 On', flt: 'Osc 2 Flt On' },
    { title: 'Noise', mark: 'N', ink: nz, gain: 'Noise Gain', on: 'Noise On', flt: 'Noise Flt On' }
  ]);
</script>

<!-- A knob bound by name: medium, its name under it or beside it. A
     parameter that is not quantized but steps (the Synced rates) rounds. -->
{#snippet knob(param: string, title: string, steps?: number, mark?: string, color: DeviceColorScheme = ink, size: 's' | 'm' | 'l' = 'm')}
  {@const l = lo(param)}
  {@const h = hi(param)}
  {@const bipolar = BIPOLAR.has(param) || (l < 0 && h > 0)}
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
     field naming its source, which is the knob's caption. A matrix slot
     adds a second field, its target. -->
{#snippet modKnob(param: string, mark: string, title: string, source: string, target?: string, color: DeviceColorScheme = ink, size: 's' | 'm' | 'l' = 'm')}
  <div class="mod-cell" class:two={!!target} data-param={param}>
    <div class="mod-knob">{@render knob(param, title, undefined, mark, color, size)}</div>
    <div class="mod-foot">
      <ChoicePicker options={SOURCES} selected={prop(source)} onSelect={(i) => setProp(source, i)} label="{title} source" caption="Source" tint={color.primary} ghost={prop(source) === undefined} />
      {#if target}
        <ChoicePicker options={TARGETS} selected={prop(target)} onSelect={(i) => setProp(target, i)} label="{title} target" caption="Target" tint={color.primary} ghost={prop(target) === undefined} />
      {/if}
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

<!-- An on/off parameter: one touch row, centred in its cell, lit while on.
     A `lamp` has no word (its column's name over it says what it is) and
     is a touch square, so a table of them is not a wall of slabs. -->
{#snippet sw(param: string, title: string, color: string = ink.primary, lamp = false)}
  {@const on = isOn(param)}
  <div class="cell sw-cell" class:lamp-cell={lamp}>
  <button
    class="physical-button btn-toggle switch"
    class:lamp
    class:active={on}
    aria-pressed={on}
    disabled={!params.has(param)}
    style="--btn-tint: {color};"
    data-param={param}
    aria-label={title}
    onclick={() => params.write(param, on ? lo(param) : hi(param))}
  >{lamp ? '' : title}</button>
  </div>
{/snippet}

<!-- A pick as a field naming the value, its own name over it, opening the
     values over the view. -->
{#snippet pick(param: string, labels: readonly string[], title: string, caption: string)}
  <div class="cell sw-cell" data-param={param}>
    <ChoicePicker options={labels} selected={params.has(param) ? step(param) : undefined} onSelect={(i) => params.write(param, lo(param) + i)} label={title} {caption} tint={ink.primary} ghost={!params.has(param)} />
  </div>
{/snippet}

{#snippet sub(text: string, color: string = ink.primary)}<span class="sub" style="color: {color};">{text}</span>{/snippet}

<!-- A section's header line: a name over each run of columns. -->
{#snippet heads(items: readonly (readonly [string, number])[], color: string = ink.primary)}
  <div class="col-heads" style="grid-template-columns: repeat({items.reduce((n, [, span]) => n + span, 0)}, minmax(0, 1fr));">
    {#each items as [text, span], i (i)}<span class="sub" style="color: {color}; grid-column: span {span};">{text}</span>{/each}
  </div>
{/snippet}

<div class="drift-page" data-drift-page={page}>
{#if page === 'oscillators'}
  <!-- The two oscillators, each its waves, its octaves and what shapes it,
       and the Mixer: a row a source in its colour, its level, its switch
       and its route to the filter. -->
  <BoardTile title="Oscillators" ink={ink.primary}>
    <FaceGrid sections={[3, 3, 3]}>
      <FaceSection span={3}>
        {#snippet head()}{@render sub('Osc 1', o1.primary)}{/snippet}
        {@render tab('Osc 1 Wave', OSC1_WAVES, { glyph: true, color: o1.primary })}
        {@render tab('Osc 1 Oct', ['-2', '-1', '0', '+1', '+2', '+3'], { up: true, color: o1.primary })}
        <div class="stack">{@render knob('Osc 1 Shape', 'Shape', undefined, undefined, o1, 'l')}{@render modKnob('Osc 1 Shape Mod Amt', 'M', 'Shape Mod', 'mod_matrix_shape_source_index', undefined, o1, 's')}</div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={3}>
        {#snippet head()}{@render sub('Osc 2', o2.primary)}{/snippet}
        {@render tab('Osc 2 Wave', OSC2_WAVES, { glyph: true, color: o2.primary })}
        {@render tab('Osc 2 Oct', ['-3', '-2', '-1', '0', '+1', '+2'], { up: true, color: o2.primary })}
        {@render knob('Osc 2 Detune', 'Detune', undefined, undefined, o2, 'l')}
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={3}>
        {#snippet head()}{@render heads([['Level', 1], ['On', 1], ['Filter', 1]])}{/snippet}
        <div class="face-span-all mixer" data-drift-mixer>
          {#each mixer as row (row.title)}
            {@render knob(row.gain, row.title, undefined, row.mark, row.ink)}
            {@render sw(row.on, `${row.title} on`, row.ink.primary, true)}
            {@render sw(row.flt, `${row.title} to filter`, row.ink.primary, true)}
          {/each}
        </div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'pitch-mod'}
  <!-- The two pitch modulations: an amount over the source it listens to. -->
  <BoardTile title="Pitch Mod" ink={ink.primary}>
    <FaceGrid sections={[2]} heads={false}>
      <FaceSection span={2}>
        {@render modKnob('Pitch Mod Amt 1', '1', 'Pitch Mod 1', 'mod_matrix_pitch_source_1_index', undefined, ink, 'l')}
        {@render modKnob('Pitch Mod Amt 2', '2', 'Pitch Mod 2', 'mod_matrix_pitch_source_2_index', undefined, ink, 'l')}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'filter'}
  <!-- Both filters on the pad, the low-pass's model and key tracking,
       and the two modulations of its cutoff. -->
  <BoardTile title="Filter" ink={ink.primary}>
    <FaceGrid sections={[4, 1, 2]}>
      <FaceSection span={4}>
        <div class="face-span-all pad">{@render filterPad()}</div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={1}>
        {#snippet head()}{@render sub('Low Pass')}{/snippet}
        <div class="stack">{@render tab('LP Type', ['I', 'II'])}{@render knob('Key > LPF', 'Key', undefined, undefined, ink, 's')}</div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={2}>
        {#snippet head()}{@render sub('Cutoff Mod')}{/snippet}
        {@render modKnob('LP Mod Amt 1', '1', 'Filter Mod 1', 'mod_matrix_filter_source_1_index', undefined, ink, 'm')}
        {@render modKnob('LP Mod Amt 2', '2', 'Filter Mod 2', 'mod_matrix_filter_source_2_index', undefined, ink, 'm')}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'envelopes'}
  <!-- Each envelope as Live draws it (ADR-514), its stages dragged on the
       picture and its small knobs under it. Env 2's switch to Cyc trades
       the picture for the cycling envelope's rate mode and knobs. -->
  <BoardTile title="Envelopes" ink={ink.primary}>
    <FaceGrid sections={[4, 5]}>
      <FaceSection span={4}>
        {#snippet head()}{@render sub('Env 1 · Amp')}{/snippet}
        <div class="face-span-all"><EnvelopeGraph {params} ink={ink.primary} names={{ attack: 'Env 1 Attack', decay: 'Env 1 Decay', sustain: 'Env 1 Sustain', release: 'Env 1 Release' }} /></div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={5}>
        {#snippet head()}{@render sub('Env 2')}{/snippet}
        {@render tab('Env 2 Cyc On', ['Env', 'Cyc'])}
        {#if env2Cyc}
          {@render tab('Cyc Env Mode', RATE_MODES)}
          {@render knob(cycRate, step('Cyc Env Mode') === 3 ? 'Sync' : 'Rate', step('Cyc Env Mode') === 3 ? 22 : undefined)}
          {@render knob('Cyc Env Tilt', 'Tilt')}
          {@render knob('Cyc Env Hold', 'Hold')}
        {:else}
          <div class="face-span-4"><EnvelopeGraph {params} ink={ink.primary} names={{ attack: 'Env 2 Attack', decay: 'Env 2 Decay', sustain: 'Env 2 Sustain', release: 'Env 2 Release' }} /></div>
        {/if}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'lfo'}
  <!-- The LFO: its wave across the tile, rate across and amount up; its
       nine shapes, its rate mode and Retrig; Rate over Amount; and how far
       something else moves it. -->
  <BoardTile title="LFO" ink={ink.primary}>
    <FaceGrid sections={[4]} heads={false}>
      <FaceSection span={4}>
        <div class="face-span-all graph-board" style="--graph-rows: minmax(0, 0.9fr) minmax(0, 1.6fr);">
          <div class="graph"><LfoGraph {params} ink={ink.primary} shape={LFO_WAVES[step('LFO Wave')]} rate={lfoRate} amount="LFO Amount" /></div>
          <div class="span-2 lfo-shape">
            <div class="lfo-waves">{@render tab('LFO Wave', LFO_WAVES, { cols: 3, lfo: true })}</div>
            <div class="lfo-mode">{@render pick('LFO Mode', RATE_MODES, 'LFO rate mode', 'Rate mode')}</div>
            {@render sw('LFO Retrig On', 'Retrig')}
          </div>
          <div class="stack">
            {@render knob(lfoRate, step('LFO Mode') === 3 ? 'Sync' : 'Rate', step('LFO Mode') === 3 ? 22 : undefined, undefined, ink, 'l')}
            {@render knob('LFO Amount', 'Amount', undefined, undefined, ink, 'l')}
          </div>
          {@render modKnob('LFO Mod Amt', 'M', 'LFO Mod', 'mod_matrix_lfo_source_index', undefined, ink, 's')}
        </div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'matrix'}
  <!-- Three free routes: an amount over its source and its target. -->
  <BoardTile title="Matrix" ink={ink.primary}>
    <FaceGrid sections={[3]} heads={false}>
      <FaceSection span={3}>
        {@render modKnob('Mod Matrix Amt 1', '1', 'Matrix 1', 'mod_matrix_source_1_index', 'mod_matrix_target_1_index', ink, 'm')}
        {@render modKnob('Mod Matrix Amt 2', '2', 'Matrix 2', 'mod_matrix_source_2_index', 'mod_matrix_target_2_index', ink, 'm')}
        {@render modKnob('Mod Matrix Amt 3', '3', 'Matrix 3', 'mod_matrix_source_3_index', 'mod_matrix_target_3_index', ink, 'm')}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'global'}
  <!-- The voice: its mode down one column over the voice count, then the
       voice knobs; then how it plays and the output. -->
  <BoardTile title="Global" ink={ink.primary}>
    <FaceGrid sections={[4, 3]}>
      <FaceSection span={4}>
        {#snippet head()}{@render sub('Voice')}{/snippet}
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
          <div class="cell sw-cell" data-voice-count>
            <ChoicePicker options={VOICES} selected={prop('voice_count_index')} onSelect={(i) => setProp('voice_count_index', i)} label="Voices" caption="Voices" tint={ink.primary} ghost={prop('voice_count_index') === undefined} />
          </div>
        </div>
        <div class="stack">{@render knob('Poly Voice Depth', 'Depth', undefined, undefined, ink, 's')}{@render knob('Thickness', 'Thick', undefined, undefined, ink, 's')}</div>
        <div class="stack">{@render knob('Spread', 'Spread', undefined, undefined, ink, 's')}{@render knob('Glide Time', 'Glide', undefined, undefined, ink, 'm')}</div>
        <div class="stack">{@render knob('Strength', 'Strength', undefined, undefined, ink, 's')}{@render sw('Legato On', 'Legato')}</div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={3}>
        {#snippet head()}{@render sub('Play · Output')}{/snippet}
        <div class="stack">{@render knob('Drift', 'Drift', undefined, undefined, ink, 's')}{@render knob('Vel > Vol', 'Vel > Vol', undefined, undefined, ink, 's')}</div>
        <div class="stack">{@render sw('Osc Retrig On', 'Retrig')}{@render sw('Note Pitch Bend On', 'Note PB')}</div>
        <div class="stack">{@render knob('Transpose', 'Transp', undefined, undefined, ink, 's')}{@render knob('Volume', 'Volume', undefined, undefined, ink, 'l')}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{/if}
</div>

<style>
  .drift-page {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
  }
  .drift-page > :global(*) {
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
  .cell,
  :global(.cell) {
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  .pad {
    min-height: 0;
  }
  /* The mixer: a row a source, its level, its switch and its route. */
  .mixer {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: repeat(3, minmax(0, 1fr));
    row-gap: var(--spacing-sm);
    min-height: 0;
  }
  .mixer > :global(*) {
    min-width: 0;
    min-height: 0;
  }
  /* A mod amount: the knob takes what the fields leave. */
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
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    height: var(--picker-h, 2.25rem);
  }
  .mod-cell.two > .mod-foot {
    height: calc(2 * var(--picker-h, 2.25rem) + 0.25rem);
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
  /* A switch or a field in a stack is one touch row. */
  .stack > :global(.sw-cell) {
    flex: none;
    height: var(--height-touch);
  }
  /* A switch is one touch-height button, centred in its cell, so it lines
     up with the knob beside it rather than filling the column. */
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
  .lamp-cell {
    justify-content: center;
  }
  .switch.lamp {
    width: var(--height-touch);
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
