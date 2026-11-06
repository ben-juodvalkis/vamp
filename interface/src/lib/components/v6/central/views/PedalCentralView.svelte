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
   * On the face grid (ADR-510), sections [1, 2]: Drive, then Tone.
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
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';

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
</script>

<!-- On the face grid (ADR-510): the pedal's type, a vertical tab on the
     left, then the tone pad over three columns. No Drive: the chain cell's
     control sets it, Drive and Dry/Wet together (user, 2026-11-06). -->
<div class="pedal-layout" data-view="pedal">
  <FaceGrid sections={[1, 3]}>
    <FaceSection span={1}>
      {#snippet head()}<PanelEyebrow title="Type" color={pedalInk.primary} />{/snippet}
      <div class="pedal-type-buttons device-segmented seg-grid" style="--btn-tint: {pedalInk.primary};{fx.isGhost ? ' opacity: var(--opacity-ghost);' : ''}">
        {#each PEDAL_TYPE_OPTIONS as option}
          <button
            class="device-segment w-full px-2 text-sm text-center font-medium"
            class:active={pedalType === option.value}
            onclick={() => fx.sendParam(PEDAL.type, option.value)}
          >
            {option.label}
          </button>
        {/each}
      </div>
    </FaceSection>
    <FaceSeam ink={pedalInk.primary} />

    <FaceSection span={3}>
      {#snippet head()}<PanelEyebrow title="Tone" color={pedalInk.primary} />{/snippet}
      <div class="pedal-tone face-span-all" class:slot-ghost={fx.isGhost}>
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
    </FaceSection>
  </FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510): four equal columns, Type, then
     Tone over three. */
  .pedal-layout {
    height: 100%;
    width: 100%;
  }

  .pedal-tone {
    min-width: 0;
    min-height: 0;
  }

  /* Drive · Distort · Fuzz stacked, the column's height shared. */
  .pedal-type-buttons {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-height: 0;
  }

  .pedal-type-buttons button {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
