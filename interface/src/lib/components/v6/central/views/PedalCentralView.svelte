<script lang="ts">
  import { press } from '$lib/actions/press';
  /**
   * The Pedal's view (Live's Pedal, the `pedal` slot). One device per view
   * since the FX chain overview took over from the grid (2026-10-26): the
   * Guitar rack, the Wah, the Shifter, the Saturator, Redux and the Drum
   * button that shared this file each have a view of their own now
   * (`GuitarCentralView`, `WahCentralView`, `ShifterCentralView`,
   * `SaturatorCentralView`, `ReduxCentralView`; the chain is the door to
   * the Drum Buss).
   *
   * On the face grid (ADR-510), sections [1, 4], five equal columns: the
   * pedal's type, a vertical tab, then the tone stack on the EQ tile's pad
   * (2026-10-07), the picture that is played, over four. No Drive: the
   * chain cell's control sets it, Drive and Dry/Wet together (user,
   * 2026-11-06).
   *
   * The pad's three thirds are named at its foot, Bass, Mid and Treble, in
   * plain ink (ADR-544). Until then the pad was titled "Tone" across its
   * middle, in the amount's colour and as large as the pad allowed, over
   * the curve it names, and nothing said which third did what. The section
   * says Tone. Indices and ranges
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
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';

  const fx = useFxGridSlot('pedal');

  // The selected track's ink, as the slot's scheme hands it over (ADR-544).
  let pedalInk = $derived(fx.color);

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

<div class="pedal-layout" data-view="pedal">
  <FaceGrid sections={[1, 4]}>
    <FaceSection span={1}>
      {#snippet head()}<PanelEyebrow title="Type" color={pedalInk.primary} />{/snippet}
      <div class="pedal-type-buttons device-segmented seg-grid" style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
        {#each PEDAL_TYPE_OPTIONS as option}
          <button
            class="device-segment pedal-type w-full px-2 text-center"
            class:active={pedalType === option.value}
            use:press={{ onPress: () => fx.sendParam(PEDAL.type, option.value) }}
          >
            {option.label}
          </button>
        {/each}
      </div>
    </FaceSection>
    <FaceSeam ink={pedalInk.primary} />

    <FaceSection span={4}>
      {#snippet head()}<PanelEyebrow title="Tone" color={pedalInk.primary} />{/snippet}
      <div class="pedal-tone face-span-all" class:slot-ghost={fx.isGhost}>
        <ToneCurvePad
          title=""
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
        <!-- The pad's three thirds, named where a finger lands on them. -->
        <div class="tone-bands" aria-hidden="true">
          <span>Bass</span><span>Mid</span><span>Treble</span>
        </div>
      </div>
    </FaceSection>
  </FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510): five equal columns, Type, then
     Tone over four. */
  .pedal-layout {
    height: 100%;
    width: 100%;
  }

  .pedal-tone {
    position: relative;
    min-width: 0;
    min-height: 0;
  }

  /* The three bands' names along the pad's foot, a third each as the pad
     divides itself, never taking a touch. */
  .tone-bands {
    position: absolute;
    inset: auto 0 0 0;
    z-index: 30;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding: 0 0.25rem 0.625rem;
    pointer-events: none;
    font-size: 1rem;
    font-weight: var(--font-weight-medium);
    line-height: 1.15;
    color: var(--label);
    text-align: center;
  }

  /* Drive · Distort · Fuzz stacked, the column's height shared. */
  .pedal-type-buttons {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-height: 0;
  }

  .pedal-type {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    font-weight: var(--font-weight-medium);
  }
</style>
