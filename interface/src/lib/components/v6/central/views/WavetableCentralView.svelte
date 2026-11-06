<script lang="ts">
  /**
   * WavetableCentralView — Ableton Wavetable (LOM class `InstrumentVector`).
   *
   * Layout: one oscillator card, the oscillator picked by touching its level
   * box in the mixer (the OSC 1/2 switch went 2026-11-05; it was a pad per
   * oscillator before 2026-10-22), its octaves a column down the pad's left, the filter with its
   * type and slope, the envelopes as Amp or Env 2 in one bracket, Time and
   * Global Mod Amount. No pitch/mod wheels (user's call, 2026-10-22). The oscillator pad puts
   * **wave position on Y and Effect 2 on X** for both oscillators, so the
   * switch never changes what an axis means.
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
  import EnvelopeGroup from './EnvelopeGroup.svelte';
  import SectionDivider from '../SectionDivider.svelte';
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
  const SLOPES = ['12 dB', '24 dB'] as const;

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
   * Effect 1's name on Live's panel under each effect mode. The LOM calls it
   * "Osc N Effect 1" in every mode and AX describes it only as "Device"
   * (both read 2026-10-22), so the words are the panel's: Tune seen on the
   * rig in FM, PW and Warp from Live's manual. Mode None has no effect.
   */
  const EFFECT1_TITLES = { none: 'Fx 1', fm: 'Tune', classic: 'PW', modern: 'Warp' } as const;
  let oscEffectMode = $derived(oscWaves.effectMode(oscTab));

  let time = $derived(read(TIME, 0.5));
  let globalMod = $derived(read(GLOBAL_MOD, 0.5));

  let oscWaveCycle = $derived(oscWaves.wave(oscTab, oscPosition, read(o.effect1, 0.5), oscEffect2));

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
  function writeOsc(index: number, value: number) {
    if (!device) return;
    if (!oscOn) write(o.on, 1);
    write(index, value);
  }

  /** A level in the mixer: the same rule, for the oscillator it belongs to. */
  function writeLevel(n: OscN, value: number) {
    if (!device) return;
    if (!(n === 1 ? osc1On : osc2On)) write(OSC[n].on, 1);
    write(OSC[n].gain, value);
  }

  function handleOscXY(x: number, y: number) {
    writeOsc(o.effect2, x);
    writeOsc(o.position, y);
  }

  function moveFilter(n: 1 | 2, x: number, y: number) {
    if (!device) return;
    const p = FLT[n];
    if (!(n === 1 ? flt1On : flt2On)) write(p.on, 1);
    write(p.freq, x);
    write(p.res, y);
  }

  function stepFilterType(step: number) {
    const n = FILTER_TYPES.length;
    write(f.type, (((fltType + step) % n) + n) % n);
  }

  function writeEnv(index: number, fallback: { min: number; max: number }, value: number) {
    const { min, max } = rangeOf(index, fallback);
    write(index, denorm(value, min, max));
  }
</script>

