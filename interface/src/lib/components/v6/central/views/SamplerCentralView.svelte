<script lang="ts">
  /**
   * Sampler Central View — the Sampler row (`SamplerControlsRow`) on
   * one Sampler, with Gain and a Filter pad, beside the pitch and mod
   * wheels. Laid out on the Drum Rack's Sampler-kit cells (2026-09-27,
   * user's call: the same muscle memory in both): Gain · Trnsp · Spread
   * under the swap pill, then Osc over Pitch · the amp envelope · Filter.
   *
   * Parameters are resolved by NAME off the device's own list
   * (`SAMPLER_ROW_PARAM_NAMES`, the names the surface binds on a kit
   * pad), never by index: a real Sampler's indices are fixed, but the
   * 43-parameter variant lists fewer, and a name survives both. A
   * control whose parameter is not listed — a section never enabled
   * since load lists only its switch — is dimmed unless it has a
   * switch to turn on; writing the amount writes the switch first (the
   * oscillator's on above 1/127 of travel and off at the floor, the
   * pitch envelope's always on — its floor is −48 st), and the surface's
   * parameters listener refreshes the list once the section appears.
   * Every 0..1 control maps through the parameter's own LOM range
   * (`paramRange`); Trnsp writes whole semitones.
   *
   * Gain and Filter bind the names the surface binds on a kit's Sampler
   * pad, read off a running Sampler (2026-09-27, the 70-parameter
   * variant): `Volume` −36..36 dB, `F On`, `Filter Freq` 0..1, `Filter
   * Res` 0..1.25. The filter's switch turns on with a write and never off,
   * as on a kit: cutoff at the floor with the filter on is silence, and
   * switching it off there would open it wide instead.
   */
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import SamplerControlsRow from './SamplerControlsRow.svelte';
  import VmSlot from './drum/VmSlot.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import MidiWheel from '../../midi/MidiWheel.svelte';
  import { send } from '$lib/api/simpleClient';
  import { sendPitchWheel, sendModWheel } from '$lib/api/midiWheels';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { PITCH_COLOR, MOD_COLOR, familyScheme } from '$lib/config/devicePresets';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import {
    SAMPLER_ROW_PARAM_NAMES,
    SAMPLER_ROW_SECTION_SWITCH,
    SAMPLER_ROW_SWITCH_OFF_AT_FLOOR,
    SECTION_SWITCH_ON_ABOVE,
    type SamplerRowControl,
    type VmState
  } from '$lib/services/drumVirtualMacros';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);

  // PR-4a-6a1: path-keyed device lookup (v3 tree, chain-order indexed).
  // Returns `undefined` on cold start — same "show ghost" posture as
  // the v2 .find() it replaces.
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);

  // rackVoice rose (sound-source family, ADR-400) — deliberately distinct
  // from Simpler's chartreuse/teal mode pair so the two sample views differ.
  const samplerColor = familyScheme('rackVoice');

  // GRATICULE (§5.5): normalize the per-section palette through trackInk at injection.
  let trackScheme = $derived(selectedTrackScheme());
  let samplerInk = $derived(trackScheme ?? {
    primary: trackInk(samplerColor.primary, paintModeReactive()),
    secondary: samplerColor.secondary,
    accent: trackInk(samplerColor.accent, paintModeReactive())
  });

  // MIDI wheel colors (match other central views)
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

  const CONTROLS = Object.keys(SAMPLER_ROW_PARAM_NAMES) as SamplerRowControl[];

  // The device's parameter names, first index per name (the store's
  // list is re-derived on every tree mutation, so a section that
  // appears after its switch is written shows up here on its own).
  let names = $derived(device ? selectedTrackStore.paramNamesForDevice(device) : []);
  let indexByName = $derived.by(() => {
    const m = new Map<string, number>();
    names.forEach((name, i) => {
      if (!m.has(name)) m.set(name, i);
    });
    return m;
  });

  function pathOf(name: string | undefined): string | undefined {
    if (!device || !name) return undefined;
    const i = indexByName.get(name);
    return i === undefined ? undefined : selectedTrackStore.paramPath(device, i);
  }

  // A parameter's value as a control wants it: `t` through the parameter's
  // own range, or raw (Trnsp's semitones); `undefined` (at rest) when unlisted.
  function valueAt(name: string | undefined, raw = false): number | undefined {
    const path = pathOf(name);
    if (!path) return undefined;
    const v = selectedTrackStore.paramValueArmed(path);
    if (v === undefined) return undefined;
    if (raw) return v;
    const range = selectedTrackStore.paramRange(path);
    if (!range || range.max <= range.min) return undefined;
    return Math.max(0, Math.min(1, (v - range.min) / (range.max - range.min)));
  }

  function stateAt(name: string, switchName?: string): VmState {
    if (pathOf(name)) return 'live';
    // The amount is not listed but its section switch is: live, the
    // first write turns the section on.
    return pathOf(switchName) ? 'live' : 'none';
  }

  /** Writes `value` (`t`, or raw) to `name`, its section switch first. */
  function writeAt(name: string, value: number, opts: { switchName?: string; offAtFloor?: boolean; raw?: boolean } = {}) {
    if (!device) return;
    const switchPath = pathOf(opts.switchName);
    if (switchPath) {
      const off = opts.offAtFloor === true && value <= SECTION_SWITCH_ON_ABOVE;
      selectedTrackStore.setParamValue(switchPath, off ? 0 : 1);
    }
    const path = pathOf(name);
    if (!path) return;
    if (opts.raw) {
      selectedTrackStore.setParamValue(path, value);
      return;
    }
    const range = selectedTrackStore.paramRange(path);
    if (!range || range.max <= range.min) return;
    selectedTrackStore.setParamValue(path, range.min + value * (range.max - range.min));
  }

  let values = $derived(
    Object.fromEntries(CONTROLS.map((c) => [c, valueAt(SAMPLER_ROW_PARAM_NAMES[c], c === 'pitch')])) as Partial<Record<SamplerRowControl, number>>
  );
  let states = $derived(
    Object.fromEntries(CONTROLS.map((c) => [c, stateAt(SAMPLER_ROW_PARAM_NAMES[c], SAMPLER_ROW_SECTION_SWITCH[c])])) as Partial<Record<SamplerRowControl, VmState>>
  );

  function write(control: SamplerRowControl, value: number) {
    // The oscillator's switch follows its amount; the pitch envelope's
    // amount is bipolar (its floor is −48 st), so that switch only turns on.
    writeAt(SAMPLER_ROW_PARAM_NAMES[control], control === 'pitch' ? Math.round(value) : value, {
      switchName: SAMPLER_ROW_SECTION_SWITCH[control],
      offAtFloor: SAMPLER_ROW_SWITCH_OFF_AT_FLOOR.has(control),
      raw: control === 'pitch'
    });
  }

  const GAIN = 'Volume';
  const FILTER_ON = 'F On';
  const FILTER_FREQ = 'Filter Freq';
  const FILTER_RES = 'Filter Res';
  let gainState = $derived(stateAt(GAIN));
  let filterState = $derived(stateAt(FILTER_FREQ, FILTER_ON));

  // MIDI wheel handlers (global CCs — same path as Operator/Omnisphere views)
  function handlePitchChange(value: number) {
    sendPitchWheel(value);
  }

  function handleModChange(value: number) {
    sendModWheel(value);
  }
