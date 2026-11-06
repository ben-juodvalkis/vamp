<script lang="ts">
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { SECTION_SWITCH_ON_ABOVE } from '$lib/services/drumVirtualMacros';
  import ScrubTabs from '../../device-panel/ScrubTabs.svelte';
  import FilterDotsGraph from '../FilterDotsGraph.svelte';
  import { axisHz, axisX, responseDb, responsePath, seriesDb } from '$lib/utils/filterGraph';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import { driftFilterCurve, FILTER_FREQ_RANGE } from '$lib/utils/instrumentFilterCurves';
  import InstrumentPanelView from './panel/InstrumentPanelView.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import { usePanelParams } from './panel/usePanelParams.svelte';
  import { DRIFT_PANEL } from './panel/driftPanel';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);
  let devicePath = $derived(device?.devicePath);

  /** The pages behind the face's eyebrows, every parameter by Live's name (ADR-487). */
  const panelParams = usePanelParams(() => device);

  const driftColor = {
    primary: '#06b6d4',
    secondary: 'rgba(6, 182, 212, 0.1)',
    accent: '#22d3ee'
  };

  // GRATICULE (§5.5): normalize the per-section palette through trackInk at injection.
  let trackScheme = $derived(selectedTrackScheme());
  let driftInk = $derived(trackScheme ?? {
    primary: trackInk(driftColor.primary, paintModeReactive()),
    secondary: driftColor.secondary,
    accent: trackInk(driftColor.accent, paintModeReactive())
  });

  /**
   * The three sound SOURCES are colour-coded (user's call, 2026-09-12):
   * OSC 1 orange, OSC 2 blue, Noise red. This is a deliberate exception
   * to ADR-402 — every other instrument view wears the focused track's
   * ink, and the rest of THIS view still does (Filter, Time, Voicing,
   * Drift). The sources are the one place a shared ink costs
   * something: with one oscillator card switched between two
   * oscillators, the colour is what says which one you are holding
   * without reading the tab, and Noise is a third source that used to be
   * indistinguishable from them.
   *
   * Orange and blue are the house `distortion` and `filter` family hexes,
   * so they land in the palette the rest of the app already uses. There
   * is no red family — `--act-rec` is the only house red and it means
   * RECORDING, which is exactly the wrong thing for a slider to say — so
   * Noise carries a literal, picked to sit in the same lightness and
   * chroma band as the two family colours. All three go through
   * `trackInk` at injection like every other palette here (§5.5).
   */
  const SOURCE_COLORS = {
    osc1: { primary: '#ff8244', secondary: 'rgba(255, 130, 68, 0.1)', accent: '#ff9e60' },
    osc2: { primary: '#12b2f4', secondary: 'rgba(18, 178, 244, 0.1)', accent: '#33cdff' },
    noise: { primary: '#ff5d5d', secondary: 'rgba(255, 93, 93, 0.1)', accent: '#ff7d7d' }
  } as const;

  function sourceInk(source: keyof typeof SOURCE_COLORS) {
    const raw = SOURCE_COLORS[source];
    const mode = paintModeReactive();
    return { primary: trackInk(raw.primary, mode), secondary: raw.secondary, accent: trackInk(raw.accent, mode) };
  }

  let osc1Ink = $derived(sourceInk('osc1'));
  let osc2Ink = $derived(sourceInk('osc2'));
  let noiseInk = $derived(sourceInk('noise'));

  /** Live's own value, a box's readout while it is dragged (ADR-477); sent only while the UI writes. */
  function display(index: number): string | undefined {
    if (!device || index < 0) return undefined;
    return selectedTrackStore.paramDisplay(selectedTrackStore.paramPath(device, index));
  }

  const OSC1_WAVE_OPTIONS: { value: number; label: string }[] = [
    { value: 0, label: 'Sin' },
    { value: 1, label: 'Tri' },
    { value: 2, label: 'Shark' },
    { value: 3, label: 'Bump' },
    { value: 4, label: 'Saw' },
    { value: 5, label: 'Pulse' },
    { value: 6, label: 'Sqr' }
  ];

  const OSC2_WAVE_OPTIONS: { value: number; label: string }[] = [
    { value: 0, label: 'Sin' },
    { value: 1, label: 'Tri' },
    { value: 2, label: 'Bump' },
    { value: 3, label: 'Saw' },
    { value: 4, label: 'Sqr' }
  ];

  /**
   * The waveform as a PICTURE, not a word (user's call, 2026-09-12, with
   * Live's own OSC 1 and OSC 2 selectors as the reference). "Shark" and
   * "Bump" are Drift's names for shapes nobody can picture from three
   * letters, and at this size the drawing is faster to read than the
   * abbreviation for the five that could be. Live's names stay the truth
   * about which is which, so they ride on `title` and in the accessible
   * name — available to a hover and a screen reader, off the glass. Same
   * move `SquashCentralView`'s stepped rows made with their legends.
   *
   * One viewBox, one stroke, and exactly ONE cycle each (user's call,
   * 2026-09-12) — at a button's size two periods halved the amplitude of
   * every feature that tells these shapes apart. Peak at y=2, floor at
   * y=10, midline 6, so the seven share a band and read as a set. Keyed
   * by the label, so a reordered options table carries its drawing with it.
   */
  const WAVE_GLYPHS: Record<string, string> = {
    // Sin and Tri are the bipolar pair and cross the midline; the rest
    // stand on the floor, which is also what separates Bump from Sin.
    Sin: 'M0 6 Q6 -1 12 6 T24 6',
    Tri: 'M0 6 L6 2 L18 10 L24 6',
    // Drift's shark tooth: a concave ramp that drops vertically — a fin.
    Shark: 'M0 10 C10 10 16 2 20 2 L20 10',
    Bump: 'M0 10 Q12 -2 24 10',
    Saw: 'M0 10 L20 2 L20 10',
    // A narrow duty cycle — the same square grammar, visibly off-centre.
    Pulse: 'M0 10 L0 2 L7 2 L7 10 L24 10',
    Sqr: 'M0 10 L0 2 L12 2 L12 10 L24 10'
  };

  /**
   * Drift's oscillator octave, −2..+3 (param 22 / 26). A segmented
   * control since 2026-09-12 (user's call): it is six discrete steps, and
   * riding the X axis of an XY pad meant the only way to reach +1 was to
   * aim at a fifth of a pad's width and hope — with Shape moving under
   * the same finger whether you wanted it to or not.
   */
  const OCTAVES = [-2, -1, 0, 1, 2, 3] as const;
  const OCTAVES_UP = [...OCTAVES].reverse();
  const octaveLabel = (octave: number) => (octave > 0 ? `+${octave}` : `${octave}`);

  // The octave strip and the waveform grid SCRUB (user, 2026-09-12: "can I
  // slide my finger to scrub octaves?"), through ScrubTabs. Which
  // oscillator they edit follows a touch on its level knob (the Osc 1/2
  // badge left 2026-11-06).

  // Display order is the mockup's — Mono then Poly on the top row. `value` is
  // the LOM `voice_mode_index` and travels with each entry, so reordering the
  // array moves the buttons and nothing else.
  const VOICE_MODE_OPTIONS: { value: number; label: string }[] = [
    { value: 1, label: 'Mono' },
    { value: 0, label: 'Poly' },
    { value: 2, label: 'Stereo' },
    { value: 3, label: 'Unison' }
  ];

  // Filter: Cutoff (1), Resonance (2)
  let cutoffValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 1)) ?? 1 : 1);
  let resonanceValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 2)) ?? 0 : 0);

  /**
   * LP Type (3): which of Drift's two low-pass models the filter runs.
   * Quantized 0..1, ships at I. The labels are Live's own `value_items`,
   * read off the running device with the index on 2026-09-14. A tap on the
   * step that is already lit sends nothing to Live.
   */
  const LP_TYPE = 3;
  const LP_TYPE_OPTIONS = [
    { value: 0, label: 'I' },
    { value: 1, label: 'II' }
  ] as const;
  let lpType = $derived(Math.round(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, LP_TYPE)) ?? 0 : 0));

  function writeLpType(value: number) {
    if (!device || value === lpType) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, LP_TYPE), value);
  }
  /**
   * The envelope shown as four knobs, A D S R (user, 2026-11-06), switched
   * between Env 1 and Env 2 by the tab beside the Envelopes eyebrow. View
   * state only, like the oscillator switch.
   */
  let envTab = $state<1 | 2>(1);
  const ENV_STAGES = [
    { stage: 'Attack', mark: 'A' },
    { stage: 'Decay', mark: 'D' },
    { stage: 'Sustain', mark: 'S' },
    { stage: 'Release', mark: 'R' }
  ] as const;
  const ENV_OPTIONS = [1, 2] as const;

  /**
   * The LFO pad (user, 2026-11-06): rate across, slow to fast, and LFO
   * Amount up. Drift's rate is a different parameter in each LFO Mode
   * (0 Freq, 1 Time, 2 Ratio, 3 Sync; docs/reference/instruments/Drift.md),
   * so the pad moves the one the mode uses. Freq, Ratio and Synced rise
   * with speed (Synced runs 8 bars at 0 to 1/64 at 21, whole steps); Time
   * is a period, so its axis is turned over.
   */
  const LFO_RATE_PARAMS = ['LFO Freq', 'LFO Time', 'LFO Ratio', 'LFO Synced'] as const;
  let lfoMode = $derived(Math.round(panelParams.raw('LFO Mode') ?? 0));
  let lfoRateParam = $derived(LFO_RATE_PARAMS[lfoMode] ?? 'LFO Freq');
  let lfoX = $derived.by(() => {
    const t = panelParams.unit(lfoRateParam) ?? 0.5;
    return lfoRateParam === 'LFO Time' ? 1 - t : t;
  });
  let lfoY = $derived(panelParams.unit('LFO Amount') ?? 0);
  function writeLfo(x: number, y: number) {
    const t = lfoRateParam === 'LFO Time' ? 1 - x : x;
    if (lfoRateParam === 'LFO Synced') {
      const r = panelParams.range('LFO Synced');
      if (r) panelParams.write('LFO Synced', Math.round(r.min + t * (r.max - r.min)));
    } else {
      panelParams.writeUnit(lfoRateParam, t);
    }
    panelParams.writeUnit('LFO Amount', y);
  }
  // Global Drift (60)
  let driftValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 60)) ?? 0.5 : 0.5);
  // Osc on/off: 31 / 32 (`Mixer_OscillatorOn1` / `...On2`). Both ship TRUE, so
  // unlike Wavetable's Osc 2 the ghost is the unusual state here — it shows a
  // source the player switched off in Live, which is otherwise invisible from
  // this view.
  let osc1On = $derived((device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 31)) ?? 1 : 1) >= 0.5);
  let osc2On = $derived((device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 32)) ?? 1 : 1) >= 0.5);

  /**
   * Touching a switched-off oscillator switches it on, the same bargain
   * WavetableCentralView strikes for its Osc 2: reaching for a source IS the
   * request to hear it, and a card whose controls move a silent oscillator is
   * a set of dead controls. Applies to all three of its controls — waveform,
   * pad and gain — because any of them is a statement of intent about the
   * sound. Ghost dim is on the card, so the pad stays draggable through it.
   */
  function ensureOscOn(n: 1 | 2) {
    if (!device) return;
    if (n === 1 ? osc1On : osc2On) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, n === 1 ? 31 : 32), 1);
  }

  // Osc 1: Wave (20), Shape (21), Octave (22), Gain (29)
  let osc1Wave = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 20)) ?? 0 : 0);
  let osc1Shape = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 21)) ?? 0.5 : 0.5);
  let osc1Octave = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 22)) ?? 0 : 0);
  let osc1Gain = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 29)) ?? 1 : 1);
  // Osc 2: Wave (24), Shape (25), Octave (26), Gain (30)
  let osc2Wave = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 24)) ?? 0 : 0);
  let osc2Shape = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 25)) ?? 0.5 : 0.5);
  let osc2Octave = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 26)) ?? 0 : 0);
  let osc2Gain = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 30)) ?? 1 : 1);
  // Noise: Level (33), On (34). Both measured off Defaults/Instruments/Drift.adv
  // — `Mixer_NoiseLevel` rides a 0..1.995 rail and `Mixer_NoiseOn` is a bool
  // that ships true, so a patch with the level at zero is silent-but-armed.
  // The switch has no control of its own since 2026-09-12: the level writes
  // it, from a finger only. `noiseOn` is now read for ONE purpose — greying
  // the slider — so the view still shows a patch that saved the switch off
  // with its level up, rather than quietly re-arming it. See the markup.
  let noiseGain = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 33)) ?? 0 : 0);
  let noiseOn = $derived((device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 34)) ?? 1 : 1) >= 0.5);
  // The VOICING slider is one control with four identities — it follows
  // `voice_mode_index`, because each voice mode has exactly one parameter
  // worth a fader and no mode has two. Confirmed against the device by
  // the user, 2026-09-12:
  //
  //     Mono (1)   → "Thick"     param 59
  //     Stereo (2) → "Spread"    param 57
  //     Unison (3) → "Strength"  param 58
  //     Poly (0)   → nothing — the slider is not drawn
  //
  // Poly hides it (user, 2026-09-28): a ghost that wrote nothing cost the
  // default mode a slider's width, which the Time and Filter pads needed.
  let stereoSpread = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 57)) ?? 0.5 : 0.5);
  let unisonStrength = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 58)) ?? 0.5 : 0.5);
  let monoThickness = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 59)) ?? 0.5 : 0.5);

  /**
   * Glide (63) — MONO ONLY (user, 2026-09-12). Drift's glide is a
   * monophonic idea: there is one voice to slide from the last note, so
   * the parameter is meaningless in Poly, Stereo and Unison and the
   * slider is simply absent there rather than ghosted.
   *
   * Read and written through the parameter's OWN range, unlike the raw
   * 0..1 pass-through the rest of this view uses. Glide is a TIME and its
   * rail has not been measured here; the same mistake on Wavetable's
   * envelope meant a 0..1 control could only ever reach the first second
   * of a twenty-second rail. `paramRange` is Live's own answer, so this
   * is right whatever the rail is, and identical to raw if it is 0..1.
   */
  const GLIDE = 63;

  let glideValue = $derived.by(() => {
    if (!device) return 0;
    const path = selectedTrackStore.paramPath(device, GLIDE);
    const raw = selectedTrackStore.paramValueArmed(path);
    if (raw === undefined) return 0;
    const range = selectedTrackStore.paramRange(path);
    if (!range || range.max <= range.min) return Math.max(0, Math.min(1, raw));
    return Math.max(0, Math.min(1, (raw - range.min) / (range.max - range.min)));
  });

  function writeGlide(value: number) {
    if (!device) return;
    const path = selectedTrackStore.paramPath(device, GLIDE);
    const range = selectedTrackStore.paramRange(path);
    selectedTrackStore.setParamValue(
      path,
      range && range.max > range.min ? range.min + value * (range.max - range.min) : value
    );
  }

  let voiceMode = $derived<number>((devicePath ? selectedTrackStore.propertyValue(devicePath, 'voice_mode_index') as number | undefined : undefined) ?? 0);

  $effect(() => {
    if (!devicePath) return;
    return selectedTrackStore.subscribeProperty(devicePath, 'voice_mode_index');
  });

  /**
   * The filter pad carries both of Drift's filters (user, 2026-11-05), as
   * Wavetable's does: the low-pass dot with cutoff across and resonance up,
   * and the high-pass dot, which has no resonance, halfway up (the 0 dB
   * line), sliding across only. One curve, the two in series. The chain
   * cell keeps the low-pass alone (InstrumentFace).
   *
   * The pad's axis is LP Freq's own sweep, so the LP dot's X is its 0..1.
   * HP Freq runs 10 Hz..20.5 kHz on a log sweep (Live's labels, device
   * dump: 0.5 reads 453 Hz), so its dot is placed by Hz on the same axis;
   * below 20 Hz it rests at the left edge.
   */
  const HP_FREQ = 4;
  const HP_RANGE = [10, 20500] as const;
  const DRIFT_AXIS = FILTER_FREQ_RANGE.drift;
  const HP_DOT_Y = 0.5;
  let hpValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, HP_FREQ)) ?? 0 : 0);
  const hpHz = (t: number) => HP_RANGE[0] * Math.pow(HP_RANGE[1] / HP_RANGE[0], t);
  const hpParam = (hz: number) => Math.min(1, Math.max(0, Math.log(hz / HP_RANGE[0]) / Math.log(HP_RANGE[1] / HP_RANGE[0])));
  /** The dot the LP Type row beside the pad belongs with: LP until HP is touched. */
  let filterDot = $state<0 | 1>(0);
  let filterDots = $derived([
    { label: 'LP', x: cutoffValue, y: resonanceValue, color: driftInk.primary, on: true, filled: filterDot === 0 },
    { label: 'HP', x: axisX(DRIFT_AXIS, hpHz(hpValue)), y: HP_DOT_Y, color: driftInk.primary, on: true, filled: filterDot === 1 }
  ]);
  let filterCurve = $derived(
    responsePath(
      seriesDb([
        responseDb(DRIFT_AXIS, { hz: axisHz(DRIFT_AXIS, cutoffValue), res: resonanceValue, curve: driftFilterCurve(lpType) }),
        responseDb(DRIFT_AXIS, { hz: hpHz(hpValue), res: 0, curve: { curveType: 'highpass', order: 1 } })
      ])
    )
  );

  function moveFilterDot(i: number, x: number, y: number) {
    if (!device) return;
    if (i === 0) {
      selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 1), x);
      selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 2), y);
    } else {
      selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, HP_FREQ), hpParam(axisHz(DRIFT_AXIS, x)));
    }
  }

  /**
   * Which oscillator the card is showing (2026-09-12). View state only —
   * it never touches Drift, and it deliberately does NOT follow which
   * oscillator is switched on: a tab that moved itself would take the
   * card away mid-edit the moment a patch loaded.
   *
   * It DOES follow a finger (user, 2026-09-16): touching Osc 1 or Osc 2 in
   * the level mixer brings that oscillator's card up. The distinction that
   * keeps the paragraph above true —
   * a hand reaching for a source is a statement about which one you are
   * working on, where a patch load is not. It costs nothing to be wrong
   * about, since the card is the only thing that moves, and it saves the
   * two-step of balancing the levels and then picking the oscillator again
   * to shape the one you were just holding. Since 2026-11-06 the level
   * knobs are the only way to switch.
   */
  let oscTab = $state<1 | 2>(1);

  let oscOn = $derived(oscTab === 1 ? osc1On : osc2On);
  let oscWave = $derived(oscTab === 1 ? osc1Wave : osc2Wave);
  let oscShape = $derived(oscTab === 1 ? osc1Shape : osc2Shape);
  let oscOctave = $derived(oscTab === 1 ? osc1Octave : osc2Octave);
  let oscWaveOptions = $derived(oscTab === 1 ? OSC1_WAVE_OPTIONS : OSC2_WAVE_OPTIONS);
  /** The card takes the colour of the oscillator it is showing. */
  let oscInk = $derived(oscTab === 1 ? osc1Ink : osc2Ink);

  /** Every oscillator write turns its oscillator on first — reaching for a control IS the request to hear it. */
  function writeOsc(osc: 1 | 2, param: number, value: number) {
    if (!device) return;
    ensureOscOn(osc);
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, param), value);
  }

  // Voicing-mode contextual slider — not drawn in Poly.
  let voicingSliderValue = $derived(
    voiceMode === 1 ? monoThickness :
    voiceMode === 2 ? stereoSpread :
    voiceMode === 3 ? unisonStrength :
    0.5
  );
  let voicingSliderTitle = $derived(
    voiceMode === 1 ? 'Thick' :
    voiceMode === 2 ? 'Spread' :
    voiceMode === 3 ? 'Strength' :
    'Voicing'
  );
  let voicingSliderParam = $derived(
    voiceMode === 1 ? 59 :
    voiceMode === 2 ? 57 :
    voiceMode === 3 ? 58 :
    -1
  );
