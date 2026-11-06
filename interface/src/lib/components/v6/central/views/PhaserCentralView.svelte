<script lang="ts">
  /**
   * The Phaser-Flanger's view (the `phaser` slot), its panel left to right
   * (2026-11-06, was the pad alone):
   *
   *   [pad: LFO speed across, feedback up] [Mode · FB Invert]
   *   [Phaser: Notches / Center / Spread; Flanger or Doubler: Time]
   *   [LFO Wave] [LFO Amount / Env Amount] [Warmth / Output / Dry/Wet]
   *
   * The pad is the `phaser` control (deviceControls, PhaserPad). Indices,
   * ranges and labels measured on the rig (device_dump, 2026-11-06): 1 LFO
   * Amount, 2 LFO Wave 0..9, 15 Env Amount (-1..1 on 0..1), 18 Mode 0..2, 19 Notches
   * 1..42, 20 Flanger Time, 21 Doubler Time, 23 Center Freq, 24 Spread,
   * 26 Warmth, 28 FB Invert, 29 Output, 30 Dry/Wet, the rest 0..1. A ghost
   * draws Live's values on a fresh insert. Not drawn: LFO 2, the LFO's sync
   * and stereo controls, the envelope's times and Safe Bass.
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */
  import PhaserPad from './chorus/PhaserPad.svelte';
  import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';
  import ParamColumn from './fx/ParamColumn.svelte';
  import ParamSwitch from './fx/ParamSwitch.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

  const fx = useFxGridSlot('phaser');

  const PHASER = {
    lfoAmount: 1,
    wave: 2,
    envAmount: 15,
    mode: 18,
    notches: 19,
    flangerTime: 20,
    doublerTime: 21,
    center: 23,
    spread: 24,
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
          { index: PHASER.spread, title: 'Spread', rest: 0.3516 }
        ]
      : mode === 1
        ? [{ index: PHASER.flangerTime, title: 'Time', rest: 0.6075 }]
        : [{ index: PHASER.doublerTime, title: 'Time', rest: 0.688 }]
  );
  const MOTION = [
    { index: PHASER.lfoAmount, title: 'LFO Amount', rest: 0.9762 },
    { index: PHASER.envAmount, title: 'Env Amount', rest: 0.5, center: 0.5 }
  ];
  const OUT = [
    { index: PHASER.warmth, title: 'Warmth', rest: 0 },
    { index: PHASER.output, title: 'Output', rest: 0.7071 },
    { index: PHASER.dryWet, title: 'Dry/Wet', rest: 1 }
  ];
</script>

<div class="fx-layout" data-view="phaser">
  <div class="cell" class:slot-ghost={fx.isGhost}>
    <PhaserPad />
  </div>

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
      style="flex: 3 1 0;"
    />
    <ParamSwitch label="FB Invert" on={fbInvert} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => fx.sendParam(PHASER.fbInvert, fbInvert ? 0 : 1)} />
  </div>

  <ParamColumn {fx} ink={fx.color} boxes={voicing} />

  <div class="cell">
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
      class="flex-1"
    />
  </div>

  <ParamColumn {fx} ink={fx.color} boxes={MOTION} />
  <ParamColumn {fx} ink={fx.color} boxes={OUT} />
</div>

<style>
  /* The pad two shares; the tab and box columns one each. */
  .fx-layout {
    display: grid;
    grid-template-columns: minmax(0, 2fr) repeat(5, minmax(0, 1fr));
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
</style>
