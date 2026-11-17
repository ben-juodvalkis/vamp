<script lang="ts">
  /**
   * Live 12's Auto Pan-Tremolo (the `autoPanTremolo` slot, 2026-11-06), laid
   * out as Live's panel reads (Live 12 manual §29.3), left to right:
   *
   *   [Panning | Tremolo over the Time mode, 2 x 3]
   *   | [the wave drawn, over Panning's Waveform, 3 x 3; Tremolo: over
   *   Harmonic  Vintage]
   *   | [Panning: Phase | Spin over Phase or Spin  Offset; Tremolo: Offset]
   *   | [Invert over Shape  Att  Mod]
   *
   * on one face grid (ADR-510), sections 2 · 3 · 2 · 3.
   *
   * Re-laid for Ink (ADR-544, 2026-11-17) on two lines, as the Delay's
   * face: a touch row along the top (the mode, the stereo mode, Invert),
   * and under it what each one governs. Mode and the Time mode were one
   * column of eight 25px rows; they are a row of two over a grid of six,
   * each a touch row. The five knobs are one size on one line (two sat
   * beside their names in a column of three, three under theirs). Invert,
   * which turns the wave over, heads the knobs that shape it (it sat under
   * the stereo mode).
   *
   * Live's Amount and rate knobs are the chain cell's pad
   * (`autoPanTremolo` in deviceControls, ADR-479: X the rate the Time mode
   * picks, Y the depth from the middle, Invert below it), drawn above this
   * view, so the view no longer draws that pad too (user, 2026-11-06). As in Live, the waveform and the stereo
   * controls are Panning's, and Tremolo shows Harmonic and Vintage in their
   * place; Shape is Panning's or Tremolo's own (two parameters), whichever
   * mode is on. Live allows Spin on all but Random, Wander and S&H. Indices
   * and labels are `autoPan2Params.ts`, measured on the rig.
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
  import { AUTO_PAN2, LFO_MODES, MODES, WAVES, rateOf, rateParam } from '$lib/components/v6/device-panel/autoPan2Params';
  import LfoGraph from '../LfoGraph.svelte';
  import { pictureParams } from './panel/usePanelParams.svelte';

  const fx = useFxGridSlot('autoPanTremolo');

  /** A fresh insert on the rig: Tremolo, 16th, Sine (its User Library default). */
  const REST: Record<number, number> = {
    [AUTO_PAN2.mode]: 1,
    [AUTO_PAN2.lfoMode]: 5,
    [AUTO_PAN2.wave]: 0,
    [AUTO_PAN2.invert]: 0,
    [AUTO_PAN2.stereoMode]: 0,
    [AUTO_PAN2.harmonic]: 0,
    [AUTO_PAN2.vintage]: 0
  };
  const STEREO_MODES = ['Phase', 'Spin'] as const;
  /** Random, Wander and S&H take Phase only (the manual). */
  const PHASE_ONLY_WAVES = new Set([6, 7, 8]);

  const value = (index: number) => fx.paramValue(index) ?? REST[index] ?? 0;
  const step = (index: number) => Math.round(value(index));
  const toggle = (index: number) => fx.sendParam(index, value(index) >= 0.5 ? 0 : 1);

  let tremolo = $derived(step(AUTO_PAN2.mode) === 1);
  let spin = $derived(step(AUTO_PAN2.stereoMode) === 1 && !PHASE_ONLY_WAVES.has(step(AUTO_PAN2.wave)));
  let stereo = $derived([
    spin ? { index: AUTO_PAN2.spin, title: 'Spin', rest: 0 } : { index: AUTO_PAN2.phase, title: 'Phase', rest: 0.5 },
    { index: AUTO_PAN2.offset, title: 'Offset', rest: 0 }
  ]);
  /** The LFO as a picture (ADR-514): its rate and amount are the chain cell's pad. */
  const lfo = pictureParams(() => ({
    Rate: rateOf(step(AUTO_PAN2.lfoMode), value(rateParam(step(AUTO_PAN2.lfoMode)))),
    Amount: value(AUTO_PAN2.amount)
  }));
  let shaping = $derived([
    tremolo
      ? { index: AUTO_PAN2.tremoloMorph, title: 'Shape', rest: 0.5, center: 0.5 }
      : { index: AUTO_PAN2.lfoMorph, title: 'Shape', rest: 0 },
    { index: AUTO_PAN2.attack, title: 'Att', rest: 0 },
    { index: AUTO_PAN2.dynMod, title: 'Mod', rest: 0.5, center: 0.5 }
  ]);
</script>