</script>

<div class="h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <!-- Layout: the Sampler's controls (fill) | MIDI wheels. The wheels send
         MIDI, not Sampler parameters, so a seam divides them from the device
         the way Drift's and Wavetable's do (2026-09-13). The inset is all
         here (--central-inset): the row used to carry p-2 of its own and the
         wheels py-2 to match it, which left the seam 16px from Trnsp and
         8px from Pitch (measured, 2026-09-14). -->
    <div class="h-full w-full grid gap-(--central-gap) p-(--central-inset)" style="grid-template-columns: 1fr auto auto auto;">
      <!-- The Sampler kit's cells (see `.sampler-grid`); the row names its own. -->
      <div class="sampler-grid min-w-0 h-full">
        <div class="sampler-pill">
          <HostedSwapPill />
        </div>
        <VmSlot state={gainState} class="sampler-gain flex flex-col min-w-0" fn="gain">
          <DeviceSlider
            value={valueAt(GAIN) ?? 0.5}
            labelOrientation="horizontal"
            title="Gain"
            color={samplerInk}
            isGhost={gainState === 'none'}
            onInteraction={(value) => writeAt(GAIN, value)}
          />
        </VmSlot>
        <SamplerControlsRow {values} {states} color={samplerInk} onWrite={write} />
        <!-- Cutoff across, resonance up, as on a kit. -->
        <VmSlot state={filterState} class="sampler-filter min-w-0 h-full" fn="filterFreq|filterRes">
          <DeviceXY
            xValue={valueAt(FILTER_FREQ) ?? 1}
            yValue={valueAt(FILTER_RES) ?? 0}
            title="Filter"
            color={samplerInk}
            isGhost={filterState === 'none'}
            onInteraction={(x, y) => {
              writeAt(FILTER_FREQ, x, { switchName: FILTER_ON });
              writeAt(FILTER_RES, y);
            }}
          />
        </VmSlot>
      </div>
      <SectionDivider orientation="vertical" />
      <!-- MIDI wheels -->
      <div class="h-full w-24">
        <MidiWheel
          type="pitch"
          onInteraction={handlePitchChange}
          color={pitchInk}
        />
      </div>
      <div class="h-full w-24">
        <MidiWheel
          type="modwheel"
          onInteraction={handleModChange}
          color={modInk}
        />
      </div>
    </div>
  {:else}
    <!-- Default state when no Sampler present -->
    <DeviceEmptyState glyph="~" message="Load Sampler to access envelope controls" color={samplerInk.primary} />
  {/if}
