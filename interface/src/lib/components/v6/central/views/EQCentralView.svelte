<script lang="ts">
  import { press } from '$lib/actions/press';
  /**
   * EQCentralView — the Channel EQ's view (slot `eq`).
   *
   *   EQ [the response curve, a mark per band: L · M · H]  |  Global [Output / Low Cut]
   *
   * On the face grid (ADR-510), sections [5, 1]. The curve is a PICTURE,
   * not a control: it takes no touch and writes nothing. The gesture that
   * moves the three bands is the chain cell's tone pad, always beside this
   * view (`deviceControls.eq`), and a view does not repeat what its chain
   * cell's pad moves (ADR-510's addendum). The view's own controls are the
   * two the pad does not carry: the Output knob, at the picture's scale,
   * over the Low Cut switch.
   *
   * The picture is drawn as EQ Eight's is (`FilterDotsGraph`, inert here),
   * so the two EQs read as one family: the low shelf, the mid bell and the
   * high shelf in series, and the low cut while it is on, on a
   * 20 Hz - 20 kHz sweep with 0 dB on the middle line, over a frequency
   * and dB scale (`eq/GraphScale`) and, while Live is read, the spectrum
   * its chain cell shows (ADR-542). It reads the four parameters the chain
   * cell writes (2 Low, 3 Mid, 4 Mid Freq, 5 High, each 0..1 with 0.5
   * flat) and follows them as the pad moves; L, M and H mark where each
   * band stands.
   *
   * The curve is a sketch on Live's own spans (the shelves ±15 dB, the
   * bell ±12 dB over 120 Hz - 7.5 kHz, measured: `deviceControls.ts`); the
   * shelves' corner frequencies are not on the wire and are the tone pad's.
   *
   * Until ADR-544's rollout the view was the switch and the knob alone, a
   * switch the size of half the band (Ben: "one empty box and a knob in
   * the band where Wavetable fits thirty controls"). Ben's Adaptive Tone
   * Shaper's graph sat here from 2026-10-07 until the FX chain overview gave
   * every device a view of its own (2026-10-26); it is
   * `ToneShaperCentralView` now.
   *
   * NO {#if device} gate - always renders, handles its own state.
   * NO props required - queries selectedTrackStore directly.
   */

  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import FilterDotsGraph, { type GraphDot } from '$lib/components/v6/central/FilterDotsGraph.svelte';
  import GraphScale from './eq/GraphScale.svelte';
  import SpectrumFill from './panel/SpectrumFill.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { METERED_CLASSES } from '$lib/stores/v6/liveMeterStore.svelte';
  import { axisHz, axisX, responsePath } from '$lib/utils/filterGraph';
  import { FilterResponseCalculator, type FilterParameters } from '$lib/utils/filterResponseCalculator';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';

  const fx = useFxGridSlot('eq');

  const PARAM_CONFIG = {
    lowCut: 1,
    lowGain: 2,
    midGain: 3,
    midFreq: 4,
    highGain: 5,
    outputGain: 6
  };

  // What a ghost draws, before the first param echo lands: the chain cell's
  // own rest (`deviceControls.eq`), so the two pictures agree.
  const defaults = {
    lowCut: 0,
    lowGain: 0.5,
    midGain: 0.5,
    midFreq: 0.625,
    highGain: 0.5,
    outputGain: 0.5
  };

  let lowCutValue = $derived(fx.paramValue(PARAM_CONFIG.lowCut) ?? defaults.lowCut);
  let lowGain = $derived(fx.paramValue(PARAM_CONFIG.lowGain) ?? defaults.lowGain);
  let midGain = $derived(fx.paramValue(PARAM_CONFIG.midGain) ?? defaults.midGain);
  let midFreq = $derived(fx.paramValue(PARAM_CONFIG.midFreq) ?? defaults.midFreq);
  let highGain = $derived(fx.paramValue(PARAM_CONFIG.highGain) ?? defaults.highGain);
  let outputGainValue = $derived(fx.paramValue(PARAM_CONFIG.outputGain) ?? defaults.outputGain);

  let lowCutEnabled = $derived(lowCutValue >= 0.5);

  function toggleLowCut() {
    fx.sendParam(PARAM_CONFIG.lowCut, lowCutEnabled ? 0 : 1);
  }

  // ---- The curve ----
  /** The graph's sweep, Hz, and its dB from the middle line to an edge (`filterGraph`). */
  const AXIS = [20, 20000] as const;
  const GRAPH_DB = 24;
  /** Live's spans (measured, `deviceControls.ts`): the shelves' and the bell's gain, the bell's sweep. */
  const SHELF_DB = 15;
  const MID_DB = 12;
  const MID_HZ = [120, 7500] as const;
  /** The sketch's corners: the tone pad's shelves, Live's 80 Hz low cut. */
  const LOW_HZ = 120;
  const HIGH_HZ = 4500;
  const CUT_HZ = 80;
  /** Where the shelves' marks stand: out on each shelf's plateau, so a mark sits on its line. */
  const LOW_DOT_X = axisX(AXIS, 36);
  const HIGH_DOT_X = axisX(AXIS, 13000);

  /** A band's gain in dB from its 0..1 (0.5 flat), and its mark's height on the graph. */
  const gainDb = (v: number, span: number) => (v - 0.5) * 2 * span;
  const dotY = (v: number, span: number) => 0.5 + gainDb(v, span) / (2 * GRAPH_DB);
  const midHz = (f: number) => axisHz(MID_HZ, f);

  const calculator = new FilterResponseCalculator(44100);
  const FREQS = Array.from({ length: 121 }, (_, i) => axisHz(AXIS, i / 120));

  let curves = $derived.by(() => {
    const filters: FilterParameters[] = [
      { type: 'lowshelf', frequency: LOW_HZ, sampleRate: 44100, Q: 0.71, gain: gainDb(lowGain, SHELF_DB) },
      { type: 'peak', frequency: midHz(midFreq), sampleRate: 44100, Q: 0.5, gain: gainDb(midGain, MID_DB) },
      { type: 'highshelf', frequency: HIGH_HZ, sampleRate: 44100, Q: 0.5, gain: gainDb(highGain, SHELF_DB) }
    ];
    if (lowCutEnabled) filters.push({ type: 'highpass', frequency: CUT_HZ, sampleRate: 44100, Q: Math.SQRT1_2 });
    return [{ d: responsePath(calculator.calculateCombinedResponse(filters, FREQS).magnitude), color: fx.color.primary }];
  });

  let dots = $derived<GraphDot[]>([
    { label: 'L', x: LOW_DOT_X, y: dotY(lowGain, SHELF_DB), color: fx.color.primary, on: true, filled: false },
    { label: 'M', x: axisX(AXIS, midHz(midFreq)), y: dotY(midGain, MID_DB), color: fx.color.primary, on: true, filled: false },
    { label: 'H', x: HIGH_DOT_X, y: dotY(highGain, SHELF_DB), color: fx.color.primary, on: true, filled: false }
  ]);

  /** The spectrum Live draws behind its curve, as the chain cell shows it (ADR-542): only for a device there to read. */
  let spectrumPath = $derived(
    !fx.isGhost && fx.device && METERED_CLASSES.get(fx.device.className) === 'spectrum' ? fx.devicePath : undefined
  );

  /** The picture takes no touch: the graph's own gesture has nothing to write. */
  const still = () => {};
