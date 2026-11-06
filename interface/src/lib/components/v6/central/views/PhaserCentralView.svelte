<script lang="ts">
  /**
   * The Phaser-Flanger's view (the `phaser` slot), its unfolded panel left
   * to right (2026-11-06, was the pad alone; Live 12 manual §29.29):
   *
   *   [Mode · FB Invert]
   *   | [Phaser: Notches  Center / Spread  Blend; Flanger or Doubler: Time]
   *   | [LFO Waveform] [Amount  Duty Cyc / Env  Env Fol] | [Warmth / Output / Dry/Wet]
   *
   * on one face grid (ADR-510), sections 1 · 2 · 3 · 1, every knob medium,
   * two to a row.
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
  import ParamColumn from './fx/ParamColumn.svelte';
  import ParamSwitch from './fx/ParamSwitch.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

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

  let mode = $derived(Math.round(fx.paramValue(PHASER.mode) ?? 0));
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
  const MOTION = [
    { index: PHASER.lfoAmount, title: 'Amount', rest: 0.9762 },
    { index: PHASER.dutyCycle, title: 'Duty Cyc', rest: 0.55, center: 0.5 },
    { index: PHASER.envAmount, title: 'Env', rest: 0.5, center: 0.5 }
  ];
  let envOn = $derived((fx.paramValue(PHASER.envOn) ?? 1) >= 0.5);
  const OUT = [
    { index: PHASER.warmth, title: 'Warmth', rest: 0 },
    { index: PHASER.output, title: 'Output', rest: 0.7071 },
    { index: PHASER.dryWet, title: 'Dry/Wet', rest: 1 }
  ];
</script>

<!-- One face grid (ADR-510), seven columns of ~130px at 1366 x 1024:
     Mode 1 · Voice 2 · LFO / Env 3 · Output 1. -->
<div class="face-root" data-view="phaser">
<FaceGrid sections={[1, 2, 3, 1]}>
  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Mode" color={fx.color.primary} />{/snippet}
    <div class="cell">
      <ScrubTabs
        options={MODES}
        selected={mode}
        onSelect={(i) => fx.sendParam(PHASER.mode, i)}
        cols={1}
        tint={fx.color.primary}
        inked
        ghost={fx.isGhost}
        label={(m) => m}
        groupLabel="Mode"
        name="mode"
        class="flex-1"
      />
      <ParamSwitch row label="FB Invert" on={fbInvert} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => fx.sendParam(PHASER.fbInvert, fbInvert ? 0 : 1)} />
    </div>
  </FaceSection>
  <FaceSeam />

  <!-- Up to four knobs, two to a row: medium (ADR-509). -->
  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Voice" color={fx.color.primary} />{/snippet}
    <ParamColumn face="knob" knobSize="m" span={2} {fx} ink={fx.color} boxes={voicing} fullest={4} />
  </FaceSection>
  <FaceSeam />

  <!-- The wave, then Amount and Duty Cyc over Env and its switch, two to a
       row: medium. -->
  <FaceSection span={3}>
    {#snippet head()}<PanelEyebrow title="LFO / Env" color={fx.color.primary} />{/snippet}
    <ScrubTabs
      options={WAVES}
      selected={Math.round(fx.paramValue(PHASER.wave) ?? 1)}
      onSelect={(i) => fx.sendParam(PHASER.wave, i)}
      cols={1}
      tint={fx.color.primary}
      inked
      ghost={fx.isGhost}
      label={(w) => w}
      groupLabel="LFO wave"
      name="wave"
    />
    <ParamColumn face="knob" knobSize="m" span={2} {fx} ink={fx.color} boxes={MOTION}>
      {#snippet after()}
        <ParamSwitch row label="Env Fol" on={envOn} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => fx.sendParam(PHASER.envOn, envOn ? 0 : 1)} />
      {/snippet}
    </ParamColumn>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Output" color={fx.color.primary} />{/snippet}
    <ParamColumn {fx} ink={fx.color} boxes={OUT} />
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
