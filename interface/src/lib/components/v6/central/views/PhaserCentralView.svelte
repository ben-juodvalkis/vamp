<script lang="ts">
  /**
   * The Phaser-Flanger's view (the `phaser` slot), its unfolded panel left
   * to right (2026-11-06, was the pad alone; Live 12 manual §29.29):
   *
   *   [Mode · FB Invert]
   *   | [Phaser: Notches  Center / Spread  Blend; Flanger or Doubler: Time]
   *   | [LFO Waveform, 2 x 5] [the wave drawn, over Amount  Duty Cyc]
   *   | [Env Fol over Env] | [Warmth / Output] [Dry/Wet]
   *
   * on one face grid (ADR-510), sections 1 · 2 · 3 · 1 · 2, every knob
   * medium.
   *
   * Re-laid for Ink (ADR-544, 2026-11-17). The output column was three
   * short boxes whose names their fills cut: Warmth and Output, set and
   * left, are knobs, and Dry/Wet, the one a set rides, a box the band's
   * height. The LFO's ten shapes are a tab of drawn waves, a touch row
   * each, as the Shifter's are (a pick that opened a list before); the
   * wave is drawn beside it over the two knobs that shape it. Env Fol sits
   * over the Env it switches, in a section of its own.
   *
   * LFO 1's Freq and Feedback are the chain cell's pad (the `phaser`
   * control, deviceControls, ADR-479), drawn above this view, so the view
   * no longer draws that pad too (user, 2026-11-06). Indices,
   * ranges and labels measured on the rig (device_dump, 2026-11-06): 1 LFO
   * Amount, 2 LFO Wave 0..9, 12 LFO Morph (Live's Duty Cycle, -100..100 %),
   * 14 Env Enabled, 15 Env Amount (-1..1 on 0..1), 18 Mode 0..2, 19 Notches
   * 1..42, 20 Flanger Time, 21 Doubler Time, 22 Mod Blend, 23 Center Freq, 24 Spread,
   * 26 Warmth, 28 FB Invert, 29 Output, 30 Dry/Wet, the rest 0..1. A ghost
   * draws Live's values on a fresh insert. Not drawn: LFO 2, the LFO's sync
   * and Phase / Spin, the envelope's Attack and Release, and Safe Bass.
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */
  import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import { press } from '$lib/actions/press';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import LfoGraph from '../LfoGraph.svelte';
  import { pictureParams } from './panel/usePanelParams.svelte';

  const fx = useFxGridSlot('phaser');

  const PHASER = {
    lfoAmount: 1,
    wave: 2,
    dutyCycle: 12,
    envOn: 14,
    envAmount: 15,
    mode: 18,
    notches: 19,
    flangerTime: 20,
    doublerTime: 21,
    center: 23,
    spread: 24,
    blend: 22,
    warmth: 26,
    fbInvert: 28,
    output: 29,
    dryWet: 30
  } as const;
  const MODES = ['Phaser', 'Flanger', 'Doubler'] as const;
  const WAVES = ['Sine', 'Triangle', 'Tri Analog', 'Triangle 8', 'Triangle 16', 'Saw Up', 'Saw Down', 'Rectangle', 'Random', 'Random S&H'] as const;

  /** A triangle quantized to `n` steps a cycle, in the glyphs' 24 x 12 box. */
  function steppedTriangle(n: number): string {
    let d = '';
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const tri = u < 0.25 ? 4 * u : u < 0.75 ? 2 - 4 * u : 4 * u - 4;
      const y = 6 - tri * 4;
      d += `${i ? 'L' : 'M'}${(u * 24).toFixed(1)} ${y.toFixed(1)}L${(((i + 1) / n) * 24).toFixed(1)} ${y.toFixed(1)}`;
    }
    return d;
  }
  /** The ten waves as pictures, the Shifter's glyphs (the same list in the same order): one cycle each. */
  const WAVE_GLYPHS = [
    'M0 6 Q6 -1 12 6 T24 6',
    'M0 6 L6 2 L18 10 L24 6',
    'M0 6 C3 2 5 1.6 7 2.6 L17 9.4 C19 10.4 21 10 24 6',
    steppedTriangle(8),
    steppedTriangle(16),
    'M0 10 L20 2 L20 10',
    'M4 10 L4 2 L24 10',
    'M0 10 L0 2 L12 2 L12 10 L24 10',
    'M0 7 C3 2 6 3 8 6 S13 11 16 8 S21 3 24 5',
    'M0 7 L5 7 L5 3 L10 3 L10 9 L15 9 L15 5 L20 5 L20 8 L24 8'
  ];

  let mode = $derived(Math.round(fx.paramValue(PHASER.mode) ?? 0));
  /** The LFO as a picture (ADR-514): its rate is the chain cell's pad. */
  const lfo = pictureParams(() => ({ Amount: fx.paramValue(PHASER.lfoAmount) ?? 0.9762 }));
  let wave = $derived(Math.round(fx.paramValue(PHASER.wave) ?? 1));
  let fbInvert = $derived((fx.paramValue(PHASER.fbInvert) ?? 0) >= 0.5);

  let voicing = $derived(
    mode === 0
      ? [
          { index: PHASER.notches, title: 'Notches', rest: 2, min: 1, max: 42 },
          { index: PHASER.center, title: 'Center', rest: 0.3125 },
          { index: PHASER.spread, title: 'Spread', rest: 0.3516 },
          { index: PHASER.blend, title: 'Blend', rest: 0 }
        ]
      : mode === 1
        ? [{ index: PHASER.flangerTime, title: 'Time', rest: 0.6075 }]
        : [{ index: PHASER.doublerTime, title: 'Time', rest: 0.688 }]
  );
  type Knob = { index: number; title: string; rest: number; min?: number; max?: number; center?: number };
  const AMOUNT: Knob = { index: PHASER.lfoAmount, title: 'Amount', rest: 0.9762 };
  const DUTY: Knob = { index: PHASER.dutyCycle, title: 'Duty Cyc', rest: 0.55, center: 0.5 };
  const ENV: Knob = { index: PHASER.envAmount, title: 'Env', rest: 0.5, center: 0.5 };
  let envOn = $derived((fx.paramValue(PHASER.envOn) ?? 1) >= 0.5);
  const WARMTH: Knob = { index: PHASER.warmth, title: 'Warmth', rest: 0 };
  const OUTPUT: Knob = { index: PHASER.output, title: 'Output', rest: 0.7071 };
  const DRY_WET_REST = 1;