<div class="wt-root h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <InstrumentPanelView panel={WAVETABLE_PANEL} params={panelParams} color={wavetableInk}>
    {#snippet face(openPage: (page: string) => void)}
    <div class="h-full w-full flex min-h-0 p-(--central-inset)" style="gap: var(--central-gap);">
      <!-- THE LEVELS, Drift's mixer reduced to its oscillators: Osc 1 over
           Osc 2 in one column at the view's left edge (user, 2026-10-22),
           each in its own colour, so balancing them never means switching
           the card. Value boxes (ADR-477): half a fader's height and as
           fine, which retired their half-speed drag. Touching a level
           brings its oscillator's card up. -->
      <div class="mixer-col flex-none min-h-0 flex">
        <div class="env-slider min-h-0 h-full flex flex-col gap-(--central-gap)">
          <PanelEyebrow color={wavetableInk.primary} />
          <div class="flex-1 min-h-0">
          <DeviceSlider
            value={osc1Gain}
            title="Osc 1"
            icon="oscillator"
            orientation="vertical"
            labelSize="small"
            isGhost={!osc1On}
            color={osc1Ink}
            readout={display(OSC[1].gain)}
            onDown={() => (oscTab = 1)}
            onInteraction={(v) => writeLevel(1, v)}
          />
          </div>
          <div class="flex-1 min-h-0">
          <DeviceSlider
            value={osc2Gain}
            title="Osc 2"
            icon="oscillator"
            orientation="vertical"
            labelSize="small"
            isGhost={!osc2On}
            color={osc2Ink}
            readout={display(OSC[2].gain)}
            onDown={() => (oscTab = 2)}
            onInteraction={(v) => writeLevel(2, v)}
          />
          </div>
        </div>
      </div>

      <!-- THE OSCILLATOR CARD, Drift's: the switch flips the card between
           Osc 1 and Osc 2 and the colour says which is up. The swap pill
           lies across its top (user's layout, 2026-09-16). -->
      <div class="osc-col flex-[1.2] min-w-0 min-h-0 flex flex-col gap-(--central-gap)">
        <PanelEyebrow title="Osc {oscTab}" page="osc{oscTab}" onOpen={openPage} color={oscInk.primary} />
        <HostedSwapPill />
        <!-- Effect 2 (X) / Wave Position (Y), its wave drawn beneath. Ghosted
             while the oscillator is off; still draggable, and the drag turns
             it on. The parent blankets, `isGhost` dims only the pad body, so
             the title rides a single dim instead of two (DeviceXY). -->
        <div class="flex-1 min-h-0 flex gap-(--central-gap)">
          <!-- The octaves, +2 at the top, one column down the pad's left
               (user, 2026-11-05). The mixer's level boxes pick the
               oscillator, so the card has no 1/2 switch. -->
          <div class="osc-side flex-none min-h-0 flex flex-col gap-(--central-gap)">
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
          <div class="flex-1 min-w-0 min-h-0" style={oscOn ? '' : 'opacity: var(--opacity-ghost);'}>
            <DeviceXY
              xValue={oscEffect2}
              yValue={oscPosition}
              title="OSC {oscTab}"
              titleAt="bottom"
              isGhost={!oscOn}
              onInteraction={handleOscXY}
              color={oscInk}
            >
              {#snippet background()}<WavetableWave cycle={oscWaveCycle} color={oscInk.primary} />{/snippet}
            </DeviceXY>
          </div>
          <!-- Effect 1 beside the pad, whose X is Effect 2. -->
          <div class="env-slider min-h-0 h-full">
            <DeviceSlider
              value={oscEffect1}
              title={EFFECT1_TITLES[oscEffectMode]}
              icon="shape"
              orientation="vertical"
              labelSize="small"
              isGhost={!oscOn || oscEffectMode === 'none'}
              color={oscInk}
              readout={display(o.effect1)}
              onInteraction={(v) => writeOsc(o.effect1, v)}
            />
          </div>
        </div>
      </div>

      <SectionDivider orientation="vertical" ink={wavetableInk.primary} />

      <!-- Both filters on one pad, a numbered dot each: cutoff across,
           resonance up, Serial one curve and Parallel / Split two (Live's
           panel, 2026-11-05). The routing under it, then the type and
           slope of the filter last touched, in its ink. -->
      <div class="filter-col flex-1 min-w-0 min-h-0 flex flex-col gap-(--central-gap)">
        <PanelEyebrow title="Filter {fltTab}" page="filter{fltTab}" onOpen={openPage} color={fltInk.primary} />
        <div class="flex-1 min-h-0">
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
        <div class="strip-row flex-none">
        <ScrubTabs
              inked
          options={FILTER_ROUTINGS}
          selected={filterRouting}
          onSelect={(i) => writeRouting(i)}
          tint={wavetableInk.primary}
          label={(r) => `Filter routing ${r}`}
          class="h-full"
        >
          {#snippet item(r)}{r}{/snippet}
        </ScrubTabs>
        </div>
        <!-- ‹ type › beside the slope, one row (Meld's chooser): the
             graph keeps the height the routing row took. -->
        <div class="flt-row strip-row flex-none" class:ghost-row={!fltOn}>
          <div class="type-stepper stepper strip-row min-w-0" style="--btn-tint: {fltInk.primary};">
            <button class="type-step" aria-label="Previous filter type" onclick={() => stepFilterType(-1)}>‹</button>
            <span class="type-stepper-name" aria-live="polite">{FILTER_TYPES[fltType] ?? '—'}</span>
            <button class="type-step" aria-label="Next filter type" onclick={() => stepFilterType(1)}>›</button>
          </div>
          <ScrubTabs
              inked
            options={SLOPES}
            selected={fltSlope}
            onSelect={(i) => write(f.slope, i)}
            tint={fltInk.primary}
            label={(l) => `Filter slope ${l}`}
            class="h-full"
            >
            {#snippet item(l)}{l}{/snippet}
          </ScrubTabs>
        </div>
      </div>

      <!-- The two envelopes, Amp over Envelope 2, one box a stage, A → D →
           S → R (ADR-477): both in view, so there is no switch, each box
           half a fader's height and as fine. One bracket, a seam between. -->
      <div class="env-col flex-none min-h-0 flex gap-(--central-gap)">
        <SectionDivider orientation="vertical" ink={wavetableInk.primary} />
        <div class="flex-1 min-w-0 min-h-0 flex flex-col gap-(--central-gap)">
          <PanelEyebrow title="Mod Sources" page="mod" onOpen={openPage} color={wavetableInk.primary} />
          {#each ENVELOPES as envelope, e (envelope.title)}
            {#if e > 0}<SectionDivider orientation="horizontal" ink={wavetableInk.primary} />{/if}
            <EnvelopeGroup ink={wavetableInk.primary} title={envelope.title} edges="none">
              {#each envelope.stages as stage (stage.index)}
                <div class="env-slider min-h-0 h-full">
                  <DeviceSlider
                    value={envelopeValue(stage)}
                    title={stage.title}
                    icon={stage.icon}
                    orientation="vertical"
                    labelSize="small"
                    color={wavetableInk}
                    readout={display(stage.index)}
                    onInteraction={(value) => writeEnv(stage.index, stage.fallback, value)}
                  />
                </div>
              {/each}
            </EnvelopeGroup>
          {/each}
        </div>
        <SectionDivider orientation="vertical" ink={wavetableInk.primary} />
      </div>

      <!-- Time over Global Mod Amount: the device-wide scalers of every
           envelope and LFO time and of the mod matrix, two knobs in one
           column (ADR-509). -->
      <div class="scaler-col flex-none min-h-0 flex flex-col gap-(--central-gap)">
        <PanelEyebrow title="Global" page="global" onOpen={openPage} color={wavetableInk.primary} />
        <div class="flex-1 min-h-0">
          <DeviceSlider
            value={time}
            title="Time"
            face="knob"
            knobSize="l"
            orientation="vertical"
            labelSize="small"
            centerOrigin
            centerValue={0.5}
            color={wavetableInk}
            readout={display(TIME)}
            onInteraction={(value) => write(TIME, value)}
          />
        </div>
        <div class="flex-1 min-h-0">
          <DeviceSlider
            value={globalMod}
            title="Mod Amt"
            face="knob"
            knobSize="l"
            orientation="vertical"
            labelSize="small"
            color={wavetableInk}
            readout={display(GLOBAL_MOD)}
            onInteraction={(value) => write(GLOBAL_MOD, value)}
          />
        </div>
      </div>
    </div>
    {/snippet}
    </InstrumentPanelView>
  {:else}
    <!-- Default state when no Wavetable present -->
    <DeviceEmptyState glyph="~" message="Load Wavetable to access controls" color={wavetableInk.primary} />
  {/if}
</div>

<style>
  .wt-root {
    --wt-slider-w: var(--height-touch);
  }

  /* The octave column, a touch row wide. */
  .osc-side {
    width: var(--height-touch);
  }

  .strip-row {
    height: var(--height-touch);
    min-width: 0;
  }

  /* Four stages and their three gaps, plus the bracket's two seams and the
     gap beside each, all drawn inside this column. */
  .env-col {
    width: calc(4 * var(--wt-slider-w) + 5 * var(--central-gap) + 2px);
  }
  .env-slider {
    flex: 0 0 var(--wt-slider-w);
    width: var(--wt-slider-w);
  }
  /* One `.stepper` (app.css): ‹ type › in a single frame. */
  .type-stepper {
    --stepper-arrow: var(--height-touch);
  }
  .type-step {
    font-size: 1.125rem;
    font-weight: 600;
  }
  .type-stepper-name {
    text-align: center;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--btn-tint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* One column, Osc 1 over Osc 2; the width is for WebKit, as Drift's.
     Time over Mod Amt is the same. */
  .mixer-col {
    width: var(--wt-slider-w);
  }
  /* Time over Mod Amt as knobs (ADR-509): two slider widths and a gap. */
  .scaler-col {
    width: calc(2 * var(--wt-slider-w) + var(--central-gap));
  }

  .flt-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--central-gap);
  }

  /* The type and slope of a filter that is off. */
  .ghost-row {
    opacity: var(--opacity-ghost);
  }
</style>
