<script lang="ts">
  /**
   * Sampler Central View — the Sampler row (`SamplerControlsRow`) on
   * one Sampler, with Gain (the wheels left for the MidiWheels device's
   * chain cell, user, 2026-10-26). Laid out on the Drum Rack's
   * Sampler-kit cells (2026-09-27, user's call: the same muscle memory in
   * both), on the face grid since ADR-510: Gain over Trnsp and Spread
   * under the swap pill, then Osc over Pitch · the amp envelope's four
   * stages, eight equal columns. The Filter pad (cutoff across, resonance
   * up) is the chain cell's (`sampler` in deviceControls), drawn above
   * this view, so the view no longer draws it too (user, 2026-11-06); a
   * Sampler KIT in the Drum Rack keeps it, where no chain cell carries a
   * pad's Sampler.
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
   * Gain binds the name the surface binds on a kit's Sampler pad, read off
   * a running Sampler (2026-09-27, the 70-parameter variant): `Volume`
   * −36..36 dB.
   */
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import SamplerControlsRow from './SamplerControlsRow.svelte';
  import VmSlot from './drum/VmSlot.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { familyScheme } from '$lib/config/devicePresets';
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
  let gainState = $derived(stateAt(GAIN));

</script>

{#snippet pillSlot()}
  <HostedSwapPill />
{/snippet}

{#snippet gainSlot(knob = false)}
  <VmSlot state={gainState} class="sampler-gain flex flex-col min-w-0" fn="gain">
    <DeviceSlider
      value={valueAt(GAIN) ?? 0.5}
      labelOrientation="horizontal"
      title="Gain"
      icon="gain"
      face={knob ? 'knob' : 'slider'}
      knobSize="m"
      knobCaption={!knob}
      color={samplerInk}
      isGhost={gainState === 'none'}
      onInteraction={(value) => writeAt(GAIN, value)}
    />
  </VmSlot>
{/snippet}


<div class="h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <!-- The face (ADR-510): the Sampler kit's sections, less the pads,
         on one grid of equal columns — Global [Gain/Trnsp | Spread] under
         the swap pill · Pitch / Osc · Amp Envelope A D S R, eight
         columns (the Filter pad is the chain cell's). The face owns the inset (--central-inset); the row
         carries none of its own. The wheels left for the MidiWheels
         device's chain cell (user, 2026-10-26). -->
    <SamplerControlsRow
      {values}
      {states}
      color={samplerInk}
      hidden={['selector']}
      onWrite={write}
      kitTitle="Global"
      gain={gainSlot}
      lead={pillSlot}
    />
  {:else}
    <!-- Default state when no Sampler present -->
    <DeviceEmptyState glyph="~" message="Load Sampler to access envelope controls" color={samplerInk.primary} />
  {/if}
</div>