</script>

{#snippet spectrum()}<SpectrumFill devicePath={spectrumPath} ink={fx.color.primary} axis={AXIS} />{/snippet}

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="eq-layout" data-view="eq" class:slot-ghost={fx.isGhost}>
<!-- One face grid (ADR-510), six columns of ~157px at 1366 x 1024: the
     curve over five, the two global controls in the sixth. -->
<FaceGrid sections={[5, 1]}>
  <FaceSection span={5}>
  {#snippet head()}<PanelEyebrow title="EQ" color={fx.color.primary} />{/snippet}
  <!-- A picture: inert, so no finger and no key reaches the graph inside. -->
  <div class="eq-pad face-span-all" role="img" aria-label="Channel EQ response: low, mid and high" data-eq-picture>
    <div class="eq-picture" inert>
      <GraphScale axis={AXIS} span={GRAPH_DB} backdrop={spectrumPath ? spectrum : undefined}>
        <FilterDotsGraph {dots} {curves} onMove={still} ariaLabel="Channel EQ response" />
      </GraphScale>
    </div>
  </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
  {#snippet head()}<PanelEyebrow title="Global" color={fx.color.primary} />{/snippet}
  <!-- The knob over the switch, one column, as EQ Eight's Global is; the
       knob takes the largest size its cell holds. -->
  <div class="eq-column">
    <div class="eq-cell">
      <DeviceSlider
        value={outputGainValue}
        title="Output"
        face="knob"
        knobSize="xl"
        knobFit
        knobCaptionBelow
        icon="output"
        isGhost={fx.isGhost}
        color={fx.color}
        readout={fx.paramDisplay(PARAM_CONFIG.outputGain)}
        onInteraction={(val) => {
          fx.sendParam(PARAM_CONFIG.outputGain, val);
        }}
      />
    </div>
    <button
      use:press={{ onPress: () => toggleLowCut() }}
      class="physical-button btn-toggle eq-switch"
      class:active={lowCutEnabled}
      aria-pressed={lowCutEnabled}
    >
      Low Cut
    </button>
  </div>
  </FaceSection>
</FaceGrid>
</div>

<style>
  /* the curve's picture | output over low cut */
  .eq-layout {
    height: 100%;
    width: 100%;
    min-height: 0;
  }
  .eq-pad {
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  /* The curve is looked at, not touched: the gesture is the chain cell's. */
  .eq-picture {
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .eq-column {
    display: flex;
    flex-direction: column;
    gap: var(--face-gutter);
    min-width: 0;
    min-height: 0;
  }
  /* One touch row: the knob keeps the height. */
  .eq-switch {
    flex: 0 0 var(--height-touch);
    min-width: 0;
    min-height: var(--height-touch);
    font-size: 0.9375rem;
    font-weight: 600;
  }
  .eq-cell {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    display: flex;
  }
  .eq-cell > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }

  /* ---- Live skin (flat grammar): the switch's word is medium; ON and the
     label's colour are app.css's (ADR-544). The picture and the knob are
     FilterDotsGraph and DeviceSlider, flat already. */
  :global([data-grammar="flat"]) .eq-switch {
    font-weight: var(--font-weight-medium);
  }
</style>