</script>

<!-- The waveform drawing. `currentColor`, so it takes the button's own
     ink in every state — including the inverse a lit segment needs — and
     `aria-hidden`, because the button already carries Live's name. -->
<!-- The face's filter pad, again beside the Filter page's knobs (ADR-509). -->
{#snippet filterPad()}
  <div class="min-h-0 min-w-0 h-full w-full">
    <FilterDotsGraph
      dots={filterDots}
      curves={[{ d: filterCurve, color: driftInk.primary }]}
      ariaLabel="Filter: low-pass {Math.round(cutoffValue * 100)}%, high-pass {Math.round(hpValue * 100)}%"
      onGrab={(i) => (filterDot = i === 0 ? 0 : 1)}
      onMove={moveFilterDot}
    />
  </div>
{/snippet}

{#snippet voiceModeTab()}
  <!-- Poly / Mono / Stereo / Unison, on the Global page: one pick-one tab,
       two by two. -->
  <ScrubTabs
    options={VOICE_MODE_OPTIONS}
    selected={VOICE_MODE_OPTIONS.findIndex((o) => o.value === voiceMode)}
    onSelect={(_, o) => {
      if (devicePath) selectedTrackStore.setPropertyValue(devicePath, 'voice_mode_index', o.value);
    }}
    cols={2}
    tint={driftInk.primary}
    label={(o) => o.label}
    class="h-full"
    style="--scrub-font-size: 0.8125rem; --scrub-font-weight: 500; --scrub-padding: 0 0.25rem;"
  />
{/snippet}

{#snippet waveGlyph(label: string)}
  <svg class="wave-glyph" viewBox="0 0 24 12" aria-hidden="true" focusable="false">
    <path
      d={WAVE_GLYPHS[label] ?? ''}
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
{/snippet}

<div class="drift-root h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <!--
      Signal-flow row: Sources (OSC 1 + OSC 2 + Noise) → Filter/Time → Voicing → voice mode.
      Each oscillator is one card reading top-to-bottom: pick a waveform, shape it
      on the pad, set its level — so the two cards are the same gesture twice.
      Mirrors AutoFilterCentralView's flex-[N] idiom for consistency across views.
    -->
    <InstrumentPanelView panel={DRIFT_PANEL} params={panelParams} color={driftInk} slots={{ filter: filterPad, voiceMode: voiceModeTab }}>
    {#snippet face(openPage: (page: string) => void)}
    <div class="h-full w-full flex min-h-0 p-(--central-inset)" style="gap: var(--central-gap);">

      <!-- ONE oscillator card, switched between OSC 1 and OSC 2 (user's
           call, 2026-09-12). The two used to sit side by side, which spent
           half the section's width on the oscillator you were not editing
           and left every control in it half as wide as it wanted to be.
           One at a time, its controls read across and stack down the
           card: the waveform grid, the octave strip, Shape, Gain.

           The switch is a view state, not a device parameter — it changes
           what you are looking at, never what Drift is doing. Which
           oscillators are actually SOUNDING is a different question, and
           the tab says so on its own: an oscillator that is switched off
           reads dim, whether or not it is the one on screen. -->
      <div class="drift-card osc-card flex-[2] min-h-0 flex flex-col gap-(--central-gap)"
           style="--drift-ink: {oscInk.primary};">
        <!-- No hosted swap pill (user, 2026-11-06): the view keeps
             CentralDisplay's upright column on its left edge. -->
        <PanelEyebrow title="Oscillators" page="oscillators" onOpen={openPage} color={driftInk.primary} />
        <!-- Everything reads across, stacked down the card (user's call,
             2026-09-12): the waveform grid two rows deep, then the octave
             as one segmented strip, then Shape and Gain as horizontal
             faders. The card is wider than it was and the Time/Filter
             column narrower to pay for it.

             Since 2026-11-06 the waveforms and octaves stand as columns,
             one tab each, and the Osc 1/2 badge is gone. -->
        <div
          class="osc-body flex-1 min-h-0"
          data-osc={oscTab}
          class:osc-ghost={!oscOn}
        >
          <!-- The three source levels, the grid's first column, left of the waveforms (user,
               2026-11-06): no names: 1, 2 and the noise glyph say which. -->
          <div class="osc-levels min-h-0 flex flex-col gap-(--spacing-sm)">
            <!-- Touching either oscillator's level brings ITS card up on the
                 left (`onDown`, so the switch lands on the touch rather than
                 on the first frame a finger has moved). The card is what says
                 which oscillator that colour belongs to, and reaching for one
                 of these is already a choice of oscillator. -->
            <div class="mixer-slider min-h-0">
              <DeviceSlider
                value={osc1Gain}
                title="Osc 1"
                face="knob"
                knobCaption={false}
                knobMark="1"
                icon="oscillator"
                orientation="vertical"
                labelSize="small"
                isGhost={!osc1On}
                color={osc1Ink}
                readout={display(29)}
                onDown={() => (oscTab = 1)}
                onInteraction={(value) => writeOsc(1, 29, value)}
              />
            </div>
            <div class="mixer-slider min-h-0">
              <DeviceSlider
                value={osc2Gain}
                title="Osc 2"
                face="knob"
                knobCaption={false}
                knobMark="2"
                icon="oscillator"
                orientation="vertical"
                labelSize="small"
                isGhost={!osc2On}
                color={osc2Ink}
                readout={display(30)}
                onDown={() => (oscTab = 2)}
                onInteraction={(value) => writeOsc(2, 30, value)}
              />
            </div>
            <div class="mixer-slider min-h-0">
              <DeviceSlider
                value={noiseGain}
                title="Noise"
                face="knob"
                knobCaption={false}
                icon="noise"
                orientation="vertical"
                labelSize="small"
                isGhost={!noiseOn}
                color={noiseInk}
                readout={display(33)}
                onInteraction={(value) => {
                  if (!device) return;
                  selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 33), value);
                  const on = value > SECTION_SWITCH_ON_ABOVE;
                  if (on !== noiseOn) {
                    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 34), on ? 1 : 0);
                  }
                }}
              />
            </div>
          </div>

          <!-- The waveform tab spans the body's first two rows: the scrub
               surface is the waveforms, not the whole card. -->
          <ScrubTabs
            options={oscWaveOptions}
            selected={oscWaveOptions.findIndex((o) => o.value === oscWave)}
            onSelect={(_, o) => writeOsc(oscTab, oscTab === 1 ? 20 : 24, o.value)}
            cols={1}
            tint={oscInk.primary}
            inked
            label={(o) => `OSC ${oscTab} wave ${o.label}`}
            name="osc-wave"
          >
            {#snippet item(o)}{@render waveGlyph(o.label)}{/snippet}
          </ScrubTabs>

          <!-- Octaves stand +3 at the top, -2 at the foot: pitch climbs
               as the eye does. -->
          <ScrubTabs
            options={OCTAVES_UP}
            cols={1}
            selected={OCTAVES_UP.findIndex((o) => o === oscOctave)}
            onSelect={(_, octave) => writeOsc(oscTab, oscTab === 1 ? 22 : 26, octave)}
            tint={oscInk.primary}
            inked
            label={(octave) => `OSC ${oscTab} octave ${octaveLabel(octave)}`}
          >
            {#snippet item(octave)}{octaveLabel(octave)}{/snippet}
          </ScrubTabs>

          <div class="osc-fader">
            <DeviceSlider
              value={oscShape}
              title="Shape"
              icon="shape"
              orientation="vertical"
              labelSize="small"
              isGhost={!oscOn}
              color={oscInk}
              onInteraction={(value) => writeOsc(oscTab, oscTab === 1 ? 21 : 25, value)}
            />
          </div>



        </div>
      </div>

      <!-- THE LEVEL MIXER (user's call, 2026-09-12): all three sources'
           levels side by side, in their own colours. It replaces the
           Noise card, which was a mixer channel standing on its own while
           the two oscillator levels hid inside the OSC card — so
           balancing the three meant switching oscillator tabs and
           remembering. Orange, blue, red in one place is the whole point
           of colour-coding the sources.

           NOISE'S SWITCH IS ITS LEVEL (user's call, same day): "if I want
           to hear it I turn the slider up, if I don't I turn it down."
           The level writes `Mixer_NoiseOn` with itself — above a MIDI
           step of travel on, at the floor off — the rule the Sampler
           row's Osc section already follows, so one control says both
           things. Written ONLY from a finger: deriving the switch from
           the level would turn noise on when a preset loads with the
           switch off and the level parked above zero, which is a patch
           Drift ships and a sound nobody asked for. Hence no `$effect`
           and no reactive coupling — a loaded patch is left exactly as
           saved, reading grey until a finger moves it.

           The two oscillator levels do NOT switch their oscillator off at
           the floor, only on when touched (`ensureOscOn`). That asymmetry
           is deliberate until asked otherwise: an oscillator at zero is
           the ordinary way to park one, and silently switching it off
           would change what a preset saves. -->
      <!-- No seam between the oscillator card and the mixer (user,
           2026-09-28): they are one sources group, which the source
           colours already say, and the seam's width went to the pads. -->
      <!-- Stacked, one column of three boxes (ADR-477): still the three
           sources in one place, and two columns' width went to the pads. -->

      <SectionDivider orientation="vertical" ink={driftInk.primary} />

      <!-- Envelope knobs | LFO pad | Filter (user, 2026-11-06). The Time
           pad gave way to the envelope's four stages and an LFO pad. The
           low-pass pad left the face: the chain cell already draws Drift's
           low-pass, so Filter here is its type, I over II, over a
           High-pass knob; the pad itself stays on the Filter page. -->
      <div class="flex-[3] min-h-0 time-filter-grid">
        <!-- The Envelopes eyebrow carries the Env 1 | 2 switch beside it
             (user, 2026-11-06); the tab hangs into the gaps around the
             eyebrow's line, so the knobs start on the other columns' pixel. -->
        <div class="env-head">
          <PanelEyebrow title="Envelopes" page="envelopes" onOpen={openPage} color={driftInk.primary} />
          <ScrubTabs
            options={ENV_OPTIONS}
            selected={envTab - 1}
            onSelect={(_, n) => (envTab = n)}
            tint={driftInk.primary}
            label={(n) => `Envelope ${n}`}
            class="env-tab"
            style="--scrub-font-size: 0.75rem;"
          >
            {#snippet item(n)}{n}{/snippet}
          </ScrubTabs>
          <span class="lfo-eyebrow"><PanelEyebrow title="LFO / Mod" page="lfo-mod" onOpen={openPage} color={driftInk.primary} /></span>
        </div>
        <span class="filter-eyebrow"><PanelEyebrow title="Filter" page="filter" onOpen={openPage} color={driftInk.primary} /></span>
        <!-- A D S R of the shown envelope: four small knobs in a column,
             their letter inside, no caption. -->
        <div class="env-col min-h-0 flex flex-col gap-(--spacing-sm)">
          {#each ENV_STAGES as { stage, mark } (stage)}
            {@const name = `Env ${envTab} ${stage}`}
            <div class="flex-1 min-h-0">
              <DeviceSlider
                value={panelParams.unit(name) ?? 0}
                title="Env {envTab} {stage}"
                face="knob"
                knobSize="s"
                knobCaption={false}
                knobMark={mark}
                orientation="vertical"
                labelSize="small"
                color={driftInk}
                readout={panelParams.display(name)}
                onInteraction={(v) => panelParams.writeUnit(name, v)}
              />
            </div>
          {/each}
        </div>
        <span class="seam-env"><SectionDivider orientation="vertical" ink={driftInk.primary} /></span>
        <div class="lfo-pad min-h-0 min-w-0">
          <DeviceXY
            xValue={lfoX}
            yValue={lfoY}
            title="LFO"
            icon="lfo"
            onInteraction={writeLfo}
            color={driftInk}
          />
        </div>
        <span class="seam-filter"><SectionDivider orientation="vertical" ink={driftInk.primary} /></span>
        <div class="filter-col min-h-0 min-w-0 flex flex-col gap-(--central-gap)">
          <ScrubTabs
            options={LP_TYPE_OPTIONS}
            selected={LP_TYPE_OPTIONS.findIndex((o) => o.value === lpType)}
            onSelect={(_, o) => writeLpType(o.value)}
            tint={driftInk.primary}
            inked
            label={(o) => `Filter type ${o.label}`}
            cols={1}
            style="height: calc(2 * var(--height-touch)); flex: none;"
          >
            {#snippet item(o)}{o.label}{/snippet}
          </ScrubTabs>
          <div class="flex-1 min-h-0">
            <DeviceSlider
              value={hpValue}
              title="High-pass"
              face="knob"
              knobSize="m"
              icon="highpass"
              orientation="vertical"
              labelSize="small"
              color={driftInk}
              readout={display(HP_FREQ)}
              onInteraction={(value) => {
                if (!device) return;
                selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, HP_FREQ), value);
              }}
            />
          </div>
        </div>
      </div>

      <SectionDivider orientation="vertical" ink={driftInk.primary} />

      <!-- Voicing group: the mode's own parameter, Glide in Mono, and
           Drift. The 2x2 mode grid that used to sit on top has its own
           column (user, 2026-09-12) — it chooses what the card MEANS
           rather than being one of its controls. -->
      <div class="drift-card voicing-card flex-none min-h-0 flex flex-col gap-(--central-gap)" style="--drift-ink: {driftInk.primary};">
        <!-- Global's door sits over the voicing column; the voice mode
             itself lives on the Global page (user, 2026-11-06). -->
        <PanelEyebrow title="Global" page="global" onOpen={openPage} color={driftInk.primary} />
        <!-- The mode's own knob, absent in Poly (it has nothing to write
             there), Glide, then Drift: knobs stacked in one column
             (ADR-509), so a mode change moves no edge. -->
        <div class="flex-1 min-h-0 flex flex-col gap-(--spacing-sm)">
          {#if voiceMode !== 0}
          <div class="voicing-slider min-h-0">
            <DeviceSlider
              value={voicingSliderValue}
              title={voicingSliderTitle}
              face="knob"
              icon="unison"
              orientation="vertical"
              labelSize="small"
              isGhost={voiceMode === 0}
              color={driftInk}
              readout={display(voicingSliderParam)}
              onInteraction={(value) => {
                if (!device || voicingSliderParam < 0) return;
                selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, voicingSliderParam), value);
              }}
            />
          </div>
          {/if}
          <!-- Glide sits beside the mode's own parameter because it is
               another property of the voice, and it is drawn only in
               Mono. -->
          {#if voiceMode === 1}
            <div class="voicing-slider min-h-0">
              <DeviceSlider
                value={glideValue}
                title="Glide"
                face="knob"
                icon="glide"
                orientation="vertical"
                labelSize="small"
                color={driftInk}
                readout={display(GLIDE)}
                onInteraction={writeGlide}
              />
            </div>
          {/if}
          <div class="voicing-slider min-h-0">
            <DeviceSlider
              value={driftValue}
              title="Drift"
              face="knob"
              icon="drift"
              orientation="vertical"
              labelSize="small"
              color={driftInk}
              readout={display(60)}
              onInteraction={(value) => {
                if (!device) return;
                selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 60), value);
              }}
            />
          </div>
        </div>
      </div>

    </div>
    {/snippet}
    </InstrumentPanelView>
  {:else}
    <DeviceEmptyState glyph="~" message="Load Drift to access filter controls" color={driftInk.primary} />
  {/if}
