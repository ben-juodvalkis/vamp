<script lang="ts">
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import MidiWheel from '../../midi/MidiWheel.svelte';
  import { sendPitchWheel, sendModWheel } from '$lib/api/midiWheels';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { PITCH_COLOR, MOD_COLOR } from '$lib/config/devicePresets';
  import { SECTION_SWITCH_ON_ABOVE } from '$lib/services/drumVirtualMacros';
  import { drag } from '$lib/actions';
  import type { DragInfo } from '$lib/actions/drag';
  import { segmentIndex, gridCellIndex, scrubBoxOf, type ScrubBox } from '$lib/utils/segmentScrub';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);
  let devicePath = $derived(device?.devicePath);

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
   * Drift, the wheels). The sources are the one place a shared ink costs
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

  let pitchInk = $derived(trackScheme ?? {
    primary: trackInk(PITCH_COLOR.primary, paintModeReactive()),
    secondary: PITCH_COLOR.secondary,
    accent: trackInk(PITCH_COLOR.accent, paintModeReactive())
  });
  let modInk = $derived(trackScheme ?? {
    primary: trackInk(MOD_COLOR.primary, paintModeReactive()),
    secondary: MOD_COLOR.secondary,
    accent: trackInk(MOD_COLOR.accent, paintModeReactive())
  });

  function handlePitchChange(value: number) {
    sendPitchWheel(value);
  }

  function handleModChange(value: number) {
    sendModWheel(value);
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
  const octaveLabel = (octave: number) => (octave > 0 ? `+${octave}` : `${octave}`);

  /**
   * The octave strip SCRUBS (user, 2026-09-12: "can I slide my finger to
   * scrub octaves?"). The strip owns the gesture through `use:drag`
   * (ADR-427) and resolves which step the finger is over from geometry,
   * the way the session grid's slot zone does — so the step you land on
   * follows the finger across the whole strip instead of needing six
   * separate taps, and the hairlines between steps are part of a step
   * rather than dead bands between buttons.
   *
   * The steps stay real `<button>`s for the keyboard and the accessible
   * name, with `pointer-events: none` so they never compete with the
   * strip for the pointer; Enter still activates one.
   *
   * The box is measured once at press time and reused for the gesture —
   * re-measuring mid-drag reads a box a re-render may have moved.
   */
  let octaveStrip = $state<HTMLElement | null>(null);
  let octaveBox: ScrubBox | null = null;

  function octaveAt(clientX: number) {
    if (!octaveBox) return;
    const next = OCTAVES[segmentIndex(clientX, octaveBox.left, octaveBox.width, OCTAVES.length)];
    // A scrub crosses many frames inside one step; only edges reach Live.
    if (next === oscOctave) return;
    writeOsc(oscTab, oscTab === 1 ? 22 : 26, next);
  }

  function octaveScrubDown(info: DragInfo) {
    octaveBox = scrubBoxOf(octaveStrip);
    octaveAt(info.x);
  }

  /**
   * The waveform grid scrubs too (user, 2026-09-12) — same rule in two
   * dimensions. Cell 0 is the OSC 1/2 badge, so the wave index is one
   * less; a finger over the badge changes no waveform, and dragging
   * ONTO the badge is not a switch either. Switching oscillator is a tap
   * on it, never something a scrub can do by passing through.
   */
  let waveGrid = $state<HTMLElement | null>(null);
  let waveBox: ScrubBox | null = null;

  function waveAt(clientX: number, clientY: number) {
    if (!waveBox) return;
    const cols = Math.ceil((oscWaveOptions.length + 1) / 2);
    const cell = gridCellIndex(clientX, clientY, waveBox, cols, 2);
    const option = oscWaveOptions[cell - 1];
    if (!option || option.value === oscWave) return;
    writeOsc(oscTab, oscTab === 1 ? 20 : 24, option.value);
  }

  function waveScrubDown(info: DragInfo) {
    waveBox = scrubBoxOf(waveGrid);
    waveAt(info.x, info.y);
  }

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
  // Time XY: 35 / 37
  let timeXValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 35)) ?? 0.5 : 0.5);
  let timeYValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 37)) ?? 0.5 : 0.5);
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

  function handleFilterXYInteraction(x: number, y: number) {
    if (!device) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 1), x);
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 2), y);
  }

  function handleTimeXYInteraction(x: number, y: number) {
    if (!device) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 35), x);
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 37), y);
  }

  /**
   * Which oscillator the card is showing (2026-09-12). View state only —
   * it never touches Drift, and it deliberately does NOT follow which
   * oscillator is switched on: a tab that moved itself would take the
   * card away mid-edit the moment a patch loaded.
   *
   * It DOES follow a finger (user, 2026-09-16): touching Osc 1 or Osc 2 in
   * the level mixer brings that oscillator's card up. The distinction that
   * keeps the paragraph above true is the same one the badge's tap makes —
   * a hand reaching for a source is a statement about which one you are
   * working on, where a patch load is not. It costs nothing to be wrong
   * about, since the card is the only thing that moves, and it saves the
   * two-step the mixer created: balance the levels, then walk back to the
   * badge to shape the one you were just holding.
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
      Signal-flow row: Sources (OSC 1 + OSC 2 + Noise) → Filter/Time → Voicing → wheels.
      Each oscillator is one card reading top-to-bottom: pick a waveform, shape it
      on the pad, set its level — so the two cards are the same gesture twice.
      Mirrors AutoFilterCentralView's flex-[N] idiom for consistency across views.
    -->
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
      <div class="drift-card osc-card flex-[2] min-w-[212px] min-h-0 flex flex-col gap-(--central-gap)"
           style="--drift-ink: {oscInk.primary};">
        <!-- The swap pill lies across the top of the oscillator card (user's
             layout, 2026-09-16): the card is the view's leading column. -->
        <HostedSwapPill />
        <!-- Everything reads across, stacked down the card (user's call,
             2026-09-12): the waveform grid two rows deep, then the octave
             as one segmented strip, then Shape and Gain as horizontal
             faders. The card is wider than it was and the Time/Filter
             column narrower to pay for it.

             The waveforms are `physical-button`s rather than the house
             segmented control: segmented reads as ONE strip, and these
             are two rows. `ceil((n + 1) / 2)` columns — the +1 being the
             OSC 1/2 badge in the first cell — is what makes it exactly
             two FULL rows for both oscillators: 4 across for OSC 1's
             seven, 3 for OSC 2's five, no empty cell either way. -->
        <div
          class="osc-body flex-1 min-h-0"
          style="grid-template-columns: repeat({Math.ceil((oscWaveOptions.length + 1) / 2)}, minmax(0, 1fr)); {oscOn ? '' : 'opacity: var(--opacity-ghost);'}"
        >
          <!-- The waveform cells are scrubbed from the GRID, which spans
               all four rows — so the drag surface has to be the two
               waveform rows alone, not the body. Hence the inner wrapper
               below rather than `use:drag` up here. -->
          <div
            class="wave-grid"
            bind:this={waveGrid}
            use:drag={{ commit: 'immediate', onDown: waveScrubDown, onMove: (i) => waveAt(i.x, i.y) }}
            style="grid-template-columns: repeat({Math.ceil((oscWaveOptions.length + 1) / 2)}, minmax(0, 1fr));"
          >
            <!-- The switch is the grid's FIRST CELL (user's sketch,
                 2026-09-12) — 1 badge + 7 waveforms is exactly 4x2, and
                 1 + 5 is exactly 3x2, so it fills the hole the odd
                 waveform count left instead of costing the card a header
                 band of its own. (The card's original wave grid put its
                 TITLE in this cell for the same reason.) It wears the
                 shown oscillator's colour, so the corner says orange or
                 blue before the digit is read, and carries BOTH numbers
                 so the oscillator you are not looking at is still
                 accounted for — each digit dimming on its own when that
                 oscillator is switched off. -->
            <div class="osc-badge-cell">
              <button
                class="osc-badge"
                style="--osc-badge-ink: {oscInk.primary};"
                aria-label="Oscillator {oscTab} of 2 — switch to oscillator {oscTab === 1 ? 2 : 1}"
                onclick={() => (oscTab = oscTab === 1 ? 2 : 1)}
              >
                <span class="osc-badge-eyebrow">Osc</span>
                <span class="osc-badge-pair">
                  <span class="osc-badge-n" class:on={oscTab === 1} class:silent={!osc1On}>1</span><span
                    class="osc-badge-slash">/</span><span
                    class="osc-badge-n" class:on={oscTab === 2} class:silent={!osc2On}>2</span>
                </span>
              </button>
            </div>
            {#each oscWaveOptions as option}
              <button
                class="physical-button wave-button"
                class:active={oscWave === option.value}
                style="--btn-tint: {oscInk.primary};"
                title={option.label}
                aria-label="OSC {oscTab} wave {option.label}"
                aria-pressed={oscWave === option.value}
                onclick={() => writeOsc(oscTab, oscTab === 1 ? 20 : 24, option.value)}
              >
                {@render waveGlyph(option.label)}
              </button>
            {/each}
          </div>

          <div
            class="device-segmented octave-row"
            style="--btn-tint: {oscInk.primary}; grid-template-columns: repeat({OCTAVES.length}, 1fr);"
            bind:this={octaveStrip}
            use:drag={{
              commit: 'immediate',
              onDown: octaveScrubDown,
              onMove: (info) => octaveAt(info.x)
            }}
          >
            {#each OCTAVES as octave}
              <button
                class="device-segment octave-step"
                class:active={oscOctave === octave}
                aria-label="OSC {oscTab} octave {octaveLabel(octave)}"
                aria-pressed={oscOctave === octave}
                onclick={() => writeOsc(oscTab, oscTab === 1 ? 22 : 26, octave)}
              >{octaveLabel(octave)}</button>
            {/each}
          </div>

          <div class="osc-fader">
            <DeviceSlider
              value={oscShape}
              title="Shape"
              icon="shape"
              orientation="horizontal"
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
      <div class="drift-card mixer-card flex-none min-h-0 flex flex-col gap-2" style="--drift-ink: {driftInk.primary};">
        <div class="flex-1 min-h-0 flex gap-(--central-gap)">
          <!-- Touching either oscillator's level brings ITS card up on the
               left (`onDown`, so the switch lands on the touch rather than
               on the first frame a finger has moved). The card is what says
               which oscillator that colour belongs to, and reaching for one
               of these is already a choice of oscillator. -->
          <div class="mixer-slider min-h-0">
            <DeviceSlider
              value={osc1Gain}
              title="Osc 1"
              icon="oscillator"
              orientation="vertical"
              labelSize="small"
              isGhost={!osc1On}
              color={osc1Ink}
              onDown={() => (oscTab = 1)}
              onInteraction={(value) => writeOsc(1, 29, value)}
            />
          </div>
          <div class="mixer-slider min-h-0">
            <DeviceSlider
              value={osc2Gain}
              title="Osc 2"
              icon="oscillator"
              orientation="vertical"
              labelSize="small"
              isGhost={!osc2On}
              color={osc2Ink}
              onDown={() => (oscTab = 2)}
              onInteraction={(value) => writeOsc(2, 30, value)}
            />
          </div>
          <div class="mixer-slider min-h-0">
            <DeviceSlider
              value={noiseGain}
              title="Noise"
              icon="noise"
              orientation="vertical"
              labelSize="small"
              isGhost={!noiseOn}
              color={noiseInk}
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
      </div>

      <SectionDivider orientation="vertical" ink={driftInk.primary} />

      <!-- Time over Filter, equal halves of one column, with the filter's
           type switch at its foot: under the pad it belongs to, and below
           both pads rather than inside one, so the two stay the same height. -->
      <div class="flex-[3] min-h-0 flex flex-col" style="gap: var(--central-gap);">
        <div class="flex-1 min-h-0">
          <DeviceXY
            xValue={timeXValue}
            yValue={timeYValue}
            title="Time"
            icon="envelope"
            onInteraction={handleTimeXYInteraction}
            color={driftInk}
          />
        </div>
        <div class="flex-1 min-h-0">
          <DeviceXY
            xValue={cutoffValue}
            yValue={resonanceValue}
            title="Filter"
            icon="filter"
            xIcon="cutoff"
            yIcon="resonance"
            onInteraction={handleFilterXYInteraction}
            color={driftInk}
          />
        </div>
        <div
          class="device-segmented filter-type-row flex-none"
          style="--btn-tint: {driftInk.primary}; grid-template-columns: repeat({LP_TYPE_OPTIONS.length}, 1fr);"
        >
          {#each LP_TYPE_OPTIONS as option}
            <button
              class="device-segment filter-type-step"
              class:active={lpType === option.value}
              title="LP Type {option.label}"
              aria-label="Filter type {option.label}"
              aria-pressed={lpType === option.value}
              onclick={() => writeLpType(option.value)}
            >{option.label}</button>
          {/each}
        </div>
      </div>

      <SectionDivider orientation="vertical" ink={driftInk.primary} />

      <!-- Voicing group: the mode's own parameter, Glide in Mono, and
           Drift. The 2x2 mode grid that used to sit on top moved above
           the wheels (user, 2026-09-12) — it chooses what the card MEANS
           rather than being one of its controls, and the wheels' column
           was the only fixed-width block in the row with height to spare. -->
      <div class="drift-card voicing-card flex-none min-h-0 flex flex-col gap-2" style="--drift-ink: {driftInk.primary};">
        <!-- The mode's own slider, absent in Poly (it has nothing to write
             there). The card is as wide as the sliders it draws, so
             switching mode moves the pads' right edge. -->
        <div class="flex-1 min-h-0 flex gap-(--central-gap)">
          {#if voiceMode !== 0}
          <div class="voicing-slider min-h-0">
            <DeviceSlider
              value={voicingSliderValue}
              title={voicingSliderTitle}
              icon="unison"
              orientation="vertical"
              labelSize="small"
              isGhost={voiceMode === 0}
              color={driftInk}
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
                icon="glide"
                orientation="vertical"
                labelSize="small"
                color={driftInk}
                onInteraction={writeGlide}
              />
            </div>
          {/if}
          <div class="voicing-slider min-h-0">
            <DeviceSlider
              value={driftValue}
              title="Drift"
              icon="drift"
              orientation="vertical"
              labelSize="small"
              color={driftInk}
              onInteraction={(value) => {
                if (!device) return;
                selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 60), value);
              }}
            />
          </div>
        </div>
      </div>

      <SectionDivider orientation="vertical" ink={driftInk.primary} />

      <!-- Voice mode over the MIDI wheels. The four modes choose what the
           voicing group means, so they are not one of its controls; up
           here they sit across the two wheel columns, which are the only
           fixed-width block in the row with height to spare. -->
      <div class="flex-none flex flex-col gap-(--central-gap) min-h-0">
        <div class="grid grid-cols-2 gap-1 flex-none">
          {#each VOICE_MODE_OPTIONS as option}
            <button
              class="physical-button mode-button px-1 text-center"
              class:active={voiceMode === option.value}
              style="--btn-tint: {driftInk.primary};"
              onclick={() => {
                if (!devicePath) return;
                selectedTrackStore.setPropertyValue(devicePath, 'voice_mode_index', option.value);
              }}
            >
              {option.label}
            </button>
          {/each}
        </div>
        <div class="flex-1 min-h-0 flex gap-(--central-gap)">
          <div class="wheel-col h-full">
            <MidiWheel
              type="pitch"
              onInteraction={handlePitchChange}
              color={pitchInk}
            />
          </div>
          <div class="wheel-col h-full">
            <MidiWheel
              type="modwheel"
              onInteraction={handleModChange}
              color={modInk}
            />
          </div>
        </div>
      </div>
    </div>
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
     is left. The wheels take it too. */
  .drift-root {
    --drift-slider-w: 56px;
  }

  /* The oscillator card reads across and stacks down: a two-row waveform
     grid that takes the slack, then three fixed bands — the octave strip
     and the two faders. */
  .wave-button {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    min-height: 0;
    min-width: 0;
  }
  /* The body is ONE grid of four equal rows with one uniform gap — two
     rows of waveforms, the octave strip, then Shape (user: "can each row
     height be equal"). Nesting the waveform grid inside a flex column
     could not do it: its own internal row gap came out of its share, so
     a waveform row landed exactly one gap shorter than the octave strip
     beside it. As direct children of one grid they are all 1fr. */
  .osc-body {
    display: grid;
    grid-template-rows: repeat(4, minmax(0, 1fr));
    gap: var(--spacing-sm);
  }
  .octave-row,
  .osc-fader {
    grid-column: 1 / -1;
  }
  /* The waveform block spans the body's first TWO rows plus the gap
     between them, and divides that by the same gap — so its two rows come
     out exactly one body row each. (It needs to be one box rather than
     eight loose cells because it owns the scrub gesture: the drag surface
     is the waveforms, not the whole card.) */
  .wave-grid {
    display: grid;
    grid-column: 1 / -1;
    grid-row: 1 / 3;
    grid-template-rows: repeat(2, minmax(0, 1fr));
    gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
  }
  /* The octave strip and the filter type strip are the house segmented
     control laid on its side. The shared rules divide segments with a TOP
     border (a vertical stack) and clear it around an active fill; a row
     divides on the left instead, and an active segment clears the divider
     on both of its own sides — its own left border and its right
     neighbor's. */
  .octave-row,
  .filter-type-row {
    display: grid;
  }
  .octave-row .device-segment + .device-segment,
  .filter-type-row .device-segment + .device-segment {
    border-top: 0;
    border-left: 1px solid var(--line-faint);
  }
  .octave-row .device-segment.active,
  .octave-row .device-segment.active + .device-segment,
  .filter-type-row .device-segment.active,
  .filter-type-row .device-segment.active + .device-segment {
    border-left-color: transparent;
  }
  /* The filter type strip is one touch-height band under the Filter pad. */
  .filter-type-row {
    height: var(--height-touch);
  }
  .filter-type-step {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: 2px;
    font-size: 0.75rem;
    font-weight: 600;
  }
  /* The voicing sliders are pinned like every other (user, 2026-09-28).
     They used to divide a card sized for Mono's three, which drew Poly's
     two at 92px beside the mixer's 56. The card is now as wide as its
     sliders, so a mode change moves the Time/Filter column's edge. */
  /* The explicit width is for WebKit: it sizes the content-wide card from
     its sliders' widths, not their flex-basis, so without one the card
     came out narrow on the iPad and the sliders spilled under the wheels. */
  .voicing-slider {
    flex: 0 0 var(--drift-slider-w);
    width: var(--drift-slider-w);
  }
  /* The level mixer: three channels at the view's slider width, and the
     column exactly as wide as them — three sliders, TWO gaps. It said four
     gaps while it was a card with 8px of padding each side; once the frame
     came off, those 16px were slack that piled up after Noise and put the
     seam 28px from it and 12px from Time (measured, 2026-09-14). */
  .mixer-slider {
    flex: 0 0 var(--drift-slider-w);
  }
  .mixer-card {
    width: calc(3 * var(--drift-slider-w) + 2 * var(--central-gap));
  }
  /* The strip owns the pointer; the steps are its face. Keyboard focus
     and Enter still reach them. */
  .octave-step {
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: 2px;
    font-size: 0.75rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .wheel-col {
    width: var(--drift-slider-w);
  }
  .mode-button {
    min-height: var(--height-touch);
    font-size: 0.8125rem;
  }
  .wave-glyph {
    width: 100%;
    height: 100%;
    max-height: 22px;
  }

  /* ---- The OSC 1/2 switch: a circle in the waveform grid's first cell.
     A two-tab bar used to take a full touch-height band plus a gap across
     the whole card, and the corner-badge draft that replaced it cost 44px
     of top padding; in the grid it costs nothing at all, because the
     waveform counts (7 and 5) leave exactly one cell over in a two-row
     grid. A circle among the rounded squares, so it reads as a different
     kind of thing than the seven waveforms beside it. */
  /* The badge's cell is a size container, so the circle can be as big as
     the SMALLER of the cell's two sides. It was the row's height, and on
     the iPad band a row is taller than a waveform column is wide — the
     circle overflowed its cell and the card sideways, 6.8px from the
     frame's edge against the view's 16px inset (tour layout check,
     2026-09-14). */
  .osc-badge-cell {
    container-type: size;
    display: grid;
    place-items: center;
    min-width: 0;
    min-height: 0;
  }
  .osc-badge {
    width: 100cqmin;
    height: 100cqmin;
    border-radius: 999px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    line-height: 1;
    background: var(--osc-badge-ink);
    border: 1px solid var(--osc-badge-ink);
    color: var(--flat-on-fg);
    cursor: pointer;
    transition: background-color var(--t-fast) var(--ease-precise);
  }
  .osc-badge-eyebrow {
    font-size: 8px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0.8;
  }
  .osc-badge-pair {
    display: flex;
    align-items: baseline;
    font-size: 15px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  /* The digit you are NOT on stays legible but recedes, so the badge
     still says there are two. A digit dims further when THAT oscillator
     is switched off — the one reading the two-tab bar had that a single
     badge would otherwise lose. */
  .osc-badge-n {
    opacity: 0.45;
  }
  .osc-badge-n.on {
    opacity: 1;
  }
  .osc-badge-n.silent {
    opacity: 0.25;
  }
  .osc-badge-n.on.silent {
    opacity: 0.55;
  }
  .osc-badge-slash {
    opacity: 0.45;
    padding: 0 1px;
  }

  /* ---- Live skin (flat grammar). Wave / voice buttons are .physical-button,
     the pads / sliders / wheels are DeviceXY / DeviceSlider / MidiWheel —
     all flat on their own, and since 2026-09-13 the three section groups
     have no frame of their own either: the seams between them are
     `SectionDivider`s, which carry their own flat fork. What is left here
     is the segmented strips' dividers and the source colours. Every rule
     sits under [data-grammar="flat"] / [data-skin]. */
  :global([data-grammar="flat"]) .octave-row .device-segment + .device-segment,
  :global([data-grammar="flat"]) .filter-type-row .device-segment + .device-segment {
    border-top: 0;
    border-left: 1px solid var(--line-strong);
  }
  :global([data-grammar="flat"]) .octave-row .device-segment.active,
  :global([data-grammar="flat"]) .octave-row .device-segment.active + .device-segment,
  :global([data-grammar="flat"]) .filter-type-row .device-segment.active,
  :global([data-grammar="flat"]) .filter-type-row .device-segment.active + .device-segment {
    border-left-color: transparent;
  }

  /* ---- The source colours have to be re-asserted against the flat
     grammar (2026-09-12). app.css's flat fork pins every segmented
     control to the house pair — `--foreground` at rest, `--phosphor`
     when lit — and ignores `--btn-tint` entirely, which is right for a
     control whose colour means nothing. Here the colour IS the meaning:
     without these rules the wave picker and the octave column read house
     amber on an OSC 2 card that is otherwise blue, and the OSC 2 tab
     could not say it was blue at all while OSC 1 was showing.

     `--btn-tint` is set on the two columns from the shown oscillator's
     ink and on each TAB from its own, so the tabs stay orange and blue
     whichever is selected. The filter type strip takes the same rules in
     the view's ink, so its lit step matches the Filter pad above it. */
  :global([data-grammar="flat"]) .osc-card .device-segment,
  :global([data-grammar="flat"]) .filter-type-row .device-segment {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
  :global([data-grammar="flat"]) .osc-card .device-segment:hover:not(.active),
  :global([data-grammar="flat"]) .filter-type-row .device-segment:hover:not(.active) {
    color: var(--btn-tint);
    background: color-mix(in srgb, var(--btn-tint) 12%, transparent);
  }
  :global([data-grammar="flat"]) .osc-card .device-segment.active,
  :global([data-grammar="flat"]) .filter-type-row .device-segment.active {
    background: var(--btn-tint);
    color: var(--flat-on-fg);
  }
  /* Same argument for the waveform buttons, which are `physical-button`s
     rather than segments: the flat grammar lights an active one with
     --phosphor, and here the colour has to be the oscillator's. */
  :global([data-grammar="flat"]) .osc-card .physical-button {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
  :global([data-grammar="flat"]) .osc-card .physical-button.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }

</style>
