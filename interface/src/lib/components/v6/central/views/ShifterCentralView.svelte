<script lang="ts">
  /**
   * The Shifter's view (Live's Shifter, the `shifter` slot). Its own file
   * since the FX chain overview took over from the grid (2026-10-26); it
   * was the first column of the Saturator tile's view. More of the device
   * the same day (user: "add more controls to shifter central view"):
   *
   *   [Ring] [Mode: Pitch Freq Ring, Wide] [Pitch / Freq]
   *   [Drive / Tone / Dry/Wet] [LFO pad: rate across, amount up]
   *
   * Ring is the `shifter` control (`deviceControls`, ADR-479): RM Coarse to
   * 1 kHz, heard only in Ring mode, so a gesture on it also sets Ring. Pitch
   * and Freq do the same for their own modes, so each mode's shift is one
   * touch away and the tabs say which is heard. The LFO's amount is the
   * mode's own: semitones in Pitch, hertz in Freq and Ring. Drive turns RM
   * Drive on above 0 and off at 0.
   *
   * Measured on the rig (device_dump on the set's "Ring Mod", 2026-10-26):
   * 1 LFO Amt Hz 0..1, 2 LFO Amt St 0..1, 5 LFO Freq 0..1, 13 Pitch Coarse
   * -24..24, 17 FShift Coarse 0..1 (0.5 = 0 Hz), 19 RM Drive on, 20 RM Drive
   * Gain 0..1 (0..24 dB), 32 Mode 0..2 (Pitch, Freq, Ring), 33 Tone 0..1,
   * 34 Wide, 35 Dry/Wet 0..1. Readouts are Live's own text. A ghost draws
   * Live's defaults, and its first write loads it.
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */
  import ControlTile from '$lib/components/v6/device-panel/ControlTile.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';

  const shifter = useFxGridSlot('shifter');

  let ink = $derived({
    primary: trackInk(shifter.color.primary, paintModeReactive()),
    secondary: shifter.color.secondary,
    accent: trackInk(shifter.color.accent, paintModeReactive())
  });

  const P = {
    lfoAmtHz: 1, lfoAmtSt: 2, lfoFreq: 5, pitch: 13, freq: 17, drive: 19, driveGain: 20,
    mode: 32, tone: 33, wide: 34, dryWet: 35
  } as const;
  const MODE = { pitch: 0, freq: 1, ring: 2 } as const;
  /** Live's values on a fresh Shifter (Ring, as the ghost loads it), what a ghost shows. */
  const REST: Record<number, number> = { 1: 0, 2: 0, 5: 0.4593, 13: 0, 17: 0.5, 19: 0, 20: 0, 32: MODE.ring, 33: 1, 34: 0, 35: 1 };

  const value = (index: number) => shifter.paramValue(index) ?? REST[index];
  const mode = $derived(Math.round(value(P.mode)));
  const lfoAmount = $derived(mode === MODE.pitch ? P.lfoAmtSt : P.lfoAmtHz);

  /** A write that is heard only in `m`: switch to it first. */
  function inMode(m: number, index: number, v: number) {
    if (mode !== m) shifter.sendParam(P.mode, m);
    shifter.sendParam(index, v);
  }
  function setDrive(v: number) {
    const lit = v > 0 ? 1 : 0;
    if (Math.round(value(P.drive)) !== lit) shifter.sendParam(P.drive, lit);
    shifter.sendParam(P.driveGain, v);
  }

  const MODES = ['Pitch', 'Freq', 'Ring'];
  const SHIFTS = [
    { index: P.pitch, title: 'Pitch', mode: MODE.pitch, min: -24, max: 24, center: 0 },
    { index: P.freq, title: 'Freq', mode: MODE.freq, min: 0, max: 1, center: 0.5 }
  ];
  const BOXES = [
    { index: P.driveGain, title: 'Drive', write: setDrive },
    { index: P.tone, title: 'Tone', write: (v: number) => shifter.sendParam(P.tone, v) },
    { index: P.dryWet, title: 'Dry/Wet', icon: 'mix' as const, write: (v: number) => shifter.sendParam(P.dryWet, v) }
  ];
