<script lang="ts">
  import { press } from '$lib/actions/press';
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
   * lamps stood before ADR-516), `pitch-mod` (titled Osc Mod: the two
   * pitch modulations and the shape's), `filter`, `envelopes`, `lfo`,
   * `matrix` and `global`.
   *
   * Since ADR-544 (2026-11-17) every amount is the track's one ink (the
   * three sources had their own), and the knobs of a tile are one size on
   * shared lines: a higher rank no longer takes a larger share of a column.
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
    /** The one ink every amount is drawn in: the selected track's (ADR-544). */
    ink: DeviceColorScheme;
    filterPad: Snippet;
    waveGlyph: Snippet<[string]>;
    /** A Drift device property (the mod sources, voice count), or undefined. */
    prop: (name: string) => number | undefined;
    setProp: (name: string, value: number) => void;
  }

  let { page, params, ink, filterPad, waveGlyph, prop, setProp }: Props = $props();

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
  /** A pick's value is a name in plain ink, never the amount's colour (ADR-544). */
  const PICK_INK = 'var(--label)';

  /** The mixer's rows: a source (its mark says which), its level, its switch and its route to the filter. */
  const mixer = [
    { title: 'Osc 1', mark: '1', gain: 'Osc 1 Gain', on: 'Osc 1 On', flt: 'Osc 1 Flt On' },
    { title: 'Osc 2', mark: '2', gain: 'Osc 2 Gain', on: 'Osc 2 On', flt: 'Osc 2 Flt On' },
    { title: 'Noise', mark: 'N', gain: 'Noise Gain', on: 'Noise On', flt: 'Noise Flt On' }
  ];
</script>

