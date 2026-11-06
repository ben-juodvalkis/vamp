<script lang="ts">
  /**
   * WavetableCentralView — Ableton Wavetable (LOM class `InstrumentVector`).
   *
   * Layout (re-laid 2026-11-06 on Drift's model, ADR-509/510): the two
   * oscillators' levels (a touch picks the oscillator the section shows),
   * its octaves, its wave drawn over its Position, Effect 1 and Effect 2
   * knobs; the filter pad with its type as a tab of all five, the routing
   * and the slope; the Amp and Env 2 stages; Time and Global Mod Amount.
   * No pitch/mod wheels (user's call, 2026-10-22).
   *
   * The face has no oscillator PAD since 2026-11-06 (user: "we don't need
   * to duplicate XY controls between the effect chain and central views"):
   * the chain cell's XY is Osc 1's Effect 2 / Wave Position. The pad lives
   * on the oscillator's page, which `wavetable/WavetablePages.svelte` draws
   * for every section the face's eyebrows open, as Drift's do.
   *
   * Parameter indices and rails are measured off the `.adv` artifact
   * (`Looping Presets/Instruments/Ableton/Synth/Ableton/Wavetable/Default.adv`,
   * gzipped XML) rather than taken from the docs. Element order IS LOM
   * parameter order with Device On at 0, and `InstrumentVector` has no
   * nested container elements, so a flat scan is sound here:
   *
   *     4  Voice_Oscillator1_Wavetables_WavePosition   0 .. 1
   *     6  Voice_Oscillator1_Effects_Effect2           0 .. 1
   *     9  Voice_Oscillator2_On                        bool, default FALSE
   *    12  Voice_Oscillator2_Wavetables_WavePosition   0 .. 1
   *    14  Voice_Oscillator2_Effects_Effect2           0 .. 1
   *    39  Voice_Modulators_AmpEnvelope_Times_Attack   0 .. 20     (seconds)
   *    41  Voice_Modulators_AmpEnvelope_Times_Release  0.0015 .. 20 (seconds)
   *
   * Decay (40) and Sustain (45) were added 2026-09-12 from the user's own
   * reading of the device; their rails are NOT measured here, which is why
   * every envelope stage asks `paramRange` for Live's answer and treats
   * the table above as a fallback only — see ENVELOPE below.
   *
   * The four oscillator params are natively 0..1, so they ride the pads
   * unscaled. The envelope stages are NOT.
   *
   * Each oscillator pad draws one cycle of the table it plays, at its Wave
   * Position and through its effect (2026-10-22): the table's frames come
   * from `wavetableShapes` (rendered off Live, keyed by category and table
   * name), the table from the device's `oscillator_N_*` properties, and the
   * effect from `wavetableEffects` with the mode and both effect params. A
   * table the bundle lacks (a user table) draws no wave.
   */

  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import { liveFilterCurve } from '$lib/utils/instrumentFilterCurves';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import InstrumentPanelView from './panel/InstrumentPanelView.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import { usePanelParams } from './panel/usePanelParams.svelte';
  import { WAVETABLE_PANEL } from './panel/wavetablePanel';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import WavetableWave from './wavetable/WavetableWave.svelte';
  import WavetablePages from './wavetable/WavetablePages.svelte';
  import { useOscWave } from './wavetable/useOscWave.svelte';
  import FilterDotsGraph from '../FilterDotsGraph.svelte';
  import ScrubTabs from '../../device-panel/ScrubTabs.svelte';
  import { FILTER_ROUTINGS, graphCurves, type GraphFilter } from '$lib/utils/wavetableFilterGraph';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  // Track reactive state
  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);

  // PR-3.5.2a: path-keyed device lookup (v3 tree, chain-order indexed).
  // Returns `undefined` on cold start — same "show ghost" posture as
  // the v2 .find() it replaces.
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);

  // ===== Parameter map (measured — see the module comment) =====
  // Each oscillator's eight, read off the running device 2026-10-22: Osc 2
  // is Osc 1 plus 8. Transp is semitones -24..24; the rest are 0..1.
  const OSC = {
    1: { on: 1, transp: 2, position: 4, effect1: 5, effect2: 6, gain: 8 },
    2: { on: 9, transp: 10, position: 12, effect1: 13, effect2: 14, gain: 16 }
  } as const;
  type OscN = keyof typeof OSC;

  // Filter 1, read off the running device 2026-10-22 (Live 12.4.15):
  // Freq 20 Hz..20.5 kHz on a log sweep, Res 0..1 (Live's 0..125 %),
  // Type 0..4 Lowpass/Highpass/Bandpass/Notch/Morph, Slope 12/24.
  // Filter 2 is Filter 1 plus 9 (device dump, 2026-10-22).
  const FLT = {
    1: { on: 21, type: 22, slope: 25, freq: 26, res: 27, morph: 29 },
    2: { on: 30, type: 31, slope: 34, freq: 35, res: 36, morph: 38 }
  } as const;
  const FILTER_TYPES = ['LP', 'HP', 'BP', 'Notch', 'Morph'] as const;

  // The envelopes, four sliders in ADSR order (user's call and user's
  // indices, 2026-09-12). It was an XY pad reading Attack across and
  // Release up, which reached neither Decay nor Sustain. Env 2 joined it
  // behind an Amp | Env 2 switch on 2026-10-22: 47 Attack, 48 Decay,
  // 55 Sustain, 49 Release, every rail 0..1 on the running device.
  //
  // Amp-envelope times are in SECONDS on a 0..20 rail, not 0..1. The wire
  // carries raw Live units (wire-protocol §2 — nothing rescales for us), so
  // a slider has to normalize on read and denormalize on write. Writing a
  // raw 0..1 straight through, as this view once did, could only ever
  // reach the first second of a twenty-second rail — and reading 10.3 s
  // back into a 0..1 control pinned the handle at the ceiling.
  //
  // `fallback` is the hand-measured rail this view has always carried,
  // used only until Live's own range lands; `paramRange` is authoritative
  // once it does. Decay rides the same seconds rail as the other two
  // times; Sustain is a level, so 0..1 — but neither has been measured on
  // the rig, which is exactly why the range is asked for rather than
  // assumed.
  const ENVELOPE = [
    { index: 39, title: 'A', icon: 'attack', fallback: { min: 0, max: 20 }, atRest: 0 },
    { index: 40, title: 'D', icon: 'decay', fallback: { min: 0, max: 20 }, atRest: 0 },
    { index: 45, title: 'S', icon: 'sustain', fallback: { min: 0, max: 1 }, atRest: 1 },
    { index: 41, title: 'R', icon: 'release', fallback: { min: 0.0015, max: 20 }, atRest: 0.0015 }
  ] as const;
  const ENV2 = [
    { index: 47, title: 'A', icon: 'attack', fallback: { min: 0, max: 1 }, atRest: 0.084 },
    { index: 48, title: 'D', icon: 'decay', fallback: { min: 0, max: 1 }, atRest: 0.416 },
    { index: 55, title: 'S', icon: 'sustain', fallback: { min: 0, max: 1 }, atRest: 0.5 },
    { index: 49, title: 'R', icon: 'release', fallback: { min: 0, max: 1 }, atRest: 0.416 }
  ] as const;

  // The two global modulation controls (user's ask, 2026-10-22), read off
  // the running device: 'Time' 0..1 with 0.5 at 0 % (Live shows -100..100 %,
  // it scales every envelope and LFO time) and 'Global Mod Amount' 0..1
  // (Live shows 0..200 %, 0.5 = 100 %; it scales every mod-matrix row).
  const TIME = 87;          // 'Time'
  const GLOBAL_MOD = 88;    // 'Global Mod Amount'

  const norm = (raw: number, min: number, max: number) =>
    Math.min(1, Math.max(0, (raw - min) / (max - min)));
  const denorm = (unit: number, min: number, max: number) => min + unit * (max - min);

  /** Live's own range for a parameter, else this view's measured rail. */
  function rangeOf(index: number, fallback: { min: number; max: number }) {
    if (!device) return fallback;
    const range = selectedTrackStore.paramRange(selectedTrackStore.paramPath(device, index));
    return range && range.max > range.min ? range : fallback;
  }

  /** Read a param through the armed reader so the UI holds its own in-flight write. */
  function read(index: number, fallback: number): number {
    if (!device) return fallback;
    return (
      selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, index)) ?? fallback
    );
  }

  function write(index: number, value: number) {
    if (!device) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, index), value);
  }

  /** Live's own value, a box's readout while it is dragged (ADR-477); sent only while the UI writes. */
  function display(index: number): string | undefined {
    if (!device) return undefined;
    return selectedTrackStore.paramDisplay(selectedTrackStore.paramPath(device, index));
  }

  /**
   * Which oscillator the card is showing. View state only, as on Drift: it
   * writes nothing, so a patch change never takes the card away mid-edit.
   */
  let oscTab = $state<OscN>(1);

  /** The pages behind the face's eyebrows, by Live's names (ADR-487). */
  const panelParams = usePanelParams(() => device);
  let o = $derived(OSC[oscTab]);

  // All parameter values as $derived - always reactive to store changes (ADR-149)
  let oscPosition = $derived(read(o.position, 0.5));
  let oscEffect1 = $derived(read(o.effect1, 0));
  let oscEffect2 = $derived(read(o.effect2, 0));
  let osc1Gain = $derived(read(OSC[1].gain, 1));
  let osc2Gain = $derived(read(OSC[2].gain, 1));
  let oscTransp = $derived(Math.round(read(o.transp, 0)));

  // Osc 2 ships OFF in the default preset, so its card is ghosted until it
  // is switched on. Read through the armed reader: our own on-write
  // un-ghosts the pad on the same frame rather than waiting for the
  // surface's echo, so the dot doesn't drag under a dashed border.
  let osc1On = $derived(read(OSC[1].on, 1) >= 0.5);
  let osc2On = $derived(read(OSC[2].on, 0) >= 0.5);
  let oscOn = $derived(oscTab === 1 ? osc1On : osc2On);

  /** Octave steps on Transp's -24..24 semitones; a step between them lights none. */
  const OCTAVES = [-2, -1, 0, 1, 2] as const;
  const octaveLabel = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  /** The octave column reads +2 at the top. */
  const OCTAVES_DOWN = [...OCTAVES].reverse();
  /** The slope's tab, in numbers: the filter column has no room for "dB". */
  const SLOPES = ['12', '24'] as const;

  // Both filters on one pad, a dot each (2026-11-05, Live's panel): a
  // press grabs the nearer dot, and that filter is the one the type and
  // slope rows edit. View state only; it writes nothing to Live. A drag
  // switches a filter that is off on.
  let fltTab = $state<1 | 2>(1);
  let f = $derived(FLT[fltTab]);
  let flt1On = $derived(read(FLT[1].on, 1) >= 0.5);
  let flt2On = $derived(read(FLT[2].on, 0) >= 0.5);
  let fltOn = $derived(fltTab === 1 ? flt1On : flt2On);
  let fltType = $derived(Math.round(read(f.type, 0)));
  let fltSlope = $derived(Math.round(read(f.slope, 0)));
  function graphFilter(n: 1 | 2, on: boolean): GraphFilter {
    const p = FLT[n];
    return {
      x: read(p.freq, n === 1 ? 1 : 0.5),
      y: read(p.res, 0),
      curve: liveFilterCurve(Math.round(read(p.type, 0)), Math.round(read(p.slope, 0)), read(p.morph, 0)),
      on
    };
  }
  let graphFilters = $derived([graphFilter(1, flt1On), graphFilter(2, flt2On)] as const);
  let graphDots = $derived(
    ([1, 2] as const).map((n) => ({
      label: String(n),
      x: graphFilters[n - 1].x,
      y: graphFilters[n - 1].y,
      color: (n === 1 ? osc1Ink : osc2Ink).primary,
      on: graphFilters[n - 1].on,
      filled: n === fltTab
    }))
  );

  // Serial, Parallel or Split: Live's `filter_routing` property, serial 0,
  // parallel 1, split 2 (measured on the running Live, 2026-11-05).
  $effect(() => {
    const path = device?.devicePath;
    if (!path) return;
    return selectedTrackStore.subscribeProperty(path, 'filter_routing');
  });
  let filterRouting = $derived(
    Number(device ? selectedTrackStore.propertyValue(device.devicePath, 'filter_routing') ?? 0 : 0)
  );
  function writeRouting(value: number) {
    if (!device) return;
    void selectedTrackStore.setPropertyValue(device.devicePath, 'filter_routing', value);
  }

  // ===== The oscillators' waves =====
  const oscWaves = useOscWave(() => device?.devicePath);

  /**
   * Effect 1's and Effect 2's names on Live's panel under each effect mode.
   * The LOM calls them "Osc N Effect 1/2" in every mode and AX describes them
   * only as "Device" (both read 2026-10-22), so the words are the panel's:
   * Tune seen on the rig in FM, the rest from Live's manual (FM Tune / Amt,
   * Classic PW / Sync, Modern Warp / Fold). Mode None has no effect.
   */
  const EFFECT_TITLES = {
    none: ['Fx 1', 'Fx 2'],
    fm: ['Tune', 'Amt'],
    classic: ['PW', 'Sync'],
    modern: ['Warp', 'Fold']
  } as const;
  const effectTitles = (n: OscN) => EFFECT_TITLES[oscWaves.effectMode(n)];
  let oscEffectMode = $derived(oscWaves.effectMode(oscTab));

  let time = $derived(read(TIME, 0.5));
  let globalMod = $derived(read(GLOBAL_MOD, 0.5));

  let oscWaveCycle = $derived(oscWaves.wave(oscTab, oscPosition, read(o.effect1, 0.5), oscEffect2));
  /** One oscillator's cycle, for its page's pad. */
  const waveOf = (n: OscN) =>
    oscWaves.wave(n, read(OSC[n].position, 0.5), read(OSC[n].effect1, 0.5), read(OSC[n].effect2, 0));

  /**
   * The section page on screen in place of the face, or none. Wavetable
   * draws its own pages (`wavetable/WavetablePages.svelte`, ADR-510), as
   * Drift does, rather than the panel's rule-laid ones.
   */
  let wtPage = $state<string | null>(null);
  const openWtPage = (page: string | null) => (wtPage = page);

  /** Both envelopes in view, Amp over Envelope 2 (ADR-477). */
  const ENVELOPES = [
    { title: 'Amp Envelope', stages: ENVELOPE },
    { title: 'Envelope 2', stages: ENV2 }
  ] as const;

  function envelopeValue(stage: { index: number; fallback: { min: number; max: number }; atRest: number }): number {
    const { min, max } = rangeOf(stage.index, stage.fallback);
    return norm(read(stage.index, stage.atRest), min, max);
  }

  // ===== Colors =====
  /**
   * Osc 1 orange, Osc 2 blue — Drift's source colours, so the same colour
   * means the same oscillator in both synths. Only the card wears them:
   * the filter and the envelopes are shared by both oscillators.
   */
  const OSC_COLORS = {
    1: { primary: '#ff8244', secondary: 'rgba(255, 130, 68, 0.1)', accent: '#ff9e60' },
    2: { primary: '#12b2f4', secondary: 'rgba(18, 178, 244, 0.1)', accent: '#33cdff' }
  } as const;
  function inkFor(n: OscN) {
    const raw = OSC_COLORS[n];
    const mode = paintModeReactive();
    return { primary: trackInk(raw.primary, mode), secondary: raw.secondary, accent: trackInk(raw.accent, mode) };
  }
  let osc1Ink = $derived(inkFor(1));
  let osc2Ink = $derived(inkFor(2));
  let oscInk = $derived(oscTab === 1 ? osc1Ink : osc2Ink);
  /** A filter wears its oscillator's ink, so Split reads Osc 1 → Filter 1. */
  let fltInk = $derived(fltTab === 1 ? osc1Ink : osc2Ink);

  // Wavetable color scheme (purple/violet - matches Wavetable's UI aesthetic)
  const wavetableColor = {
    primary: '#8b5cf6',
    secondary: 'rgba(139, 92, 246, 0.1)',
    accent: '#a78bfa'
  };

  // GRATICULE (§5.5): normalize the per-section palette through trackInk at injection.
  let trackScheme = $derived(selectedTrackScheme());
  let wavetableInk = $derived(trackScheme ?? {
    primary: trackInk(wavetableColor.primary, paintModeReactive()),
    secondary: wavetableColor.secondary,
    accent: trackInk(wavetableColor.accent, paintModeReactive())
  });

  // ===== Handlers =====
  // XY interaction handlers - just send to store, control component handles local state
  /**
   * Reaching for an oscillator's control IS the request to hear it. A
   * control that moves a silent oscillator is a dead control, so the first
   * touch switches it on and the ghost lifts under the finger.
   */
  function writeOsc(index: number, value: number, n: OscN = oscTab) {
    if (!device) return;
    if (!(n === 1 ? osc1On : osc2On)) write(OSC[n].on, 1);
    write(index, value);
  }

  /** A level in the mixer: the same rule, for the oscillator it belongs to. */
  function writeLevel(n: OscN, value: number) {
    writeOsc(OSC[n].gain, value, n);
  }

  /** An oscillator's pad (its page): Effect 2 across, Wave Position up. */
  function handleOscXY(n: OscN, x: number, y: number) {
    writeOsc(OSC[n].effect2, x, n);
    writeOsc(OSC[n].position, y, n);
  }

  function moveFilter(n: 1 | 2, x: number, y: number) {
    if (!device) return;
    const p = FLT[n];
    if (!(n === 1 ? flt1On : flt2On)) write(p.on, 1);
    write(p.freq, x);
    write(p.res, y);
  }

  function writeEnv(index: number, fallback: { min: number; max: number }, value: number) {
    const { min, max } = rangeOf(index, fallback);
    write(index, denorm(value, min, max));
  }