</script>

<!-- A knob on one parameter in its own range (ADR-509); a ghost draws `rest`. -->
{#snippet knob(box: Knob, size: 'm' | 'l' = 'm')}
  <div class="knob-cell" class:slot-ghost={fx.isGhost}>
    <DeviceSlider
      value={fx.paramValue(box.index) ?? box.rest}
      title={box.title}
      face="knob"
      knobSize={size}
      knobFit
      knobCaptionBelow
      orientation="vertical"
      min={box.min ?? 0}
      max={box.max ?? 1}
      centerOrigin={box.center !== undefined}
      centerValue={box.center}
      isGhost={fx.isGhost}
      color={fx.color}
      readout={fx.paramDisplay(box.index)}
      onInteraction={(v) => fx.sendParam(box.index, v)}
    />
  </div>
{/snippet}

{#snippet toggleRow(label: string, lit: boolean, onToggle: () => void)}
  <button
    class="physical-button btn-toggle fx-switch"
    class:active={lit}
    class:slot-ghost={fx.isGhost}
    aria-pressed={lit}
    use:press={{ onPress: onToggle }}
  >{label}</button>
{/snippet}

<!-- One face grid (ADR-510), nine columns of ~96px at 1366 x 1024:
     Mode 1 · Voice 2 · LFO 3 · Env 1 · Output 2. -->
<div class="face-root" data-view="phaser">
<FaceGrid sections={[1, 2, 3, 1, 2]}>
  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Mode" color={fx.color.primary} />{/snippet}
    <div class="cell">
      <ScrubTabs
        options={MODES}
        selected={mode}
        onSelect={(i) => fx.sendParam(PHASER.mode, i)}
        cols={1}
        ghost={fx.isGhost}
        label={(m) => m}
        groupLabel="Mode"
        name="mode"
        class="flex-1"
        style="--scrub-font-size: 0.9375rem;"
      />
      {@render toggleRow('FB Invert', fbInvert, () => fx.sendParam(PHASER.fbInvert, fbInvert ? 0 : 1))}
    </div>
  </FaceSection>
  <FaceSeam />

  <!-- Phaser: four knobs, two to a row. Flanger and Doubler have one,
       Time: alone in the section, it stands in its middle, large. -->
  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Voice" color={fx.color.primary} />{/snippet}
    {#if voicing.length > 1}
      <div class="face-span-2 knob-board">
        {#each voicing as box (box.index)}{@render knob(box)}{/each}
      </div>
    {:else}
      <div class="face-span-2 cell">
        {#each voicing as box (box.index)}{@render knob(box, 'l')}{/each}
      </div>
    {/if}
  </FaceSection>
  <FaceSeam />

  <!-- The LFO: its ten shapes, a tab of drawn waves the column's height,
       then the wave as it runs (ADR-514) over the two knobs that shape it. -->
  <FaceSection span={3}>
    {#snippet head()}<PanelEyebrow title="LFO" color={fx.color.primary} />{/snippet}
    <ScrubTabs
      options={WAVES}
      selected={wave}
      onSelect={(i) => fx.sendParam(PHASER.wave, i)}
      cols={2}
      ghost={fx.isGhost}
      label={(w) => `LFO wave ${w}`}
      groupLabel="LFO wave"
      name="phaser-lfo-wave"
      style="--scrub-padding: 6px;"
    >
      {#snippet item(_, i)}
        <svg class="wave-glyph" viewBox="0 0 24 12" aria-hidden="true" focusable="false">
          <path d={WAVE_GLYPHS[i]} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
        </svg>
      {/snippet}
    </ScrubTabs>
    <div class="face-span-2 knob-board">
      <div class="wave-pic">
        <LfoGraph params={lfo} shape={WAVES[wave]} amount="Amount" ink={fx.color.primary} interactive={false} />
      </div>
      {@render knob(AMOUNT)}
      {@render knob(DUTY)}
    </div>
  </FaceSection>
  <FaceSeam />

  <!-- The envelope follower: its switch over its amount. -->
  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Env" color={fx.color.primary} />{/snippet}
    <div class="cell">
      {@render toggleRow('Env Fol', envOn, () => fx.sendParam(PHASER.envOn, envOn ? 0 : 1))}
      {@render knob(ENV)}
    </div>
  </FaceSection>
  <FaceSeam />

  <!-- Warmth over Output, set and left: knobs. Dry/Wet, the level a set
       rides: a box the band's height (ADR-509, ADR-544). -->
  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Output" color={fx.color.primary} />{/snippet}
    <div class="cell">
      {@render knob(WARMTH)}
      {@render knob(OUTPUT)}
    </div>
    <div class="cell" class:slot-ghost={fx.isGhost}>
      <DeviceSlider
        value={fx.paramValue(PHASER.dryWet) ?? DRY_WET_REST}
        title="Dry/Wet"
        orientation="vertical"
        isGhost={fx.isGhost}
        color={fx.color}
        readout={fx.paramDisplay(PHASER.dryWet)}
        onInteraction={(v) => fx.sendParam(PHASER.dryWet, v)}
      />
    </div>
  </FaceSection>
</FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510); a cell is how one column fills its height. */
  .face-root {
    height: 100%;
    width: 100%;
    min-height: 0;
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: var(--face-gutter);
    min-height: 0;
    min-width: 0;
  }
  .cell > :global(.device-slider) {
    flex: 1 1 0;
    min-height: 0;
  }

  .knob-cell {
    flex: 1 1 0;
    display: flex;
    min-height: 0;
    min-width: 0;
  }
  .knob-cell > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }

  /* Two rows on the face's own two columns: four knobs, or the wave over
     two, so every knob in the lower row stands on one line. */
  .knob-board {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--face-gutter);
    min-height: 0;
    min-width: 0;
  }
  .wave-pic {
    grid-column: 1 / -1;
    min-height: 0;
    min-width: 0;
  }

  .wave-glyph {
    width: 100%;
    height: 100%;
    max-height: 22px;
  }

  /* A switch: one touch row, its column's width. */
  .fx-switch {
    flex: 0 0 var(--height-touch);
    min-height: 0;
    width: 100%;
    padding-inline: 2px;
    font-size: 0.875rem;
    font-weight: var(--font-weight-medium);
  }
</style>
