<script lang="ts">
  /**
   * Live 12's Auto Pan-Tremolo (the `autoPanTremolo` slot, 2026-11-06), laid
   * out as Live's panel reads, left to right:
   *
   *   [pad: rate across, amount up] [Mode · LFO Mode] [Wave]
   *   [Phase / Offset / Morph] [Attack / Dyn Mod · Invert · Harmonic · Vintage]
   *
   * The pad is the `autoPanTremolo` control (deviceControls): its X is the
   * rate LFO Mode picks, its Y the depth from the middle, Invert below it.
   * Morph is Panning's or Tremolo's own, whichever Mode is on, as Live
   * shows one. Indices, ranges and labels are `autoPan2Params.ts`, measured
   * on the rig. Not drawn: Time's and the Spin stereo mode's controls.
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
  const REST: Record<number, number> = { [AUTO_PAN2.mode]: 1, [AUTO_PAN2.lfoMode]: 5, [AUTO_PAN2.wave]: 0, [AUTO_PAN2.invert]: 0, [AUTO_PAN2.harmonic]: 0, [AUTO_PAN2.vintage]: 0 };
  const value = (index: number) => fx.paramValue(index) ?? REST[index] ?? 0;
  const step = (index: number) => Math.round(value(index));
  const toggle = (index: number) => fx.sendParam(index, value(index) >= 0.5 ? 0 : 1);

  let tremolo = $derived(step(AUTO_PAN2.mode) === 1);
  let shape = $derived([
    { index: AUTO_PAN2.phase, title: 'Phase', rest: 0.5 },
    { index: AUTO_PAN2.offset, title: 'Offset', rest: 0 },
    tremolo
      ? { index: AUTO_PAN2.tremoloMorph, title: 'Morph', rest: 0.5, center: 0.5 }
      : { index: AUTO_PAN2.lfoMorph, title: 'Morph', rest: 0 }
  ]);
  const DYNAMICS = [
    { index: AUTO_PAN2.attack, title: 'Attack', rest: 0 },
    { index: AUTO_PAN2.dynMod, title: 'Dyn Mod', rest: 0.5, center: 0.5 }
  ];
  const SWITCHES = [
    { index: AUTO_PAN2.invert, label: 'Invert' },
    { index: AUTO_PAN2.harmonic, label: 'Harmonic' },
    { index: AUTO_PAN2.vintage, label: 'Vintage' }
  ];
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
      groupLabel="Rate mode"
      name="lfo-mode"
      style="flex: 6 1 0;"
    />
  </div>

  <div class="cell">
    <ScrubTabs
      options={WAVES}
      selected={step(AUTO_PAN2.wave)}
      onSelect={(i) => fx.sendParam(AUTO_PAN2.wave, i)}
      cols={1}
      tint={fx.color.primary}
      inked
      ghost={fx.isGhost}
      label={(w) => w}
      groupLabel="Wave"
      name="wave"
      class="flex-1"
    />
  </div>

  <ParamColumn {fx} ink={fx.color} boxes={shape} />

  <div class="cell">
    <div class="grow2"><ParamColumn {fx} ink={fx.color} boxes={DYNAMICS} /></div>
    {#each SWITCHES as s (s.index)}
      <ParamSwitch label={s.label} on={value(s.index) >= 0.5} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => toggle(s.index)} />
    {/each}
  </div>
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

  .grow2 {
    flex: 4 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .grow2 > :global(*) {
    flex: 1 1 0;
  }
</style>