</script>

<!-- An oscillator's pad, on its page: Effect 2 across, Wave Position up,
     its wave drawn beneath. Ghosted while the oscillator is off; still
     draggable, and the drag turns it on. -->
{#snippet oscPad(n: OscN)}
  {@const on = n === 1 ? osc1On : osc2On}
  {@const ink = n === 1 ? osc1Ink : osc2Ink}
  <DeviceXY
    xValue={read(OSC[n].effect2, 0)}
    yValue={read(OSC[n].position, 0.5)}
    title="OSC {n}"
    titleAt="bottom"
    isGhost={!on}
    onInteraction={(x, y) => handleOscXY(n, x, y)}
    color={ink}
  >
    {#snippet background()}<WavetableWave cycle={waveOf(n)} color={ink.primary} />{/snippet}
  </DeviceXY>
{/snippet}

<!-- A knob in a face column: medium, its name under it, or its mark inside. -->
{#snippet faceKnob(index: number, value: number, title: string, color: typeof wavetableInk, onInteraction: (v: number) => void, opts: { size?: 's' | 'm'; mark?: string; ghost?: boolean; bipolar?: boolean; onDown?: () => void } = {})}
  <div class="knob-cell min-h-0 min-w-0">
    <DeviceSlider
      {value}
      {title}
      face="knob"
      knobSize={opts.size ?? 'm'}
      knobCaption={!opts.mark}
      knobMark={opts.mark}
      orientation="vertical"
      labelSize="small"
      centerOrigin={opts.bipolar}
      centerValue={opts.bipolar ? 0.5 : undefined}
      isGhost={opts.ghost}
      {color}
      readout={display(index)}
      onDown={opts.onDown}
      {onInteraction}
    />
  </div>
{/snippet}

<div class="wt-root h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <InstrumentPanelView panel={WAVETABLE_PANEL} params={panelParams} color={wavetableInk}>
    {#snippet face(_openPage: (page: string) => void)}
    {#if wtPage}
    <WavetablePages
      page={wtPage}
      params={panelParams}
      ink={wavetableInk}
      oscInks={{ 1: osc1Ink, 2: osc2Ink }}
      onNavigate={openWtPage}
      {oscPad}
      {effectTitles}
    />
    {:else}
    <!-- One grid, eleven columns (ADR-510, re-laid 2026-11-06): Oscillator
         5 (the levels, the octaves, the wave over Position, Effect 1 and
         Effect 2), Filter 3, Mod Sources 2 (Amp, Env 2), Global 1, in
         Live's signal order. The swap pill rides over the wave, so the
         face keeps the column the pill would take: ~80px columns, every
         knob medium (70px) and the envelopes' small (48px). -->
    <FaceGrid sections={[5, 3, 2, 1]}>
      <FaceSection span={5}>
        {#snippet head()}<PanelEyebrow title="Osc {oscTab}" page="osc{oscTab}" onOpen={openWtPage} color={oscInk.primary} />{/snippet}
        <!-- The levels, Osc 1 over Osc 2, each in its own colour and
             marked with its number, as Drift's: touching one brings its
             oscillator up in the rest of the section. -->
        <div class="knob-stack min-h-0 min-w-0">
          {@render faceKnob(OSC[1].gain, osc1Gain, 'Osc 1', osc1Ink, (v) => writeLevel(1, v), { mark: '1', ghost: !osc1On, onDown: () => (oscTab = 1) })}
          {@render faceKnob(OSC[2].gain, osc2Gain, 'Osc 2', osc2Ink, (v) => writeLevel(2, v), { mark: '2', ghost: !osc2On, onDown: () => (oscTab = 2) })}
        </div>
        <!-- The octaves, +2 at the top (user, 2026-11-05). -->
        <div class="min-h-0 flex flex-col">
          <ScrubTabs
            inked
            options={OCTAVES_DOWN}
            selected={OCTAVES_DOWN.findIndex((n) => oscTransp === n * 12)}
            onSelect={(_, n) => writeOsc(o.transp, n * 12)}
            cols={1}
            tint={oscInk.primary}
            label={(n) => `Osc ${oscTab} octave ${octaveLabel(n)}`}
            class="flex-1"
          >
            {#snippet item(n)}{octaveLabel(n)}{/snippet}
          </ScrubTabs>
        </div>
        <!-- The swap pill, the oscillator's wave (a picture: the pad is on
             the oscillator's page and Osc 1's on the chain cell), and under
             it the three knobs that shape it. -->
        <div class="osc-card face-span-3">
          <div class="span-all"><HostedSwapPill /></div>
          <div class="span-all wave-well" style={oscOn ? '' : 'opacity: var(--opacity-ghost);'} data-osc-wave={oscTab}>
            <WavetableWave cycle={oscWaveCycle} color={oscInk.primary} />
          </div>
          {@render faceKnob(o.position, oscPosition, 'Position', oscInk, (v) => writeOsc(o.position, v), { ghost: !oscOn })}
          {@render faceKnob(o.effect1, oscEffect1, effectTitles(oscTab)[0], oscInk, (v) => writeOsc(o.effect1, v), { ghost: !oscOn || oscEffectMode === 'none' })}
          {@render faceKnob(o.effect2, oscEffect2, effectTitles(oscTab)[1], oscInk, (v) => writeOsc(o.effect2, v), { ghost: !oscOn || oscEffectMode === 'none' })}
        </div>
      </FaceSection>
      <FaceSeam ink={wavetableInk.primary} />

      <!-- Both filters on one pad, a numbered dot each: cutoff across,
           resonance up, Serial one curve and Parallel / Split two (Live's
           panel, 2026-11-05). Under it the type of the filter last
           touched, all five at once (it was a ‹ type › stepper), then the
           routing and its slope. -->
      <FaceSection span={3}>
        {#snippet head()}<PanelEyebrow title="Filter {fltTab}" page="filter{fltTab}" onOpen={openWtPage} color={fltInk.primary} />{/snippet}
        <div class="flt-card face-span-all">
          <div class="span-all min-h-0">
            <FilterDotsGraph
              dots={graphDots}
              curves={graphCurves(graphFilters, filterRouting).map((c) => ({
                d: c.d,
                color: c.filter === null ? wavetableInk.primary : (c.filter === 1 ? osc1Ink : osc2Ink).primary
              }))}
              ariaLabel="Filters: 1 at {Math.round(graphFilters[0].x * 100)}%, 2 at {Math.round(graphFilters[1].x * 100)}%"
              onGrab={(i) => (fltTab = i === 0 ? 1 : 2)}
              onMove={(i, x, y) => moveFilter(i === 0 ? 1 : 2, x, y)}
            />
          </div>
          <div class="span-all strip-row" class:ghost-row={!fltOn} data-filter-type>
            <ScrubTabs
              inked
              options={FILTER_TYPES}
              selected={fltType}
              onSelect={(i) => write(f.type, i)}
              tint={fltInk.primary}
              label={(t) => `Filter ${fltTab} type ${t}`}
              class="h-full"
              style="--scrub-font-size: 0.75rem; --scrub-padding: 0 0.125rem;"
            >
              {#snippet item(t)}{t}{/snippet}
            </ScrubTabs>
          </div>
          <div class="face-span-2 strip-row">
            <ScrubTabs
              inked
              options={FILTER_ROUTINGS}
              selected={filterRouting}
              onSelect={(i) => writeRouting(i)}
              tint={wavetableInk.primary}
              label={(r) => `Filter routing ${r}`}
              class="h-full"
              style="--scrub-font-size: 0.75rem; --scrub-padding: 0 0.125rem;"
            >
              {#snippet item(r)}{r}{/snippet}
            </ScrubTabs>
          </div>
          <div class="strip-row" class:ghost-row={!fltOn}>
            <ScrubTabs
              inked
              options={SLOPES}
              selected={fltSlope}
              onSelect={(i) => write(f.slope, i)}
              tint={fltInk.primary}
              label={(l) => `Filter ${fltTab} slope ${l} dB`}
              class="h-full"
              style="--scrub-font-size: 0.75rem;"
            >
              {#snippet item(l)}{l}{/snippet}
            </ScrubTabs>
          </div>
        </div>
      </FaceSection>
      <FaceSeam ink={wavetableInk.primary} />

      <!-- The two envelopes, Amp then Env 2, a column each, A over D over
           S over R: small knobs marked with the stage (Drift's face), their
           names over the columns. The name line opens the mod sources. -->
      <FaceSection span={2}>
        {#snippet head()}
          <button class="mod-link" style="color: {wavetableInk.primary};" data-page="mod" onclick={() => openWtPage('mod')}>
            <span>Amp</span><span>Env 2 ›</span>
          </button>
        {/snippet}
        {#each ENVELOPES as envelope (envelope.title)}
          <div class="knob-stack env-stack min-h-0 min-w-0" data-envelope={envelope.title}>
            {#each envelope.stages as stage (stage.index)}
              {@render faceKnob(stage.index, envelopeValue(stage), `${envelope.title} ${stage.title}`, wavetableInk, (v) => writeEnv(stage.index, stage.fallback, v), { size: 's', mark: stage.title })}
            {/each}
          </div>
        {/each}
      </FaceSection>
      <FaceSeam ink={wavetableInk.primary} />

      <!-- Time over Global Mod Amount: the device-wide scalers of every
           envelope and LFO time and of the mod matrix. Medium: two
           captioned large knobs need 300px and the band has about 263. -->
      <FaceSection span={1}>
        {#snippet head()}<PanelEyebrow title="Global" page="global" onOpen={openWtPage} color={wavetableInk.primary} />{/snippet}
        <div class="knob-stack min-h-0 min-w-0">
          {@render faceKnob(TIME, time, 'Time', wavetableInk, (v) => write(TIME, v), { bipolar: true })}
          {@render faceKnob(GLOBAL_MOD, globalMod, 'Mod Amt', wavetableInk, (v) => write(GLOBAL_MOD, v))}
        </div>
      </FaceSection>
    </FaceGrid>
    {/if}
    {/snippet}
    </InstrumentPanelView>
  {:else}
    <!-- Default state when no Wavetable present -->
    <DeviceEmptyState glyph="~" message="Load Wavetable to access controls" color={wavetableInk.primary} />
  {/if}
</div>

<style>
  /* The face's layout is the FaceGrid (ADR-510): eleven equal columns,
     Oscillator 5, Filter 3, Mod Sources 2, Global 1. What is left here is
     how a column fills its height. */
  .strip-row {
    height: var(--height-touch);
    min-width: 0;
  }
  /* A column of knobs sharing its height evenly. */
  .knob-stack {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }
  .knob-stack > :global(*) {
    flex: 1 1 0;
    min-height: 0;
  }
  /* Four small knobs to a column: a tighter gap, so each cell holds 48px. */
  .env-stack {
    gap: 0.25rem;
  }
  .knob-cell {
    height: 100%;
  }
  /* The oscillator: the pill and the wave across its three columns, the
     knobs one a column under them, tall enough for a medium knob and its
     name (70 + 50). */
  .osc-card {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: auto minmax(0, 1fr) 7.5rem;
    row-gap: var(--central-gap);
    min-width: 0;
    min-height: 0;
  }
  /* The filter: the pad, then the type, then the routing beside the slope. */
  .flt-card {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: minmax(0, 1fr) auto auto;
    row-gap: var(--central-gap);
    min-width: 0;
    min-height: 0;
  }
  .span-all {
    grid-column: 1 / -1;
    min-width: 0;
  }
  .face-span-2 {
    grid-column: span 2;
  }
  .wave-well {
    position: relative;
    min-height: 0;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--surface-well);
    overflow: hidden;
  }
  /* The mod sources' name line: each envelope's name over its column, the
     whole line one link to the sources' page. */
  .mod-link {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: var(--face-gutter, 0.5rem);
    width: 100%;
    background: none;
    border: 0;
    padding: 0;
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1rem;
    white-space: nowrap;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  :global([data-grammar='flat']) .mod-link {
    font-weight: var(--font-weight-medium);
  }

  /* The type and slope of a filter that is off. */
  .ghost-row {
    opacity: var(--opacity-ghost);
  }
</style>