</div>

<style>
  /* ---- ONE slider width for the whole view (2026-09-12). Nothing here
     used to declare one: every vertical slider was whatever its card's
     flex share happened to divide into, which gave four different
     thicknesses in one view — the OSC card's Shape and Gain at ~144px
     (a quarter of the widest card), Noise's Lvl at 48 (a 64px card less
     its padding) and the Voicing pair at ~88 each. The OSC pair was the
     one that read wrong, because a 144px-wide fill is a block of colour
     rather than a level.

     56px is the house figure — `--vm-slider-w`, what the Drum Rack view
     gives a vertical slider. A slider is pinned to it and the things
     that genuinely want width (the wave and octave choosers) take what
     is left. */
  .drift-root {
    --drift-slider-w: 56px;
    /* One knob column. The level column and the voicing column are both
       this wide, so their knobs are twins (user, 2026-11-06); in the rig's
       ~327px band a knob's slot is short and wide, so its name sits beside
       it. */
    --drift-knob-col: 8rem;
  }

  /* The body is ONE grid of four equal rows with one uniform gap — two
     rows of waveforms, the octave strip, then Shape (user: "can each row
     height be equal"). Nesting the waveform grid inside a flex column
     could not do it: its own internal row gap came out of its share, so
     a waveform row landed exactly one gap shorter than the octave strip
     beside it. As direct children of one grid they are all 1fr. */
  /* Upright columns (user, 2026-11-06): the three source levels first,
     knobs with no names, then the waveforms, the octaves and Shape as a
     slider: four equal columns. A switched-off
     oscillator dims its own three columns; the levels keep theirs. */
  .osc-ghost > :not(.osc-levels) {
    opacity: var(--opacity-ghost);
  }
  .osc-body {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    grid-template-rows: minmax(0, 1fr);
    gap: var(--spacing-sm);
  }
  /* The level mixer and the voicing group are value boxes stacked in a
     column at the view's slider width (ADR-477), sharing its height. The
     explicit card widths are for WebKit, which sized a content-wide card
     from its sliders and spilled them past the row without one. */
  .mixer-slider,
  .voicing-slider {
    flex: 1 1 0;
    min-height: 0;
  }
  /* The voicing knobs: one knob column, the level column's twin. */
  /* Wide enough that a medium knob with its name beside it is 70px. */
  .voicing-card {
    width: 9rem;
  }
  /* Four equal columns, each wide enough for a 70px level knob. */
  .osc-card {
    min-width: calc(4 * 5.5rem + 3 * var(--spacing-sm));
  }
  .wave-glyph {
    width: 100%;
    height: 100%;
    max-height: 22px;
  }

  /* ---- Live skin (flat grammar): the pads, sliders and tabs carry their
     own flat forks (the tabs are ScrubTabs, `inked` where the colour is the
     meaning: an oscillator's, or the view's on the filter type). */

  /* Envelope knobs | LFO pad | Filter, seamed (user, 2026-11-06): the
     pad takes the width. Every cell is placed, since the header spans
     the envelope column, its seam and the pad. */
  .time-filter-grid {
    display: grid;
    grid-template-columns: 4rem auto minmax(0, 1fr) auto 5.5rem;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--central-gap);
  }
  /* One header across the envelope knobs and the LFO pad: the Envelopes
     eyebrow and its tab are wider than the knob column. */
  .env-head {
    grid-column: 1 / 4;
    grid-row: 1;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--spacing-sm);
    height: 1rem;
    min-width: 0;
    overflow: visible;
    white-space: nowrap;
  }
  .filter-eyebrow {
    grid-column: 5;
    grid-row: 1;
    display: flex;
    justify-content: center;
    min-width: 0;
  }
  .env-col { grid-column: 1; grid-row: 2; }
  .seam-env { grid-column: 2; grid-row: 2; display: flex; }
  .lfo-pad { grid-column: 3; grid-row: 2; }
  .seam-filter { grid-column: 4; grid-row: 2; display: flex; }
  .filter-col { grid-column: 5; grid-row: 2; }
  .lfo-eyebrow {
    flex: 1 1 auto;
    display: flex;
    justify-content: center;
    min-width: 0;
  }
  .env-head :global(.env-tab) {
    flex: 0 0 auto;
    width: 4rem;
    height: 1.75rem;
  }
</style>
