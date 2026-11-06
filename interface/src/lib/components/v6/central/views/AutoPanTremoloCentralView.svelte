<script lang="ts">
  /**
   * Live 12's Auto Pan-Tremolo (the `autoPanTremolo` slot, 2026-11-06), laid
   * out as Live's panel reads (Live 12 manual §29.3), left to right:
   *
   *   [Panning | Tremolo · Time mode]
   *   | [Panning: Waveform; Tremolo: Harmonic · Vintage]
   *   | [Panning: Phase | Spin · Invert] [Phase or Spin / Offset] | [Shape / Att / Mod]
   *
   * on one face grid (ADR-510), sections 1 · 1 · 2 · 1.
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
  import ParamColumn from './fx/ParamColumn.svelte';
  import ParamSwitch from './fx/ParamSwitch.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { AUTO_PAN2, LFO_MODES, MODES, WAVES } from '$lib/components/v6/device-panel/autoPan2Params';

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
  let shaping = $derived([
    tremolo
      ? { index: AUTO_PAN2.tremoloMorph, title: 'Shape', rest: 0.5, center: 0.5 }
      : { index: AUTO_PAN2.lfoMorph, title: 'Shape', rest: 0 },
    { index: AUTO_PAN2.attack, title: 'Att', rest: 0 },
    { index: AUTO_PAN2.dynMod, title: 'Mod', rest: 0.5, center: 0.5 }
  ]);
</script>

<!-- One face grid (ADR-510), five columns of ~185px at 1366 x 1024:
     Mode 1 · Wave 1 · Stereo 2 · Shape 1. -->
<div class="face-root" data-view="autoPanTremolo">
<FaceGrid sections={[1, 1, 2, 1]}>
  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Mode" color={fx.color.primary} />{/snippet}
    <div class="cell">
      <ScrubTabs
        options={MODES}
        selected={step(AUTO_PAN2.mode)}
        onSelect={(i) => fx.sendParam(AUTO_PAN2.mode, i)}
        cols={1}
        tint={fx.color.primary}
        inked
        ghost={fx.isGhost}
        label={(m) => m}
        groupLabel="Mode"
        name="mode"
        style="flex: 2 1 0;"
      />
      <ScrubTabs
        options={LFO_MODES}
        selected={step(AUTO_PAN2.lfoMode)}
        onSelect={(i) => fx.sendParam(AUTO_PAN2.lfoMode, i)}
        cols={1}
        tint={fx.color.primary}
        inked
        ghost={fx.isGhost}
        label={(m) => m}
        groupLabel="Time mode"
        name="lfo-mode"
        style="flex: 6 1 0;"
      />
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title={tremolo ? 'Tremolo' : 'Wave'} color={fx.color.primary} />{/snippet}
    <div class="cell">
      {#if tremolo}
        <ParamSwitch label="Harmonic" on={value(AUTO_PAN2.harmonic) >= 0.5} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => toggle(AUTO_PAN2.harmonic)} />
        <ParamSwitch label="Vintage" on={value(AUTO_PAN2.vintage) >= 0.5} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => toggle(AUTO_PAN2.vintage)} />
      {:else}
        <ScrubTabs
          options={WAVES}
          selected={step(AUTO_PAN2.wave)}
          onSelect={(i) => fx.sendParam(AUTO_PAN2.wave, i)}
          cols={1}
          tint={fx.color.primary}
          inked
          ghost={fx.isGhost}
          label={(w) => w}
          groupLabel="Waveform"
          name="wave"
          class="flex-1"
        />
      {/if}
    </div>
  </FaceSection>
  <FaceSeam />

  <!-- Phase | Spin over Invert, beside Phase (or Spin) over Offset: two
       medium knobs in a column of their own. -->
  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Stereo" color={fx.color.primary} />{/snippet}
    <div class="cell">
      {#if !tremolo}
        <ScrubTabs
          options={STEREO_MODES}
          selected={spin ? 1 : 0}
          onSelect={(i) => fx.sendParam(AUTO_PAN2.stereoMode, i)}
          cols={1}
          tint={fx.color.primary}
          inked
          ghost={fx.isGhost}
          label={(m) => m}
          groupLabel="Stereo mode"
          name="stereo-mode"
          class="flex-1"
        />
      {:else}
        <div class="flex-1"></div>
      {/if}
      <ParamSwitch row label="Invert" on={value(AUTO_PAN2.invert) >= 0.5} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => toggle(AUTO_PAN2.invert)} />
    </div>
    <ParamColumn face="knob" knobSize="m" {fx} ink={fx.color} boxes={tremolo ? stereo.slice(1) : stereo} fullest={2} />
  </FaceSection>
  <FaceSeam />

  <!-- Three knobs stacked: medium, their names beside them (ADR-509). -->
  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Shape" color={fx.color.primary} />{/snippet}
    <ParamColumn face="knob" knobSize="m" {fx} ink={fx.color} boxes={shaping} />
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
</style>
