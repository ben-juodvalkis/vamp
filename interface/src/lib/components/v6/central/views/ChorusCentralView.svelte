<script lang="ts">
  /**
   * The Chorus's view (Live's Chorus-Ensemble, the `chorus` slot), its
   * panel left to right (2026-11-06; Mode and four boxes from 2026-10-26):
   *
   *   [pad: Rate across, Dry/Wet up] [Mode, then Chorus's Time and Taps 1 | 2
   *   or Vibrato's Shape / Offset] [Amount / Feedback · FB Invert]
   *   [Width / Warmth] [HP On · HP Freq / Output]
   *
   * Live 12 manual §29.8: Width belongs to Chorus and Ensemble, Shape and
   * Offset to Vibrato, Time and Taps to Chorus alone; Feedback is disabled
   * in Vibrato. The pad is the `chorus` control (deviceControls, ADR-479). Indices,
   * ranges and labels measured on the rig (device_dump, 2026-11-06): 1 Mode
   * 0..2 Chorus / Ensemble / Vibrato, 2 Shape, 4 Amount, 5 Feedback (99 %
   * at 1), 6 FB Invert, 7 Offset (0..180°), 8 Delay Time 0..5 (Auto, 7, 10,
   * 20, 35, 50 ms), 9 Delay Taps (0 = 1, 1 = 2), 10 HP On, 11 HP Freq
   * (20 Hz .. 2 kHz), 12 Width (0..200 %), 13 Warmth, 14 Output (0 dB at
   * 0.7071), all 0..1 but the steps. A ghost draws Live's values on a fresh
   * insert; its first write loads it.
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */
  import ChorusControl from '$lib/components/v6/device-panel/ChorusControl.svelte';
  import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';
  import ParamColumn from './fx/ParamColumn.svelte';
  import ParamSwitch from './fx/ParamSwitch.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { getSlotByDeviceType } from '$lib/config/fxGridLayout';

  const chorus = useFxGridSlot('chorus');

  // The Chorus keeps its layout entry (hidden from the grid) so its slot
  // still resolves by position.
  const chorusPosition = getSlotByDeviceType('chorus')!.position;

  const CHORUS = { mode: 1, shape: 2, amount: 4, feedback: 5, fbInvert: 6, offset: 7, delay: 8, taps: 9, hpOn: 10, hpFreq: 11, width: 12, warmth: 13, output: 14 } as const;
  const MODES = ['Chorus', 'Ensemble', 'Vibrato'] as const;
  const DELAYS = ['Auto', '7 ms', '10 ms', '20 ms', '35 ms', '50 ms'] as const;
  /** Live's Taps toggles, 1 | 2 (Delay Taps 0 | 1). */
  const TAPS = ['1', '2'] as const;
  /** Live's values on a fresh Chorus-Ensemble. */
  const REST: Record<number, number> = { [CHORUS.mode]: 0, [CHORUS.fbInvert]: 0, [CHORUS.delay]: 2, [CHORUS.taps]: 1, [CHORUS.hpOn]: 0 };

  const value = (index: number) => chorus.paramValue(index) ?? REST[index] ?? 0;
  const on = (index: number) => value(index) >= 0.5;
  const toggle = (index: number) => chorus.sendParam(index, on(index) ? 0 : 1);

  let mode = $derived(Math.round(value(CHORUS.mode)));
  const VIBRATO = [
    { index: CHORUS.shape, title: 'Shape', rest: 0 },
    { index: CHORUS.offset, title: 'Offset', rest: 0 }
  ];
  const DEPTH = [
    { index: CHORUS.amount, title: 'Amount', rest: 0.5 },
    { index: CHORUS.feedback, title: 'Feedback', rest: 0 }
  ];
  const SPACE = [
    { index: CHORUS.width, title: 'Width', rest: 0.5 },
    { index: CHORUS.warmth, title: 'Warmth', rest: 0 }
  ];
  const OUT = [
    { index: CHORUS.hpFreq, title: 'HP Freq', rest: 0.2842 },
    { index: CHORUS.output, title: 'Output', rest: 0.7071 }
  ];
</script>

<div class="device-layout" data-view="chorus">
  <div class="cell" class:slot-ghost={chorus.isGhost}>
    <ChorusControl device={chorus.device} position={chorusPosition} />
  </div>

  <div class="cell">
    <ScrubTabs
      options={MODES}
      selected={mode}
      onSelect={(i) => chorus.sendParam(CHORUS.mode, i)}
      cols={1}
      tint={chorus.color.primary}
      inked
      ghost={chorus.isGhost}
      label={(m) => m}
      groupLabel="Mode"
      name="mode"
      style="flex: 3 1 0;"
    />
    {#if mode === 0}
      <ScrubTabs
        options={DELAYS}
        selected={Math.round(value(CHORUS.delay))}
        onSelect={(i) => chorus.sendParam(CHORUS.delay, i)}
        cols={2}
        tint={chorus.color.primary}
        inked
        ghost={chorus.isGhost}
        label={(d) => `Delay ${d}`}
        groupLabel="Delay time"
        name="delay"
        style="flex: 3 1 0;"
      >
        {#snippet item(d)}{d}{/snippet}
      </ScrubTabs>
      <ScrubTabs
        options={TAPS}
        selected={Math.round(value(CHORUS.taps))}
        onSelect={(i) => chorus.sendParam(CHORUS.taps, i)}
        cols={2}
        tint={chorus.color.primary}
        inked
        ghost={chorus.isGhost}
        label={(t) => `${t} ${t === '1' ? 'tap' : 'taps'}`}
        groupLabel="Taps"
        name="taps"
        style="flex: 1 1 0;"
      >
        {#snippet item(t)}{t}{/snippet}
      </ScrubTabs>
    {:else if mode === 2}
      <div class="fill"><ParamColumn face="knob" fx={chorus} ink={chorus.color} boxes={VIBRATO} /></div>
    {/if}
  </div>

  <div class="cell">
    <div class="fill"><ParamColumn face="knob" fx={chorus} ink={chorus.color} boxes={mode === 2 ? DEPTH.slice(0, 1) : DEPTH} /></div>
    {#if mode !== 2}
      <ParamSwitch label="FB Invert" on={on(CHORUS.fbInvert)} tint={chorus.color.primary} ghost={chorus.isGhost} onToggle={() => toggle(CHORUS.fbInvert)} />
    {/if}
  </div>

  <ParamColumn face="knob" fx={chorus} ink={chorus.color} boxes={mode === 2 ? SPACE.slice(1) : SPACE} />

  <div class="cell">
    <ParamSwitch label="High Pass" on={on(CHORUS.hpOn)} tint={chorus.color.primary} ghost={chorus.isGhost} onToggle={() => toggle(CHORUS.hpOn)} />
    <div class="fill"><ParamColumn fx={chorus} ink={chorus.color} boxes={OUT} /></div>
  </div>
</div>

<style>
  /* The pad two shares; the tab and the box columns one each. */
  .device-layout {
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

  .fill {
    flex: 4 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .fill > :global(*) {
    flex: 1 1 0;
  }
</style>