</script>

<div class="shifter-layout" data-view="shifter" style="--btn-tint: {ink.primary};">
  <div class="col">
    <ControlTile type="shifter" device={shifter.device} icon="ringmod" disableCentralViewOnTap tapLoads labelSize="large" />
  </div>

  <div class="col" class:slot-ghost={shifter.isGhost}>
    <div class="tabs device-segmented seg-grid" role="radiogroup" aria-label="Mode">
      {#each MODES as label, i (label)}
        <button
          class="device-segment tab"
          class:active={!shifter.isGhost && mode === i}
          role="radio"
          aria-checked={mode === i}
          onclick={() => shifter.sendParam(P.mode, i)}
        >{label}</button>
      {/each}
    </div>
    <button
      class="physical-button wide"
      class:active={value(P.wide) >= 0.5}
      aria-pressed={value(P.wide) >= 0.5}
      onclick={() => shifter.sendParam(P.wide, value(P.wide) >= 0.5 ? 0 : 1)}
    >Wide</button>
  </div>

  <div class="col boxes" class:slot-ghost={shifter.isGhost}>
    {#each SHIFTS as s (s.index)}
      <DeviceSlider
        value={value(s.index)}
        title={s.title}
        orientation="vertical"
        min={s.min}
        max={s.max}
        centerOrigin
        centerValue={s.center}
        isGhost={shifter.isGhost}
        color={ink}
        readout={shifter.paramDisplay(s.index)}
        onInteraction={(v) => inMode(s.mode, s.index, s.min < 0 ? Math.round(v) : v)}
      />
    {/each}
  </div>

  <div class="col boxes" class:slot-ghost={shifter.isGhost}>
    {#each BOXES as b (b.index)}
      <DeviceSlider
        value={value(b.index)}
        title={b.title}
        icon={b.icon}
        orientation="vertical"
        min={0}
        max={1}
        isGhost={shifter.isGhost}
        color={ink}
        readout={shifter.paramDisplay(b.index)}
        onInteraction={b.write}
      />
    {/each}
  </div>

  <div class="col" class:slot-ghost={shifter.isGhost}>
    <DeviceXY
      xValue={value(P.lfoFreq)}
      yValue={value(lfoAmount)}
      title="LFO"
      rateLabel={shifter.paramDisplay(P.lfoFreq) ?? undefined}
      isGhost={shifter.isGhost}
      showCurve={false}
      color={ink}
      onTap={() => shifter.loadIfGhost()}
      onInteraction={(x, y) => {
        shifter.sendParam(P.lfoFreq, x);
        shifter.sendParam(lfoAmount, y);
      }}
    />
  </div>
</div>

<style>
  /* Ring and the LFO pad two shares; the tabs and the two box columns one each. */
  .shifter-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) repeat(3, minmax(0, 1fr)) minmax(0, 2fr);
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    min-width: 0;
    min-height: 0;
  }
  .col > :global(*) {
    min-height: 0;
  }
  .boxes > :global(*),
  .col > :global(.device-control),
  .col > :global(.xy-pad) {
    flex: 1 1 0;
  }

  .tabs {
    flex: 3 1 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .tab {
    flex: 1;
    min-height: 0;
    font-size: 1rem;
    font-weight: 700;
  }
  .wide {
    flex: 1 1 0;
    font-size: 1rem;
    font-weight: 600;
  }

  /* As the Random view's tabs: the name in the device ink, the lit one filled with it. */
  :global([data-skin="hybrid"]) .tab {
    color: var(--btn-tint);
  }
  :global(.light[data-skin="hybrid"]) .tab {
    color: color-mix(in oklab, var(--btn-tint) 55%, var(--foreground));
  }
  :global([data-grammar="flat"]) .tab,
  :global([data-grammar="flat"]) .wide {
    font-weight: var(--font-weight-medium);
  }
  :global([data-grammar="flat"]) .tab.active,
  :global([data-grammar="flat"]) .wide.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }
</style>
