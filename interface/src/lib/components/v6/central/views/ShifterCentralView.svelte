<script lang="ts">
  /**
   * The Shifter's view (Live's Shifter, the `shifter` slot). Its own file
   * since the FX chain overview took over from the grid (2026-10-26); it
   * was the first column of the Saturator tile's view. More of the device
   * the same day (user: "add more controls to shifter central view", "just
   * one slider for amount, and the 3-way switch", "more LFO controls"):
   *
   *   [Amount] [Mode: Pitch Freq Ring, Wide] [Drive / Tone / Dry/Wet] |
   *   [LFO pad: rate across, amount up] [Wave, 2 × 5] [Morph / Width / Offset]
   *   [Sync, Stereo: Phase Spin, Phase or Spin]
   *
   * Amount is the `shifter` control (`deviceControls`, ADR-479): the mode's
   * own amount (Pitch Coarse, FShift Coarse or RM Coarse), so the chain cell
   * and the browser tile follow the switch too. The LFO's amount is the
   * mode's as well, semitones in Pitch and hertz otherwise, and its rate is
   * Live's synced step while Sync is on. Drive turns RM Drive on above 0 and
   * off at 0.
   *
   * Measured on the rig (device_dump on the set's "Ring Mod", 2026-10-26):
   * 1 LFO Amt Hz, 2 LFO Amt St, 3 LFO Wave 0..9, 4 LFO Sync, 5 LFO Freq,
   * 6 LFO Synced 0..21, 7 LFO Stereo Mode (Phase, Spin), 8 LFO Phase, 9 LFO
   * Spin, 10 LFO Offset, 11 LFO Width, 12 LFO Morph, 19 RM Drive, 20 RM Drive
   * Gain, 32 Mode 0..2, 33 Tone, 34 Wide, 35 Dry/Wet, all 0..1 unless
   * given. Readouts are Live's own text. A ghost draws Live's defaults, and
   * its first write loads it.
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */
  import ControlTile from '$lib/components/v6/device-panel/ControlTile.svelte';
  import KnobGrid from '$lib/components/v6/device-panel/KnobGrid.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
  import SectionDivider from '$lib/components/v6/central/SectionDivider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';

  const shifter = useFxGridSlot('shifter');

  let ink = $derived({
    primary: trackInk(shifter.color.primary, paintModeReactive()),
    secondary: shifter.color.secondary,
    accent: trackInk(shifter.color.accent, paintModeReactive())
  });

  const P = {
    lfoAmtHz: 1, lfoAmtSt: 2, wave: 3, sync: 4, lfoFreq: 5, lfoSynced: 6, stereo: 7, phase: 8, spin: 9,
    offset: 10, width: 11, morph: 12, drive: 19, driveGain: 20, mode: 32, tone: 33, wide: 34, dryWet: 35
  } as const;
  const SYNCED_MAX = 21;
  /** Live's values on a fresh Shifter (Ring, as the ghost loads it), what a ghost shows. */
  const REST: Record<number, number> = {
    1: 0, 2: 0, 3: 1, 4: 0, 5: 0.4593, 6: 12, 7: 1, 8: 0.5, 9: 0, 10: 0, 11: 0, 12: 0.5,
    19: 0, 20: 0, 32: 2, 33: 1, 34: 0, 35: 1
  };
  /** Live's names for LFO Wave's steps (device_dump). */
  const WAVES = ['Sine', 'Triangle', 'Triangle Analog', 'Triangle 8', 'Triangle 16', 'Saw Up', 'Saw Down', 'Rectangle', 'Random', 'Random S&H'];

  /** A triangle quantized to `n` steps a cycle, in the glyphs' 24 × 12 box. */
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
  /**
   * LFO Wave as pictures, as Echo's (user, 2026-10-26: "like the waveforms in
   * echo central view"): one cycle per glyph in a 24 × 12 box, Live's name
   * on `title`, two columns of five. The grid scrubs, so only a cell edge
   * reaches Live.
   */
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
  const WAVE_COLS = 2;

  const value = (index: number) => shifter.paramValue(index) ?? REST[index];
  const on = (index: number) => value(index) >= 0.5;
  const toggle = (index: number) => shifter.sendParam(index, on(index) ? 0 : 1);
  const mode = $derived(Math.round(value(P.mode)));
  const lfoAmount = $derived(mode === 0 ? P.lfoAmtSt : P.lfoAmtHz);
  const synced = $derived(on(P.sync));
  const spin = $derived(on(P.stereo));
  const wave = $derived(Math.round(value(P.wave)));

  function setDrive(v: number) {
    const lit = v > 0 ? 1 : 0;
    if (Math.round(value(P.drive)) !== lit) shifter.sendParam(P.drive, lit);
    shifter.sendParam(P.driveGain, v);
  }

  const MODES = ['Pitch', 'Freq', 'Ring'];
  // The shifter's character as knobs, its Dry/Wet a box of its own, the
  // level a set rides (ADR-509).
  const BOXES = [
    { index: P.driveGain, title: 'Drive', write: setDrive },
    { index: P.tone, title: 'Tone', write: (v: number) => shifter.sendParam(P.tone, v) }
  ];
  const LFO_BOXES = [
    { index: P.morph, title: 'Morph', center: 0.5 },
    { index: P.width, title: 'Width' },
    { index: P.offset, title: 'Offset' }
  ];