<!-- A medium knob on one parameter (ADR-509); a ghost draws `rest`. -->
{#snippet knob(box: { index: number; title: string; rest: number; center?: number }, place = '')}
  <div class="knob-cell {place}" class:slot-ghost={fx.isGhost}>
    <DeviceSlider
      value={fx.paramValue(box.index) ?? box.rest}
      title={box.title}
      face="knob"
      knobSize="m"
      knobFit
      knobCaptionBelow
      orientation="vertical"
      centerOrigin={box.center !== undefined}
      centerValue={box.center}
      isGhost={fx.isGhost}
      color={fx.color}
      readout={fx.paramDisplay(box.index)}
      onInteraction={(v) => fx.sendParam(box.index, v)}
    />
  </div>
{/snippet}

{#snippet toggleRow(label: string, index: number, place = '')}
  <button
    class="physical-button btn-toggle fx-switch {place}"
    class:active={value(index) >= 0.5}
    class:slot-ghost={fx.isGhost}
    aria-pressed={value(index) >= 0.5}
    use:press={{ onPress: () => toggle(index) }}
  >{label}</button>
{/snippet}

<!-- One face grid (ADR-510), ten columns of ~88px at 1366 x 1024:
     Mode 2 · Wave 3 · Stereo 2 · Shape 3. Two lines: a touch row, then
     what it governs. The wave is drawn over its list (ADR-514). -->
<div class="face-root" data-view="autoPanTremolo">
<FaceGrid sections={[2, 3, 2, 3]}>
  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Mode" color={fx.color.primary} />{/snippet}
    <div class="cell face-span-all">
      <ScrubTabs
        options={MODES}
        selected={step(AUTO_PAN2.mode)}
        onSelect={(i) => fx.sendParam(AUTO_PAN2.mode, i)}
        cols={2}
        ghost={fx.isGhost}
        label={(m) => m}
        groupLabel="Mode"
        name="mode"
        class="touch-row"
        style="--scrub-font-size: 0.875rem;"
      />
      <ScrubTabs
        options={LFO_MODES}
        selected={step(AUTO_PAN2.lfoMode)}
        onSelect={(i) => fx.sendParam(AUTO_PAN2.lfoMode, i)}
        cols={2}
        ghost={fx.isGhost}
        label={(m) => m}
        groupLabel="Time mode"
        name="lfo-mode"
        class="flex-1"
        style="--scrub-font-size: 0.875rem;"
      />
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={3}>
    {#snippet head()}<PanelEyebrow title={tremolo ? 'Tremolo' : 'Wave'} color={fx.color.primary} />{/snippet}
    <div class="cell face-span-all">
      <div class="wave-pic">
        <LfoGraph params={lfo} shape={tremolo ? 'Sine' : WAVES[step(AUTO_PAN2.wave)]} rate="Rate" amount="Amount" ink={fx.color.primary} interactive={false} />
      </div>
      {#if tremolo}
        <div class="switch-pair">
          {@render toggleRow('Harmonic', AUTO_PAN2.harmonic)}
          {@render toggleRow('Vintage', AUTO_PAN2.vintage)}
        </div>
      {:else}
        <ScrubTabs
          options={WAVES}
          selected={step(AUTO_PAN2.wave)}
          onSelect={(i) => fx.sendParam(AUTO_PAN2.wave, i)}
          ghost={fx.isGhost}
          label={(w) => w}
          groupLabel="Waveform"
          name="wave"
          cols={3}
          class="wave-tab"
          style="--scrub-font-size: 0.8125rem; --scrub-padding: 0;"
        />
      {/if}
    </div>
  </FaceSection>
  <FaceSeam />

  <!-- Panning: Phase | Spin over the knob it names and Offset. Tremolo has
       Offset alone, in the section's middle, on the same line. -->
  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Stereo" color={fx.color.primary} />{/snippet}
    <div class="face-span-all board">
      {#if !tremolo}
        <ScrubTabs
          options={STEREO_MODES}
          selected={spin ? 1 : 0}
          onSelect={(i) => fx.sendParam(AUTO_PAN2.stereoMode, i)}
          cols={2}
          ghost={fx.isGhost}
          label={(m) => m}
          groupLabel="Stereo mode"
          name="stereo-mode"
          class="span-all"
          style="--scrub-font-size: 0.875rem;"
        />
        {@render knob(stereo[0], 'row-2')}
        {@render knob(stereo[1], 'row-2')}
      {:else}
        {@render knob(stereo[1], 'row-2 span-all')}
      {/if}
    </div>
  </FaceSection>
  <FaceSeam />

  <!-- Invert turns the wave over; under it the three knobs that shape it. -->
  <FaceSection span={3}>
    {#snippet head()}<PanelEyebrow title="Shape" color={fx.color.primary} />{/snippet}
    <div class="face-span-all board">
      {@render toggleRow('Invert', AUTO_PAN2.invert, 'span-all')}
      {#each shaping as box (box.index)}{@render knob(box, 'row-2')}{/each}
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
  .cell > :global(.touch-row) {
    flex: 0 0 var(--height-touch);
    min-height: 0;
  }

  .wave-pic {
    flex: 1 1 0;
    min-height: 0;
  }
  /* Nine waves, three touch rows. */
  .cell > :global(.wave-tab) {
    flex: 0 0 calc(3 * var(--height-touch) + 2px);
    min-height: 0;
  }
  .switch-pair {
    flex: 0 0 var(--height-touch);
    display: flex;
    gap: var(--face-gutter);
    min-height: 0;
  }

  /* A section's two lines on the face's own columns: the touch row, then
     the knobs, one a column. */
  .board {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: var(--height-touch) minmax(0, 1fr);
    gap: var(--face-gutter);
    min-height: 0;
    min-width: 0;
  }
  .board > :global(.span-all) {
    grid-column: 1 / -1;
  }
  .board > :global(.row-2) {
    grid-row: 2;
  }

  .knob-cell {
    display: flex;
    min-height: 0;
    min-width: 0;
  }
  .knob-cell > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }

  /* A switch: one touch row. */
  .fx-switch {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    padding-inline: 2px;
    font-size: 0.875rem;
    font-weight: var(--font-weight-medium);
  }
</style>
