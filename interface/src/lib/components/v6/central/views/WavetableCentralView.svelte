<script lang="ts">
  /**
   * WavetableCentralView — Ableton Wavetable (LOM class `InstrumentVector`).
   *
   * Layout: one oscillator card with Drift's OSC 1/2 switch (2026-10-22,
   * the user's call — it was a pad per oscillator), the filter with its
   * type and slope, the envelopes as Amp or Env 2 in one bracket, Time and
   * Global Mod Amount, then the pitch/mod wheels. The oscillator pad puts
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
  const FLT1_ON = 21;      // 'Flt 1 On'
  const FLT1_TYPE = 22;    // 'Flt 1 Type'
  const FLT1_SLOPE = 25;   // 'Flt 1 Slope'
  const FLT1_FREQ = 26;    // 'Flt 1 Freq'   0..1
  const FLT1_RES = 27;     // 'Flt 1 Res'    0..1
  const FLT1_MORPH = 29;   // 'Flt 1 Morph'  0..1
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

  /**
   * Which oscillator the card is showing. View state only, as on Drift: it
   * writes nothing, so a patch change never takes the card away mid-edit.
   */
  let oscTab = $state<OscN>(1);
  let o = $derived(OSC[oscTab]);

  // All parameter values as $derived - always reactive to store changes (ADR-149)
  let oscPosition = $derived(read(o.position, 0.5));
  let oscEffect2 = $derived(read(o.effect2, 0));
  let oscGain = $derived(read(o.gain, 1));
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

  // Filter 1: cutoff across, resonance up, its response drawn beneath.
  // Like Osc 2, a drag on the pad switches it on.
  let flt1On = $derived(read(FLT1_ON, 1) >= 0.5);
  let flt1Freq = $derived(read(FLT1_FREQ, 1));
  let flt1Res = $derived(read(FLT1_RES, 0));
  let flt1Type = $derived(Math.round(read(FLT1_TYPE, 0)));
  let flt1Slope = $derived(Math.round(read(FLT1_SLOPE, 0)));
  let flt1Curve = $derived(liveFilterCurve(flt1Type, flt1Slope, read(FLT1_MORPH, 0)));

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

  let time = $derived(read(TIME, 0.5));
  let globalMod = $derived(read(GLOBAL_MOD, 0.5));

  let oscWaveCycle = $derived(oscWave(oscTab, oscPosition, read(o.effect1, 0.5), oscEffect2));

  let envView = $state<'amp' | 'env2'>('amp');
  let envStages = $derived(envView === 'amp' ? ENVELOPE : ENV2);
  let envelopeValues = $derived(
    envStages.map((stage) => {
      const { min, max } = rangeOf(stage.index, stage.fallback);
      return norm(read(stage.index, stage.atRest), min, max);
    })
  );

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
  let oscInk = $derived.by(() => {
    const raw = OSC_COLORS[oscTab];
    const mode = paintModeReactive();
    return { primary: trackInk(raw.primary, mode), secondary: raw.secondary, accent: trackInk(raw.accent, mode) };
  });

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

  function handleOscXY(x: number, y: number) {
    writeOsc(o.effect2, x);
    writeOsc(o.position, y);
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

<div class="wt-root h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <div class="h-full w-full flex min-h-0 p-(--central-inset)" style="gap: var(--central-gap);">
      <!-- THE OSCILLATOR CARD, Drift's: the switch flips the card between
           Osc 1 and Osc 2 and the colour says which is up. The swap pill
           lies across its top (user's layout, 2026-09-16). -->
      <div class="osc-col flex-[1.2] min-w-0 min-h-0 flex flex-col gap-(--central-gap)">
        <HostedSwapPill />
        <div class="osc-head flex-none">
          <button
            class="osc-badge"
            style="--osc-badge-ink: {oscInk.primary};"
            aria-label="Osc {oscTab} of 2 — switch to Osc {oscTab === 1 ? 2 : 1}"
            onclick={() => (oscTab = oscTab === 1 ? 2 : 1)}
          >
            <span class="osc-badge-eyebrow">Osc</span>
            <span class="osc-badge-pair">
              <span class="osc-badge-n" class:on={oscTab === 1} class:silent={!osc1On}>1</span><span
                class="osc-badge-slash">/</span><span
                class="osc-badge-n" class:on={oscTab === 2} class:silent={!osc2On}>2</span>
            </span>
          </button>
          <div class="device-segmented strip-row flex-1 min-w-0" style="--btn-tint: {oscInk.primary}; grid-template-columns: repeat({OCTAVES.length}, 1fr);">
            {#each OCTAVES as n}
              <button
                class="device-segment strip-step"
                class:active={oscTransp === n * 12}
                aria-label="Osc {oscTab} octave {octaveLabel(n)}"
                aria-pressed={oscTransp === n * 12}
                onclick={() => writeOsc(o.transp, n * 12)}
              >{octaveLabel(n)}</button>
            {/each}
          </div>
        </div>
        <!-- Effect 2 (X) / Wave Position (Y), its wave drawn beneath. Ghosted
             while the oscillator is off; still draggable, and the drag turns
             it on. The parent blankets, `isGhost` dims only the pad body, so
             the title rides a single dim instead of two (DeviceXY). -->
        <div class="flex-1 min-h-0" style={oscOn ? '' : 'opacity: var(--opacity-ghost);'}>
          <DeviceXY
            xValue={oscEffect2}
            yValue={oscPosition}
            title="OSC {oscTab}"
            isGhost={!oscOn}
            onInteraction={handleOscXY}
            color={oscInk}
          >
            {#snippet background()}<WavetableWave cycle={oscWaveCycle} color={oscInk.primary} />{/snippet}
          </DeviceXY>
        </div>
        <div class="strip-row flex-none">
          <DeviceSlider
            value={oscGain}
            title="Gain"
            icon="gain"
            orientation="horizontal"
            labelSize="small"
            isGhost={!oscOn}
            color={oscInk}
            onInteraction={(v) => writeOsc(o.gain, v)}
          />
        </div>
      </div>

      <SectionDivider orientation="vertical" ink={wavetableInk.primary} />

      <!-- Filter 1: cutoff across, resonance up, its curve beneath, then its
           type and slope. Ghosted while the filter is off; a drag turns it on. -->
      <div class="filter-col flex-1 min-w-0 min-h-0 flex flex-col gap-(--central-gap)">
        <div class="flex-1 min-h-0" style={flt1On ? '' : 'opacity: var(--opacity-ghost);'}>
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
        <div class="device-segmented strip-row flex-none" style="--btn-tint: {wavetableInk.primary}; grid-template-columns: repeat({FILTER_TYPES.length}, 1fr);">
          {#each FILTER_TYPES as label, value}
            <button
              class="device-segment strip-step"
              class:active={flt1Type === value}
              aria-label="Filter {label}"
              aria-pressed={flt1Type === value}
              onclick={() => write(FLT1_TYPE, value)}
            >{label}</button>
          {/each}
        </div>
        <div class="device-segmented strip-row flex-none" style="--btn-tint: {wavetableInk.primary}; grid-template-columns: repeat(2, 1fr);">
          {#each ['12 dB', '24 dB'] as label, value}
            <button
              class="device-segment strip-step"
              class:active={flt1Slope === value}
              aria-label="Filter slope {label}"
              aria-pressed={flt1Slope === value}
              onclick={() => write(FLT1_SLOPE, value)}
            >{label}</button>
          {/each}
        </div>
      </div>

      <!-- The envelopes, Amp or Env 2 in one bracket, one slider a stage,
           A → D → S → R either way, so switching never moves the edges. -->
      <div class="env-col flex-none min-h-0 flex gap-(--central-gap)">
        <EnvelopeGroup ink={wavetableInk.primary} title={envView === 'amp' ? 'Amp Envelope' : 'Envelope 2'}>
          {#snippet header()}
            <div class="device-segmented env-switch flex-none" style="--btn-tint: {wavetableInk.primary};">
              {#each [['amp', 'Amp'], ['env2', 'Env 2']] as [key, label]}
                <button
                  class="device-segment strip-step"
                  class:active={envView === key}
                  aria-pressed={envView === key}
                  onclick={() => (envView = key as 'amp' | 'env2')}
                >{label}</button>
              {/each}
            </div>
          {/snippet}
          {#each envStages as stage, i (stage.index)}
            <div class="env-slider min-h-0 h-full">
              <DeviceSlider
                value={envelopeValues[i]}
                title={stage.title}
                icon={stage.icon}
                orientation="vertical"
                labelSize="small"
                color={wavetableInk}
                onInteraction={(value) => writeEnv(stage.index, stage.fallback, value)}
              />
            </div>
          {/each}
        </EnvelopeGroup>
      </div>

      <!-- Time and Global Mod Amount: the device-wide scalers of every
           envelope and LFO time and of the mod matrix. -->
      <div class="flex-none min-h-0 flex gap-(--central-gap)">
        <div class="env-slider min-h-0 h-full">
          <DeviceSlider
            value={time}
            title="Time"
            orientation="vertical"
            labelSize="small"
            centerOrigin
            centerValue={0.5}
            color={wavetableInk}
            onInteraction={(value) => write(TIME, value)}
          />
        </div>
        <div class="env-slider min-h-0 h-full">
          <DeviceSlider
            value={globalMod}
            title="Mod Amt"
            orientation="vertical"
            labelSize="small"
            color={wavetableInk}
            onInteraction={(value) => write(GLOBAL_MOD, value)}
          />
        </div>
      </div>

      <SectionDivider orientation="vertical" ink={wavetableInk.primary} />

      <div class="flex-none flex gap-(--central-gap) min-h-0">
        <div class="wheel-col h-full">
          <MidiWheel type="pitch" onInteraction={handlePitchChange} color={pitchInk} />
        </div>
        <div class="wheel-col h-full">
          <MidiWheel type="modwheel" onInteraction={handleModChange} color={modInk} />
        </div>
      </div>
    </div>
  {:else}
    <!-- Default state when no Wavetable present -->
    <DeviceEmptyState glyph="~" message="Load Wavetable to access controls" color={wavetableInk.primary} />
  {/if}
</div>

<style>
  .wt-root {
    --wt-slider-w: var(--height-touch);
    --wt-wheel-w: 56px;
  }

  .osc-head {
    display: flex;
    gap: var(--spacing-sm);
    height: var(--height-touch);
    min-width: 0;
  }

  .strip-row {
    height: var(--height-touch);
    min-width: 0;
  }
  .strip-row.device-segmented,
  .env-switch {
    display: grid;
  }
  .env-switch {
    grid-template-columns: repeat(2, 1fr);
    height: var(--height-touch);
  }
  .device-segmented .device-segment + .device-segment {
    border-top: 0;
    border-left: 1px solid var(--line-faint);
  }
  .device-segment.active,
  .device-segment.active + .device-segment {
    border-left-color: transparent;
  }
  .strip-step {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    min-width: 0;
    padding: 2px;
    font-size: 0.75rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* Four stages and their three gaps, plus the bracket's own two seams and
     the gap beside each — EnvelopeGroup draws them inside this column. */
  .env-col {
    width: calc(4 * var(--wt-slider-w) + 5 * var(--central-gap) + 2px);
  }
  .env-slider {
    flex: 0 0 var(--wt-slider-w);
    width: var(--wt-slider-w);
  }
  .wheel-col {
    width: var(--wt-wheel-w);
  }

  /* The OSC 1/2 switch: Drift's badge, a circle a touch row tall. */
  .osc-badge {
    flex: 0 0 auto;
    width: var(--height-touch);
    height: var(--height-touch);
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
    font-size: 14px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
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

  /* ---- Flat grammar: Drift's and Analog's segmented rows, the ink
     re-asserted against the house pair so the oscillator colour reads. */
  :global([data-grammar="flat"]) .wt-root .device-segmented .device-segment + .device-segment {
    border-top: 0;
    border-left: 1px solid var(--line-strong);
  }
  :global([data-grammar="flat"]) .wt-root .device-segment.active,
  :global([data-grammar="flat"]) .wt-root .device-segment.active + .device-segment {
    border-left-color: transparent;
  }
  :global([data-grammar="flat"]) .wt-root .device-segment {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
  :global([data-grammar="flat"]) .wt-root .device-segment:hover:not(.active) {
    color: var(--btn-tint);
    background: color-mix(in srgb, var(--btn-tint) 12%, transparent);
  }
  :global([data-grammar="flat"]) .wt-root .device-segment.active {
    background: var(--btn-tint);
    color: var(--flat-on-fg);
  }
</style>
