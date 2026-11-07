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
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import DriftPages from './drift/DriftPages.svelte';
  import InstrumentBoard, { type BoardRow } from '../InstrumentBoard.svelte';
  import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
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
  // Each oscillator's own octave range, top first (pitch climbs as the eye
  // does): Osc 1 runs -2..+3, Osc 2 -3..+2 (Drift.md). Both showed Osc 1's
  // until 2026-11-06, so Osc 2's "+3" wrote nothing and -3 was unreachable.
  const OSC1_OCTAVES_UP = [3, 2, 1, 0, -1, -2] as const;
  const OSC2_OCTAVES_UP = [2, 1, 0, -1, -2, -3] as const;
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
   * Env 1 (the amp envelope) as four knobs, A D S R (user, 2026-11-06).
   * Env 2 is on the Envelopes page, which draws both.
   */
  const envTab = 1;
  const ENV_STAGES = [
    { stage: 'Attack', mark: 'A' },
    { stage: 'Decay', mark: 'D' },
    { stage: 'Sustain', mark: 'S' },
    { stage: 'Release', mark: 'R' }
  ] as const;

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
   * Drift's modulation sources, matrix targets and voice count: device
   * properties, not parameters (measured 2026-11-06; the surface allowlists
   * them). Subscribed only while a page that shows them is open, or the
   * full-screen board, which shows every page.
   */
  const PAGE_PROPERTIES = [
    'mod_matrix_pitch_source_1_index', 'mod_matrix_pitch_source_2_index', 'mod_matrix_shape_source_index',
    'mod_matrix_filter_source_1_index', 'mod_matrix_filter_source_2_index', 'mod_matrix_lfo_source_index',
    'mod_matrix_source_1_index', 'mod_matrix_source_2_index', 'mod_matrix_source_3_index',
    'mod_matrix_target_1_index', 'mod_matrix_target_2_index', 'mod_matrix_target_3_index',
    'voice_count_index'
  ] as const;
  $effect(() => {
    if (!devicePath || !centralDisplayStore.expanded) return;
    const path = devicePath;
    const offs = PAGE_PROPERTIES.map((name) => selectedTrackStore.subscribeProperty(path, name));
    return () => offs.forEach((off) => off?.());
  });
  function deviceProp(name: string): number | undefined {
    if (!devicePath) return undefined;
    const v = selectedTrackStore.propertyValue(devicePath, name);
    return typeof v === 'number' ? v : undefined;
  }
  function setDeviceProp(name: string, value: number) {
    if (devicePath) selectedTrackStore.setPropertyValue(devicePath, name, value);
  }

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

  /**
   * Full screen (ADR-512): every page at once, in Live's signal order. The
   * Oscillators page alone on the first row, taller, so its waveform and
   * octave picks keep their touch height; Filter beside the Envelopes; LFO /
   * Mod beside Global. The face's controls are all on these pages.
   */
  const BOARD: readonly BoardRow[] = [
    { tiles: [{ id: 'oscillators', cols: 10 }], weight: 1.25 },
    { tiles: [{ id: 'filter', cols: 6 }, { id: 'envelopes', cols: 9 }] },
    { tiles: [{ id: 'lfo-mod', cols: 7 }, { id: 'global', cols: 7 }] }
  ];

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
  {#if instrument && device && centralDisplayStore.expanded}
    <InstrumentBoard rows={BOARD} ink={driftInk.primary}>
      {#snippet tile(id)}
        <DriftPages
          page={id}
          params={panelParams}
          ink={driftInk}
          sourceInks={{ osc1: osc1Ink, osc2: osc2Ink, noise: noiseInk }}
          onBack={() => {}}
          {filterPad}
          {voiceModeTab}
          {waveGlyph}
          prop={deviceProp}
          setProp={setDeviceProp}
          board
        />
      {/snippet}
    </InstrumentBoard>
  {:else if instrument && device}
    <!--
      Signal-flow row: Sources (OSC 1 + OSC 2 + Noise) → Filter/Time → Voicing → voice mode.
      Each oscillator is one card reading top-to-bottom: pick a waveform, shape it
      on the pad, set its level — so the two cards are the same gesture twice.
      Mirrors AutoFilterCentralView's flex-[N] idiom for consistency across views.
    -->
    <InstrumentPanelView panel={DRIFT_PANEL} params={panelParams} color={driftInk} slots={{ filter: filterPad, voiceMode: voiceModeTab }}>
    {#snippet face(openPage: (page: string) => void)}
    <!-- One grid, ten columns (ADR-510, user 2026-11-06): Oscillators 4,
         Filter 1, Envelopes 1, LFO 2, Global 2, in Live's signal order.
         Every column, gutter and seam is the same, so the face reads on
         one beat. -->
    <FaceGrid sections={[4, 1, 1, 2, 2]}>
      <FaceSection span={4} style="--drift-ink: {oscInk.primary};">
        {#snippet head()}<PanelEyebrow title="Oscillators" color={driftInk.primary} />{/snippet}
          <!-- The three source levels, the grid's first column, left of the waveforms (user,
               2026-11-06): no names: 1, 2 and the noise glyph say which. -->
          <div class="osc-levels min-h-0 flex flex-col gap-(--spacing-sm)" data-osc={oscTab}>
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
            ghost={!oscOn}
            name="osc-wave"
          >
            {#snippet item(o)}{@render waveGlyph(o.label)}{/snippet}
          </ScrubTabs>

          <!-- Octaves stand +3 at the top, -2 at the foot: pitch climbs
               as the eye does. -->
          <ScrubTabs
            options={oscTab === 1 ? OSC1_OCTAVES_UP : OSC2_OCTAVES_UP}
            cols={1}
            selected={(oscTab === 1 ? OSC1_OCTAVES_UP : OSC2_OCTAVES_UP).findIndex((o) => o === oscOctave)}
            onSelect={(_, octave) => writeOsc(oscTab, oscTab === 1 ? 22 : 26, octave)}
            tint={oscInk.primary}
            inked
            label={(octave) => `OSC ${oscTab} octave ${octaveLabel(octave)}`}
            ghost={!oscOn}
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
      </FaceSection>
      <FaceSeam ink={driftInk.primary} />

      <!-- Filter: the low-pass pad left the face (the chain cell draws
           Drift's low-pass; the pad stays on the Filter page), so here it
           is the LP type, I over II, over a High-pass knob. -->
      <FaceSection span={1}>
        {#snippet head()}<PanelEyebrow title="Filter" color={driftInk.primary} />{/snippet}
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
              title="HP"
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
      </FaceSection>
      <FaceSeam ink={driftInk.primary} />

      <!-- Envelopes: A D S R of Env 1, the amp envelope. Env 2 and the
           cycling envelope are on the Envelopes page, which shows both. -->
      <FaceSection span={1}>
        {#snippet head()}<PanelEyebrow title="Envelopes" color={driftInk.primary} />{/snippet}
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
      </FaceSection>
      <FaceSeam ink={driftInk.primary} />

      <!-- LFO: rate slow to fast across, amount up. -->
      <FaceSection span={2}>
        {#snippet head()}<PanelEyebrow title="LFO / Mod" color={driftInk.primary} />{/snippet}
        <div class="lfo-pad face-span-2">
          <DeviceXY
            xValue={lfoX}
            yValue={lfoY}
            title="LFO"
            icon="lfo"
            onInteraction={writeLfo}
            color={driftInk}
          />
        </div>
      </FaceSection>
      <FaceSeam ink={driftInk.primary} />

      <!-- Global: the voice mode's own knob (absent in Poly), Glide in
           Mono, Drift, names beside; the voice mode itself is on the
           Global page. -->
      <FaceSection span={2}>
        {#snippet head()}<PanelEyebrow title="Global" color={driftInk.primary} />{/snippet}
        <div class="voicing-card face-span-all flex flex-col gap-(--spacing-sm)">
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
      </FaceSection>
    </FaceGrid>
    {/snippet}
    </InstrumentPanelView>
  {:else}
    <DeviceEmptyState glyph="~" message="Load Drift to access filter controls" color={driftInk.primary} />
  {/if}
</div>

<style>
  /* The face's layout is the FaceGrid (ADR-510): ten equal columns,
     Oscillators 4, Filter 1, Envelopes 1, LFO 2, Global 2. What is left
     here is how a column fills its height. */

  /* A stack of knobs shares its column's height evenly. */
  .mixer-slider,
  .voicing-slider {
    flex: 1 1 0;
    min-height: 0;
  }
  .wave-glyph {
    width: 100%;
    height: 100%;
    max-height: 22px;
  }

  /* ---- Live skin (flat grammar): the pads, sliders and tabs carry their
     own flat forks (the tabs are ScrubTabs, `inked` where the colour is the
     meaning: an oscillator's, or the view's on the filter type). */

</style>
