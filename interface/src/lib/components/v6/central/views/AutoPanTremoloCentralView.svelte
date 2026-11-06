<script lang="ts">
  /**
   * Live 12's Auto Pan-Tremolo (the `autoPanTremolo` slot, 2026-11-06), laid
   * out as Live's panel reads (Live 12 manual §29.3), left to right:
   *
   *   [pad: rate across, amount up] [Panning | Tremolo · Time mode]
   *   [Panning: Waveform; Tremolo: Harmonic · Vintage]
   *   [Panning: Phase | Spin and its value; Offset · Invert] [Shape / Att / Mod]
   *
   * The pad is Live's Amount and rate knobs in one (`autoPanTremolo` in
   * deviceControls): X the rate the Time mode picks, Y the depth from the
   * middle, Invert below it. As in Live, the waveform and the stereo
   * controls are Panning's, and Tremolo shows Harmonic and Vintage in their
   * place; Shape is Panning's or Tremolo's own (two parameters), whichever
   * mode is on. Live allows Spin on all but Random, Wander and S&H. Indices
   * and labels are `autoPan2Params.ts`, measured on the rig.
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */
  import ControlTile from '$lib/components/v6/device-panel/ControlTile.svelte';
  import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';
  import ParamColumn from './fx/ParamColumn.svelte';
  import ParamSwitch from './fx/ParamSwitch.svelte';
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

<div class="fx-layout" data-view="autoPanTremolo">
  <div class="cell" class:slot-ghost={fx.isGhost}>
    <ControlTile type="autoPanTremolo" device={fx.device} disableCentralViewOnTap tapLoads />
  </div>

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

  <div class="cell">
    {#if !tremolo}
      <ScrubTabs
        options={STEREO_MODES}
        selected={spin ? 1 : 0}
        onSelect={(i) => fx.sendParam(AUTO_PAN2.stereoMode, i)}
        cols={2}
        tint={fx.color.primary}
        inked
        ghost={fx.isGhost}
        label={(m) => m}
        groupLabel="Stereo mode"
        name="stereo-mode"
        style="flex: 1 1 0;"
      />
    {/if}
    <div class="grow"><ParamColumn face="knob" {fx} ink={fx.color} boxes={tremolo ? stereo.slice(1) : stereo} /></div>
    <ParamSwitch label="Invert" on={value(AUTO_PAN2.invert) >= 0.5} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => toggle(AUTO_PAN2.invert)} />
  </div>

  <ParamColumn face="knob" {fx} ink={fx.color} boxes={shaping} />
</div>

<style>
  /* The pad two shares; the tabs and the box columns one each. */
  .fx-layout {
    display: grid;
    grid-template-columns: minmax(0, 2fr) repeat(4, minmax(0, 1fr));
    gap: var(--central-gap);
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    min-height: 0;
    min-width: 0;
  }

  .grow {
    flex: 4 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .grow > :global(*) {
    flex: 1 1 0;
  }
</style>