</div>

<style>
  /* The Drum Rack's Sampler-kit cells, less the pads (2026-09-27): a slider
     1fr and a pad 2fr, so Gain, Trnsp and Spread sit under the swap pill
     and Osc / Pitch, the envelope and Filter run full height beside them.
     The envelope keeps all four stages here (a kit hides Decay and
     Sustain). The row is `display: contents` and its cells name themselves
     (`SamplerControlsRow`).
     The envelope's bracket is flattened onto this grid too — its two
     hairlines (`envl` / `envr`, 1px `auto` tracks) and the stages between
     them (four 1fr tracks) — so A, D, S and R are each exactly as wide as
     Gain (user, 2026-09-27). In one 4fr cell the hairlines and their gaps
     came out of the stages' share, ~8px off each. The kits keep the
     bracket in one cell: their columns are the DrumCell kit's, which
     keeps Filter on the same spot on every kit. */
  .sampler-grid {
    display: grid;
    gap: var(--central-gap);
    grid-template-columns:
      repeat(3, minmax(0, 1fr)) minmax(0, 2fr)
      auto repeat(4, minmax(0, 1fr)) auto
      minmax(0, 2fr);
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      'pill pill  pill   osc envl env env env env envr filter'
      'gain trnsp spread osc envl env env env env envr filter';
  }
  .sampler-grid :global(.sampler-row),
  .sampler-grid :global(.envelope-column) {
    display: contents;
  }
  .sampler-grid :global(.envelope-column > :first-child) {
    grid-area: envl;
  }
  .sampler-grid :global(.envelope-column > .envelope-group) {
    grid-area: env;
  }
  .sampler-grid :global(.envelope-column > :last-child) {
    grid-area: envr;
  }
  .sampler-pill {
    grid-area: pill;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .sampler-grid :global(.sampler-gain) {
    grid-area: gain;
  }
  .sampler-grid :global(.sampler-filter) {
    grid-area: filter;
  }
</style>