<!-- A knob bound by name: medium, its name under it or beside it. A
     parameter that is not quantized but steps (the Synced rates) rounds. -->
{#snippet knob(param: string, title: string, steps?: number, mark?: string, size: 's' | 'm' | 'l' = 'm')}
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
      color={ink}
      readout={params.display(param)}
      onInteraction={(v) => params.write(param, steps ? Math.round(v) : v)}
    />
  </div>
{/snippet}

<!-- A modulation amount: the knob, and under it the field naming its
     source. A numbered slot carries its number inside the knob (the mark is
     its name); any other its name under the knob, so it stands level with
     the plain knobs beside it. A matrix slot adds a second field, its
     target. -->
{#snippet modKnob(param: string, title: string, source: string, opts: { mark?: string; caption?: string; target?: string; size?: 's' | 'm' | 'l' } = {})}
  <div class="mod-cell" class:two={!!opts.target} data-param={param}>
    <div class="mod-knob">{@render knob(param, opts.caption ?? title, undefined, opts.mark, opts.size ?? 'm')}</div>
    <div class="mod-foot">
      <ChoicePicker options={SOURCES} selected={prop(source)} onSelect={(i) => setProp(source, i)} label="{title} source" caption="Source" tint={PICK_INK} ghost={prop(source) === undefined} />
      {#if opts.target}
        <ChoicePicker options={TARGETS} selected={prop(opts.target)} onSelect={(i) => setProp(opts.target!, i)} label="{title} target" caption="Target" tint={PICK_INK} ghost={prop(opts.target) === undefined} />
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
{#snippet tab(param: string, labels: readonly string[], opts: { cols?: number; up?: boolean; glyph?: boolean; lfo?: boolean } = {})}
  {@const order = opts.up ? labels.map((_, i) => labels.length - 1 - i) : labels.map((_, i) => i)}
  <div class="cell panel-choice" data-param={param}>
  <ScrubTabs
    options={order}
    selected={order.indexOf(step(param))}
    onSelect={(_, i) => params.write(param, lo(param) + i)}
    cols={opts.cols ?? 1}
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
{#snippet sw(param: string, title: string, lamp = false)}
  {@const on = isOn(param)}
  <div class="cell sw-cell" class:lamp-cell={lamp}>
  <button
    class="physical-button btn-toggle switch"
    class:lamp
    class:active={on}
    aria-pressed={on}
    disabled={!params.has(param)}
    data-param={param}
    aria-label={title}
    use:press={{ onPress: () => params.write(param, on ? lo(param) : hi(param)), disabled: !params.has(param) }}
  >{lamp ? '' : title}</button>
  </div>
{/snippet}

<!-- A pick as a field naming the value, its own name over it, opening the
     values over the view. -->
{#snippet pick(param: string, labels: readonly string[], title: string, caption: string)}
  <div class="cell sw-cell" data-param={param}>
    <ChoicePicker options={labels} selected={params.has(param) ? step(param) : undefined} onSelect={(i) => params.write(param, lo(param) + i)} label={title} {caption} tint={PICK_INK} ghost={!params.has(param)} />
  </div>
{/snippet}

{#snippet sub(text: string)}<span class="sub">{text}</span>{/snippet}

<!-- A section's header line: a name over each run of columns. -->
{#snippet heads(items: readonly (readonly [string, number])[])}
  <div class="col-heads" style="grid-template-columns: repeat({items.reduce((n, [, span]) => n + span, 0)}, minmax(0, 1fr));">
    {#each items as [text, span], i (i)}<span class="sub" style="grid-column: span {span};">{text}</span>{/each}
  </div>
{/snippet}

<div class="drift-page" data-drift-page={page}>
{#if page === 'oscillators'}
  <!-- The two oscillators, each its waves, its octaves and its one knob
       (Shape, Detune: one size), and the Mixer: a row a source, its level
       marked with which it is, its switch and its route to the filter. -->
  <BoardTile title="Oscillators" ink={ink.primary}>
    <FaceGrid sections={[3, 3, 3]}>
      <FaceSection span={3}>
        {#snippet head()}{@render sub('Osc 1')}{/snippet}
        {@render tab('Osc 1 Wave', OSC1_WAVES, { glyph: true })}
        {@render tab('Osc 1 Oct', ['-2', '-1', '0', '+1', '+2', '+3'], { up: true })}
        {@render knob('Osc 1 Shape', 'Shape', undefined, undefined, 'l')}
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={3}>
        {#snippet head()}{@render sub('Osc 2')}{/snippet}
        {@render tab('Osc 2 Wave', OSC2_WAVES, { glyph: true })}
        {@render tab('Osc 2 Oct', ['-3', '-2', '-1', '0', '+1', '+2'], { up: true })}
        {@render knob('Osc 2 Detune', 'Detune', undefined, undefined, 'l')}
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={3}>
        {#snippet head()}{@render heads([['Level', 1], ['On', 1], ['Filter', 1]])}{/snippet}
        <div class="face-span-all mixer" data-drift-mixer>
          {#each mixer as row (row.title)}
            {@render knob(row.gain, row.title, undefined, row.mark, 's')}
            {@render sw(row.on, `${row.title} on`, true)}
            {@render sw(row.flt, `${row.title} to filter`, true)}
          {/each}
        </div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'pitch-mod'}
  <!-- What moves the oscillators: the two pitch modulations and Osc 1's
       shape modulation, each an amount over the source it listens to, one
       size. (The shape's stood under Shape, a quarter its size, until
       2026-11-17.) -->
  <BoardTile title="Osc Mod" ink={ink.primary}>
    <FaceGrid sections={[3]} heads={false}>
      <FaceSection span={3}>
        {@render modKnob('Pitch Mod Amt 1', 'Pitch Mod 1', 'mod_matrix_pitch_source_1_index', { caption: 'Pitch 1', size: 'l' })}
        {@render modKnob('Pitch Mod Amt 2', 'Pitch Mod 2', 'mod_matrix_pitch_source_2_index', { caption: 'Pitch 2', size: 'l' })}
        {@render modKnob('Osc 1 Shape Mod Amt', 'Shape Mod', 'mod_matrix_shape_source_index', { caption: 'Shape', size: 'l' })}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'filter'}
  <!-- Both filters on the pad; the low-pass's model over its key tracking;
       the two modulations of its cutoff, each source's field over its
       amount, so the three knobs stand on one line at one size. -->
  <BoardTile title="Filter" ink={ink.primary}>
    <FaceGrid sections={[4, 1, 2]}>
      <FaceSection span={4}>
        <div class="face-span-all pad">{@render filterPad()}</div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={1}>
        {#snippet head()}{@render sub('Low Pass')}{/snippet}
        <div class="over-knob">
          <div class="over two">{@render tab('LP Type', ['I', 'II'])}</div>
          {@render knob('Key > LPF', 'Key', undefined, undefined, 's')}
        </div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={2}>
        {#snippet head()}{@render sub('Cutoff Mod')}{/snippet}
        {#each [1, 2] as n (n)}
          {@const source = `mod_matrix_filter_source_${n}_index`}
          <div class="over-knob" data-param="LP Mod Amt {n}">
            <div class="over two foot">
              <ChoicePicker options={SOURCES} selected={prop(source)} onSelect={(i) => setProp(source, i)} label="Filter Mod {n} source" caption="Source" tint={PICK_INK} ghost={prop(source) === undefined} />
            </div>
            {@render knob(`LP Mod Amt ${n}`, `Mod ${n}`, undefined, undefined, 's')}
          </div>
        {/each}
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
  <!-- The LFO (ADR-514): its nine shapes on the bar, as Wavetable's LFOs
       carry theirs, so the wave has the body (rate across, amount up);
       under it three knobs of one size, each over the touch row that
       belongs with it: Rate over its mode, Amount over Retrig, the
       modulation of the rate over its source. (Until 2026-11-17 the shapes
       were a three by three grid of 12px rows and the knobs three sizes.) -->
  <BoardTile title="LFO" ink={ink.primary}>
    {#snippet tools()}
      <div class="bar-waves">{@render tab('LFO Wave', LFO_WAVES, { cols: 9, lfo: true })}</div>
    {/snippet}
    <FaceGrid sections={[3]} heads={false}>
      <FaceSection span={3}>
        <div class="face-span-all picture-over" style="--over-cols: 3;">
          <div class="picture"><LfoGraph {params} ink={ink.primary} shape={LFO_WAVES[step('LFO Wave')]} rate={lfoRate} amount="LFO Amount" /></div>
          <div class="knob-over">
            {@render knob(lfoRate, step('LFO Mode') === 3 ? 'Sync' : 'Rate', step('LFO Mode') === 3 ? 22 : undefined)}
            <div class="foot">{@render pick('LFO Mode', RATE_MODES, 'LFO rate mode', 'Rate mode')}</div>
          </div>
          <div class="knob-over">
            {@render knob('LFO Amount', 'Amount')}
            <div class="foot">{@render sw('LFO Retrig On', 'Retrig')}</div>
          </div>
          {@render modKnob('LFO Mod Amt', 'LFO Mod', 'mod_matrix_lfo_source_index', { caption: 'Rate Mod' })}
        </div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'matrix'}
  <!-- Three free routes: an amount, numbered, over its source and its target. -->
  <BoardTile title="Matrix" ink={ink.primary}>
    <FaceGrid sections={[3]} heads={false}>
      <FaceSection span={3}>
        {@render modKnob('Mod Matrix Amt 1', 'Matrix 1', 'mod_matrix_source_1_index', { mark: '1', target: 'mod_matrix_target_1_index' })}
        {@render modKnob('Mod Matrix Amt 2', 'Matrix 2', 'mod_matrix_source_2_index', { mark: '2', target: 'mod_matrix_target_2_index' })}
        {@render modKnob('Mod Matrix Amt 3', 'Matrix 3', 'mod_matrix_source_3_index', { mark: '3', target: 'mod_matrix_target_3_index' })}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'global'}
  <!-- The voice: its mode down one column over the voice count, then the
       voice knobs; then how it plays and the output. Every knob is one
       size, two to a column on the same two lines, and a switch stands on
       a line with them. -->
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
              label={(o) => o.label}
              class="h-full"
              style="--scrub-font-size: 0.75rem; --scrub-font-weight: 500; --scrub-padding: 0 0.25rem;"
            />
          </div>
          <div class="cell sw-cell" data-voice-count>
            <ChoicePicker options={VOICES} selected={prop('voice_count_index')} onSelect={(i) => setProp('voice_count_index', i)} label="Voices" caption="Voices" tint={PICK_INK} ghost={prop('voice_count_index') === undefined} />
          </div>
        </div>
        <div class="pair">{@render knob('Poly Voice Depth', 'Depth')}{@render knob('Thickness', 'Thick')}</div>
        <div class="pair">{@render knob('Spread', 'Spread')}{@render knob('Glide Time', 'Glide')}</div>
        <div class="pair">{@render knob('Strength', 'Strength')}{@render sw('Legato On', 'Legato')}</div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={3}>
        {#snippet head()}{@render sub('Play · Output')}{/snippet}
        <div class="pair">{@render knob('Drift', 'Drift')}{@render knob('Vel > Vol', 'Vel > Vol')}</div>
        <div class="pair">{@render sw('Osc Retrig On', 'Retrig')}{@render sw('Note Pitch Bend On', 'Note PB')}</div>
        <div class="pair">{@render knob('Transpose', 'Transp')}{@render knob('Volume', 'Volume')}</div>
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
  /* Two controls to a column on the tile's two lines: equal halves, so the
     knobs of every column are one size and a switch stands level with the
     knob beside it (ADR-544; a higher rank took the larger share before). */
  .pair {
    display: grid;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    row-gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
  }
  /* A knob under the touch rows that belong with it (a pick of two, a
     source's field): `two` rows of them, the field at their foot, so the
     knobs of a section stand on one line. */
  .over-knob {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    row-gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
  }
  .over-knob > .over.two {
    height: calc(2 * var(--height-touch));
    min-height: 0;
  }
  .over-knob > .over.foot {
    display: flex;
    align-items: flex-end;
  }
  .over-knob > .over.foot > :global(*) {
    width: 100%;
  }
  /* A knob over the one touch row that belongs with it. */
  .knob-over {
    display: grid;
    grid-template-rows: minmax(0, 1fr) var(--height-touch);
    row-gap: 0.25rem;
    min-height: 0;
    min-width: 0;
  }
  .knob-over > .foot {
    min-width: 0;
  }
  /* A picture across the tile over one row of such columns: the row is as
     tall as a medium knob, its name and its touch row. */
  .picture-over {
    display: grid;
    grid-template-columns: repeat(var(--over-cols), minmax(0, 1fr));
    grid-template-rows: minmax(0, 1fr) 9.375rem;
    gap: var(--spacing-sm) var(--face-gutter);
    min-height: 0;
    min-width: 0;
  }
  .picture-over > .picture {
    grid-column: 1 / -1;
    min-height: 0;
    min-width: 0;
  }
  /* The LFO's nine shapes on its bar, at the bar's height. */
  .bar-waves {
    height: var(--picker-h);
    min-width: 0;
  }
  :global(.panel-tools) > .bar-waves {
    max-width: 20rem;
  }
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
    color: var(--value);
  }
</style>
