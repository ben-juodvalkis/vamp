<script lang="ts">
  /**
   * WavetableCentralView — Ableton Wavetable (LOM class `InstrumentVector`).
   *
   * Layout: one XY pad per oscillator, then the amp envelope as four
   * sliders in ADSR order, then the pitch/mod wheels. (The envelope was a
   * Time pad — Attack across, Release up — until 2026-09-12; it reached
   * neither Decay nor Sustain.) Each oscillator pad puts **wave position on Y and
   * Effect 2 on X**, so the two pads are the same gesture twice and the
   * hand doesn't have to relearn an axis between them.
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
  import { liveFilterCurve, FILTER_FREQ_RANGE } from '$lib/utils/instrumentFilterCurves';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import MidiWheel from '../../midi/MidiWheel.svelte';
  import { sendPitchWheel, sendModWheel } from '$lib/api/midiWheels';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { PITCH_COLOR, MOD_COLOR } from '$lib/config/devicePresets';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import WavetableWave from './wavetable/WavetableWave.svelte';
  import { loadFactoryWavetables, tableFrames, cycleAt, type WavetableBundle } from '$lib/utils/wavetableShapes';
  import { applyOscEffect, effectModeFromLive } from '$lib/utils/wavetableEffects';

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
  const OSC1_POSITION = 4;
  const OSC1_EFFECT1 = 5;  // 'Osc 1 Effect 1'  0..1, 0.5 = 0 %
  const OSC1_EFFECT2 = 6;
  const OSC2_ON = 9;
  const OSC2_POSITION = 12;
  const OSC2_EFFECT1 = 13; // 'Osc 2 Effect 1'
  const OSC2_EFFECT2 = 14;

  // Filter 1, read off the running device 2026-10-22 (Live 12.4.15):
  // Freq 20 Hz..20.5 kHz on a log sweep, Res 0..1 (Live's 0..125 %),
  // Type 0..4 Lowpass/Highpass/Bandpass/Notch/Morph, Slope 12/24.
  const FLT1_ON = 21;      // 'Flt 1 On'
  const FLT1_TYPE = 22;    // 'Flt 1 Type'
  const FLT1_SLOPE = 25;   // 'Flt 1 Slope'
  const FLT1_FREQ = 26;    // 'Flt 1 Freq'   0..1
  const FLT1_RES = 27;     // 'Flt 1 Res'    0..1
  const FLT1_MORPH = 29;   // 'Flt 1 Morph'  0..1

  // The amp envelope, four sliders in ADSR order (user's call and user's
  // indices, 2026-09-12). It was an XY pad reading Attack across and
  // Release up, which reached neither Decay nor Sustain.
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

  // All parameter values as $derived - always reactive to store changes (ADR-149)
  let osc1Position = $derived(read(OSC1_POSITION, 0.5));
  let osc1Effect2 = $derived(read(OSC1_EFFECT2, 0));
  let osc2Position = $derived(read(OSC2_POSITION, 0.5));
  let osc2Effect2 = $derived(read(OSC2_EFFECT2, 0));

  // Osc 2 ships OFF in the default preset, so the pad is ghosted until it is
  // switched on. Read through the armed reader: our own on-write un-ghosts
  // the pad on the same frame rather than waiting for the surface's echo,
  // so the dot doesn't drag under a dashed border.
  let osc2On = $derived(read(OSC2_ON, 0) >= 0.5);

  // Filter 1: cutoff across, resonance up, its response drawn beneath.
  // Like Osc 2, a drag on the pad switches it on.
  let flt1On = $derived(read(FLT1_ON, 1) >= 0.5);
  let flt1Freq = $derived(read(FLT1_FREQ, 1));
  let flt1Res = $derived(read(FLT1_RES, 0));
  let flt1Curve = $derived(liveFilterCurve(read(FLT1_TYPE, 0), read(FLT1_SLOPE, 0), read(FLT1_MORPH, 0)));

  // ===== The oscillators' waves =====
  let devicePath = $derived(device?.devicePath);
  const OSC_PROPERTIES = [1, 2].flatMap((n) => [
    `oscillator_${n}_wavetable_category`,
    `oscillator_${n}_wavetable_index`,
    `oscillator_${n}_wavetables`,
    `oscillator_${n}_effect_mode`
  ]).concat('oscillator_wavetable_categories');

  $effect(() => {
    const path = devicePath;
    if (!path) return;
    const releases = OSC_PROPERTIES.map((name) => selectedTrackStore.subscribeProperty(path, name));
    return () => releases.forEach((release) => release());
  });

  let shapes = $state<WavetableBundle | null>(null);
  $effect(() => {
    if (!devicePath || shapes) return;
    let live = true;
    loadFactoryWavetables().then((bundle) => {
      if (live) shapes = bundle;
    });
    return () => {
      live = false;
    };
  });

  function property(name: string): unknown {
    return devicePath ? selectedTrackStore.propertyValue(devicePath, name) : undefined;
  }

  /** A JSON-string property (Live's name lists) as an array of names. */
  function nameList(name: string): string[] {
    const value = property(name);
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** One cycle of oscillator `n` as it plays, or null when its table has no render. */
  function oscWave(n: 1 | 2, position: number, effect1: number, effect2: number): Float32Array | null {
    if (!shapes) return null;
    const category = nameList('oscillator_wavetable_categories')[Number(property(`oscillator_${n}_wavetable_category`))];
    const table = nameList(`oscillator_${n}_wavetables`)[Number(property(`oscillator_${n}_wavetable_index`))];
    if (!category || !table) return null;
    const cycle = cycleAt(tableFrames(shapes, category, table), position);
    if (!cycle) return null;
    const mode = effectModeFromLive(Number(property(`oscillator_${n}_effect_mode`) ?? 0));
    return mode === 'none' ? cycle : applyOscEffect(cycle, mode, effect1, effect2);
  }

  let osc1Wave = $derived(oscWave(1, osc1Position, read(OSC1_EFFECT1, 0.5), osc1Effect2));
  let osc2Wave = $derived(oscWave(2, osc2Position, read(OSC2_EFFECT1, 0.5), osc2Effect2));

  let envelopeValues = $derived(
    ENVELOPE.map((stage) => {
      const { min, max } = rangeOf(stage.index, stage.fallback);
      return norm(read(stage.index, stage.atRest), min, max);
    })
  );

  // ===== Colors =====
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

  // MIDI wheel colors (shared across central views)
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

  // ===== Handlers =====
  // XY interaction handlers - just send to store, control component handles local state
  function handleOsc1XY(x: number, y: number) {
    write(OSC1_EFFECT2, x);
    write(OSC1_POSITION, y);
  }

  function handleOsc2XY(x: number, y: number) {
    if (!device) return;
    // Reaching for Osc 2's pad IS the request to hear it. A pad that moves a
    // silent oscillator is a dead control, so the first drag switches it on
    // and the ghost lifts under the finger.
    if (!osc2On) write(OSC2_ON, 1);
    write(OSC2_EFFECT2, x);
    write(OSC2_POSITION, y);
  }

  function handleFilterXY(x: number, y: number) {
    if (!device) return;
    if (!flt1On) write(FLT1_ON, 1);
    write(FLT1_FREQ, x);
    write(FLT1_RES, y);
  }

  function writeEnv(index: number, fallback: { min: number; max: number }, value: number) {
    const { min, max } = rangeOf(index, fallback);
    write(index, denorm(value, min, max));
  }

  // MIDI wheel handlers
  function handlePitchChange(value: number) {
    sendPitchWheel(value);
  }

  function handleModChange(value: number) {
    sendModWheel(value);
  }
</script>

<div class="h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <!-- Layout: OSC 1 XY + OSC 2 XY + Time XY + MIDI wheels -->
    <div class="wt-root h-full w-full grid">
      <!-- OSC 1: Effect 2 (X) / Wave Position (Y), with the swap pill lying
           across the top of its column (user's layout, 2026-09-16) — which
           makes it one pill shorter than OSC 2 beside it. -->
      <div class="h-full w-full min-w-0 min-h-0 flex flex-col gap-(--central-gap)">
        <HostedSwapPill />
        <div class="flex-1 min-h-0">
          <DeviceXY
            xValue={osc1Effect2}
            yValue={osc1Position}
            title="OSC 1"
            icon="oscillator"
            onInteraction={handleOsc1XY}
            color={wavetableInk}
          >
            {#snippet background()}<WavetableWave cycle={osc1Wave} color={wavetableInk.primary} />{/snippet}
          </DeviceXY>
        </div>
      </div>

      <!-- OSC 2: Effect 2 (X) / Wave Position (Y). Ghosted while the
           oscillator is off; still draggable, and the drag turns it on.
           Same shape as UtilityCentralView's sidechain wrapper — the device
           is loaded, one section's on/off param is not — and the dim splits
           the way DeviceXY documents: the parent blankets, `isGhost` dims
           only the pad body, so the title rides a single dim instead of two.
           Opacity does not block the pointer, so the pad stays draggable
           through the ghost, which is what turns Osc 2 on. -->
      <div class="h-full w-full min-w-0" style={osc2On ? '' : 'opacity: var(--opacity-ghost);'}>
        <DeviceXY
          xValue={osc2Effect2}
          yValue={osc2Position}
          title="OSC 2"
          icon="oscillator"
          isGhost={!osc2On}
          onInteraction={handleOsc2XY}
          color={wavetableInk}
        >
          {#snippet background()}<WavetableWave cycle={osc2Wave} color={wavetableInk.primary} />{/snippet}
        </DeviceXY>
      </div>

      <!-- Filter 1: cutoff across, resonance up, its curve beneath.
           Ghosted while the filter is off; a drag turns it on. -->
      <div class="h-full w-full min-w-0" style={flt1On ? '' : 'opacity: var(--opacity-ghost);'}>
        <DeviceXY
          xValue={flt1Freq}
          yValue={flt1Res}
          title="Filter"
          isGhost={!flt1On}
          showCurve={flt1On}
          curveType={flt1Curve.curveType}
          curveOrder={flt1Curve.order}
          curveFreqRange={FILTER_FREQ_RANGE.wavetable}
          onInteraction={handleFilterXY}
          color={wavetableInk}
        />
      </div>

      <!-- The amp envelope, one slider a stage, reading A → D → S → R,
           bracketed by a named hairline either side. The four share the
           column the Time pad used to own, so OSC 1 and OSC 2 keep their
           size and the wheels keep theirs. Both hairlines live INSIDE this
           cell, so its gap must be the grid's (both --central-gap, ADR-434): at 8px, each sat 8px
           from the stages and 16px from OSC 2 / Pitch (measured, 2026-09-14). -->
      <div class="min-w-0 min-h-0 h-full flex gap-(--central-gap)">
        <EnvelopeGroup ink={wavetableInk.primary}>
          {#each ENVELOPE as stage, i}
            <div class="min-w-0 h-full flex-1">
              <DeviceSlider
                value={envelopeValues[i]}
                title={stage.title}
                icon={stage.icon}
                orientation="vertical"
                labelOrientation="horizontal"
                color={wavetableInk}
                onInteraction={(value) => writeEnv(stage.index, stage.fallback, value)}
              />
            </div>
          {/each}
        </EnvelopeGroup>
      </div>

      <!-- MIDI Wheels (pitch + mod) -->
      <div class="wt-wheels flex min-h-0">
        <div class="w-24 h-full">
          <MidiWheel
            type="pitch"
            onInteraction={handlePitchChange}
            color={pitchInk}
          />
        </div>
        <div class="w-24 h-full">
          <MidiWheel
            type="modwheel"
            onInteraction={handleModChange}
            color={modInk}
          />
        </div>
      </div>
    </div>
  {:else}
    <!-- Default state when no Wavetable present -->
    <DeviceEmptyState glyph="~" message="Load Wavetable to access controls" color={wavetableInk.primary} />
  {/if}
</div>

<style>
  /* OSC 1, OSC 2, Filter and the envelope at equal widths, then the fixed
     wheel pair. OSC 1 and OSC 2 are the same size — they are the same
     control twice and an asymmetry would read as a hierarchy that isn't there. */
  .wt-root {
    grid-template-columns: 1fr 1fr 1fr 1fr auto;
    gap: var(--central-gap);
    padding: var(--central-inset);
  }

  .wt-wheels {
    gap: var(--central-gap);
  }

</style>
