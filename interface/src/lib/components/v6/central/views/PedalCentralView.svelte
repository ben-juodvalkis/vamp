<script lang="ts">
  /**
   * The Pedal's view (Live's Pedal, the `pedal` slot). One device per view
   * since the FX chain overview took over from the grid (2026-10-26): the
   * Guitar rack, the Wah, the Shifter, the Saturator, Redux and the Drum
   * button that shared this file each have a view of their own now
   * (`GuitarCentralView`, `WahCentralView`, `ShifterCentralView`,
   * `SaturatorCentralView`, `ReduxCentralView`; the chain is the door to
   * the Drum Buss).
   *
   * One Drive/Mix slider at the left, full height, then the tone stack on
   * the EQ tile's pad over the type switch (2026-10-07). Indices and ranges
   * measured off the running device: 1 Type (Drive · Distort · Fuzz),
   * 2 Drive 0..1, 4 Bass / 5 Mid / 6 Treble -1..1 (0 flat), 7 Mid Freq
   * quantized Low · Mid · High, 9 Dry/Wet 0..1. The pad's X snaps to Mid
   * Freq's three steps; the curve draws them an octave apart, 315 Hz /
   * 630 Hz / 1.26 kHz, all inside the pad's middle third (user,
   * 2026-10-07) — a picture only: Live does not say what the three
   * frequencies are.
   *
   * NO {#if device} gate - always renders, handles its own state.
   */

  import ToneCurvePad from '$lib/components/v6/device-panel/ToneCurvePad.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';

  const fx = useFxGridSlot('pedal');

  let pedalInk = $derived({
    primary: trackInk(fx.color.primary, paintModeReactive()),
    secondary: fx.color.secondary,
    accent: trackInk(fx.color.accent, paintModeReactive())
  });

  const PEDAL_TYPE_OPTIONS = [
    { value: 0, label: 'Drive' },
    { value: 1, label: 'Distort' },
    { value: 2, label: 'Fuzz' }
  ];

  const PEDAL = { type: 1, drive: 2, bass: 4, mid: 5, treble: 6, midFreq: 7, dryWet: 9 } as const;
  const MID_FREQ_STEPS = 2;
  const pedalMidFreqHz = (f: number) => 630 * Math.pow(2, (f - 0.5) * 2);
  const toneValue = (index: number) => ((fx.paramValue(index) ?? 0) + 1) / 2;
  const sendTone = (index: number, normalized: number) => fx.sendParam(index, normalized * 2 - 1);

  let pedalType = $derived(fx.paramValue(PEDAL.type) ?? 0);
  let pedalMidFreq = $derived((fx.paramValue(PEDAL.midFreq) ?? 1) / MID_FREQ_STEPS);
  let pedalDrive = $derived(fx.paramValue(PEDAL.drive) ?? 0);
</script>

<div class="pedal-layout" data-view="pedal">
  <!-- Drive and Dry/Wet together on one slider, as the old pad's Y was. -->
  <div class="pedal-drive" class:slot-ghost={fx.isGhost}>
    <DeviceSlider
      value={pedalDrive}
      title="Drive"
      icon="drive"
      orientation="vertical"
      isGhost={fx.isGhost}
      color={pedalInk}
      readout={fx.paramDisplay(PEDAL.drive)}
      min={0}
      max={1}
      onTap={() => fx.loadIfGhost()}
      onInteraction={(v) => {
        fx.sendParam(PEDAL.drive, v);
        fx.sendParam(PEDAL.dryWet, v);
      }}
    />
  </div>

  <div class="pedal-tone" class:slot-ghost={fx.isGhost}>
    <ToneCurvePad
      title="Tone"
      ariaLabel="Pedal tone: bass, mid and treble"
      low={toneValue(PEDAL.bass)}
      mid={toneValue(PEDAL.mid)}
      midFreq={pedalMidFreq}
      high={toneValue(PEDAL.treble)}
      isGhost={fx.isGhost}
      color={pedalInk}
      curveColor={pedalInk.primary}
      midFreqHz={pedalMidFreqHz}
      onTap={() => fx.loadIfGhost()}
      onLow={(v) => sendTone(PEDAL.bass, v)}
      onHigh={(v) => sendTone(PEDAL.treble, v)}
      onMid={(x, y) => {
        const step = Math.round(x * MID_FREQ_STEPS);
        if (step !== fx.paramValue(PEDAL.midFreq)) fx.sendParam(PEDAL.midFreq, step);
        sendTone(PEDAL.mid, y);
      }}
    />
  </div>

  <!-- The pedal types, one pick-one tab. -->
  <div class="pedal-type-buttons device-segmented seg-grid" style="--btn-tint: {pedalInk.primary};{fx.isGhost ? ' opacity: var(--opacity-ghost);' : ''}">
    {#each PEDAL_TYPE_OPTIONS as option}
      <button
        class="device-segment w-full px-2 text-xs text-center font-medium"
        class:active={pedalType === option.value}
        onclick={() => fx.sendParam(PEDAL.type, option.value)}
      >
        {option.label}
      </button>
    {/each}
  </div>
</div>

<style>
  /* Drive at the left, full height; the tone pad over the type switch on
     the two tracks beside it (a slider one share, a pad two). */
  .pedal-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  .pedal-drive {
    grid-column: 1;
    grid-row: 1 / span 2;
    min-width: 0;
    min-height: 0;
  }

  .pedal-tone {
    grid-column: 2 / span 2;
    grid-row: 1;
    min-width: 0;
    min-height: 0;
  }

  /* Drive · Distort · Fuzz across the foot of the pad, one row a
     slider-label tall. */
  .pedal-type-buttons {
    grid-column: 2 / span 2;
    grid-row: 2;
    display: flex;
    flex-direction: row;
    gap: 1px;
    height: 3rem;
  }

  .pedal-type-buttons button {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