</script>

<div class="shifter-layout" data-view="shifter" style="--btn-tint: {ink.primary};">
  <div class="col">
    <ControlTile type="shifter" device={shifter.device} icon="ringmod" disableCentralViewOnTap tapLoads labelSize="large" />
  </div>

  <div class="col" class:slot-ghost={shifter.isGhost}>
    <ScrubTabs
      options={MODES}
      selected={shifter.isGhost ? -1 : mode}
      onSelect={(i) => shifter.sendParam(P.mode, i)}
      cols={1}
      tint={ink.primary}
      inked
      label={(l) => l}
      groupLabel="Mode"
      style="flex: 3 1 0; --scrub-font-size: 1rem; --scrub-font-weight: var(--font-weight-medium);"
    />
    <button class="physical-button switch" class:active={on(P.wide)} aria-pressed={on(P.wide)} onclick={() => toggle(P.wide)}>Wide</button>
  </div>

  <div class="col boxes" class:slot-ghost={shifter.isGhost}>
    {#each BOXES as b (b.index)}
      <DeviceSlider
        value={value(b.index)}
        title={b.title}
        face="knob"
        knobSize="l"
        min={0}
        max={1}
        isGhost={shifter.isGhost}
        color={ink}
        readout={shifter.paramDisplay(b.index)}
        onInteraction={b.write}
      />
    {/each}
  </div>

  <div class="col boxes" class:slot-ghost={shifter.isGhost}>
    <DeviceSlider
      value={value(P.dryWet)}
      title="Dry/Wet"
      icon="mix"
      orientation="vertical"
      min={0}
      max={1}
      isGhost={shifter.isGhost}
      color={ink}
      readout={shifter.paramDisplay(P.dryWet)}
      onInteraction={(v) => shifter.sendParam(P.dryWet, v)}
    />
  </div>

  <SectionDivider orientation="vertical" />

  <div class="col" class:slot-ghost={shifter.isGhost}>
    <DeviceXY
      xValue={synced ? value(P.lfoSynced) / SYNCED_MAX : value(P.lfoFreq)}
      yValue={value(lfoAmount)}
      title="LFO"
      rateLabel={shifter.paramDisplay(synced ? P.lfoSynced : P.lfoFreq)}
      isGhost={shifter.isGhost}
      showCurve={false}
      color={ink}
      onTap={() => shifter.loadIfGhost()}
      onInteraction={(x, y) => {
        if (synced) shifter.sendParam(P.lfoSynced, Math.round(x * SYNCED_MAX));
        else shifter.sendParam(P.lfoFreq, x);
        shifter.sendParam(lfoAmount, y);
      }}
    />
  </div>

  <div class="col" class:slot-ghost={shifter.isGhost}>
    <ScrubTabs
      options={WAVES}
      selected={shifter.isGhost ? -1 : wave}
      onSelect={(i) => shifter.sendParam(P.wave, i)}
      cols={WAVE_COLS}
      tint={ink.primary}
      inked
      label={(l) => `LFO wave ${l}`}
      name="shifter-lfo-wave"
      style="flex: 1 1 0; --scrub-padding: 6px;"
    >
      {#snippet item(_, i)}
        <svg class="wave-glyph" viewBox="0 0 24 12" aria-hidden="true" focusable="false">
          <path d={WAVE_GLYPHS[i]} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
        </svg>
      {/snippet}
    </ScrubTabs>
  </div>

  <div class="col" class:slot-ghost={shifter.isGhost}>
    <KnobGrid count={LFO_BOXES.length}>
      {#snippet item(i, size)}
        {@const b = LFO_BOXES[i]}
        <DeviceSlider
          value={value(b.index)}
          title={b.title}
          face="knob"
          knobSize={size}
          min={0}
          max={1}
          centerOrigin={b.center !== undefined}
          centerValue={b.center}
          isGhost={shifter.isGhost}
          color={ink}
          readout={shifter.paramDisplay(b.index)}
          onInteraction={(v) => shifter.sendParam(b.index, v)}
        />
      {/snippet}
    </KnobGrid>
  </div>

  <div class="col" class:slot-ghost={shifter.isGhost}>
    <button class="physical-button switch" class:active={synced} aria-pressed={synced} onclick={() => toggle(P.sync)}>Sync</button>
    <ScrubTabs
      options={['Phase', 'Spin']}
      selected={shifter.isGhost ? -1 : Number(spin)}
      onSelect={(i) => shifter.sendParam(P.stereo, i)}
      cols={1}
      tint={ink.primary}
      inked
      label={(l) => l}
      groupLabel="Stereo"
      style="flex: 2 1 0; --scrub-font-size: 1rem; --scrub-font-weight: var(--font-weight-medium);"
    />
    <div class="boxes stereo-box">
      <DeviceSlider
        value={value(spin ? P.spin : P.phase)}
        title={spin ? 'Spin' : 'Phase'}
        face="knob"
        knobSize="l"
        min={0}
        max={1}
        isGhost={shifter.isGhost}
        color={ink}
        readout={shifter.paramDisplay(spin ? P.spin : P.phase)}
        onInteraction={(v) => shifter.sendParam(spin ? P.spin : P.phase, v)}
      />
    </div>
  </div>
</div>

<style>
  /* Amount and the LFO pad the widest; a seam between the shifter and its LFO. */
  .shifter-layout {
    display: grid;
    /* Amount, Mode, the Drive and Tone knobs, Dry/Wet | the LFO pad, its
       waves, its knobs two wide, Sync and Stereo (ADR-509). */
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 0.8fr) auto minmax(0, 1.75fr) minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);
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
  .boxes {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    min-height: 0;
  }
  .boxes > :global(*),
  .col > :global(.device-control),
  .col > :global(.xy-pad) {
    flex: 1 1 0;
  }
  .stereo-box {
    flex: 2 1 0;
  }

  .wave-glyph {
    width: 100%;
    height: 100%;
    max-height: 22px;
  }

  .switch {
    flex: 1 1 0;
    min-height: var(--height-touch);
    font-size: 1rem;
    font-weight: 600;
  }

  :global([data-grammar="flat"]) .switch {
    font-weight: var(--font-weight-medium);
  }
  :global([data-grammar="flat"]) .switch.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }
</style>
