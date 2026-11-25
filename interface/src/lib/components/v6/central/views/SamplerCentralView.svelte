<script lang="ts">
  /**
   * Sampler Central View — the Sampler row (`SamplerControlsRow`) on
   * one Sampler, with Gain (the wheels left for the MidiWheels device's
   * chain cell, user, 2026-10-26). Laid out on the Drum Rack's
   * Sampler-kit cells (2026-09-27, user's call: the same muscle memory in
   * both), on the face grid since ADR-510, eight equal columns: Global
   * (Trnsp, the played amount, a box; Gain over Spread, set and left, two
   * knobs of one size with their names beside them) under the swap pill ·
   * Osc over Pitch · the amp envelope as one Time pad, Ve Attack across
   * and Ve Release up (ADR-546; its picture and four stages are on the
   * full-screen board). The Filter pad (cutoff across, resonance
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
  import EnvelopeGraph from '../EnvelopeGraph.svelte';
  import { usePanelParams } from './panel/usePanelParams.svelte';
  import VmSlot from './drum/VmSlot.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { familyScheme } from '$lib/config/devicePresets';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import InstrumentPanelView from './panel/InstrumentPanelView.svelte';
  import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
  import { SAMPLER_PANEL, sampleEnvelope } from './panel/samplePanels';
  import { liveFilterCurve, FILTER_FREQ_RANGE } from '$lib/utils/instrumentFilterCurves';
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


  // PR-4a-6a1: path-keyed device lookup (v3 tree, chain-order indexed).
  // Returns `undefined` on cold start — same "show ghost" posture as
  // the v2 .find() it replaces.
  let device = $derived(selectedTrackStore.instrumentDevice(instrument));
  /** The device's parameters by name, for the amp envelope's graph (ADR-514). */
  const params = usePanelParams(() => device);

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

  // A parameter's path by name (`params`, above: the store's list is
  // re-derived on every tree mutation, so a section that appears after its
  // switch is written shows up here on its own).
  const pathOf = (name: string | undefined) => (name ? params.pathOf(name) : undefined);

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

  // The amp envelope by Live's names: the compact face's Time pad reads
  // Attack and Release (ADR-546); the board's graph reads them all.
  const AMP_ENVELOPE = { attack: 'Ve Attack', decay: 'Ve Decay', sustain: 'Ve Sustain', release: 'Ve Release', initial: 'Ve Init', peak: 'Ve Peak' } as const;
  let gainState = $derived(stateAt(GAIN));

  // The full-screen board (ADR-521): the filter's pad and curve.
  let filterCurve = $derived(
    liveFilterCurve(params.raw('Filter Type') ?? 0, params.raw('Filter Slope') ?? 1, params.raw('Filter Morph') ?? 0)
  );

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
      color={samplerInk}
      isGhost={gainState === 'none'}
      onInteraction={(value) => writeAt(GAIN, value)}
    />
  </VmSlot>
{/snippet}

{#snippet ampEnvelope()}
  <!-- The amp envelope as one Time pad (ADR-546): Ve Attack across, Ve
       Release up, over each parameter's own range. Its picture and all
       four stages are on the full-screen board. -->
  <div class="amp-pad" data-time-pad data-envelope="Amp">
    <DeviceXY
      xValue={params.unit(AMP_ENVELOPE.attack) ?? 0}
      yValue={params.unit(AMP_ENVELOPE.release) ?? 0.5}
      title="Amp"
      icon="envelope"
      color={samplerInk}
      isGhost={!params.has(AMP_ENVELOPE.attack)}
      onInteraction={(x, y) => {
        params.writeUnit(AMP_ENVELOPE.attack, x);
        params.writeUnit(AMP_ENVELOPE.release, y);
      }}
    />
  </div>
{/snippet}

<!-- The full-screen board's slots (ADR-521). -->
{#snippet filterSlot()}
  <div class="h-full min-w-0" style={params.isOn('F On') ? '' : 'opacity: var(--opacity-ghost);'}>
    <DeviceXY
      xValue={params.unit('Filter Freq') ?? 1}
      yValue={params.unit('Filter Res') ?? 0}
      title="Filter"
      isGhost={!params.isOn('F On')}
      showCurve={params.isOn('F On') && filterCurve.curveType !== 'none'}
      curveType={filterCurve.curveType}
      curveOrder={filterCurve.order}
      curveFreqRange={FILTER_FREQ_RANGE.sampler}
      onInteraction={(x, y) => {
        params.writeUnit('Filter Freq', x, 'F On');
        params.writeUnit('Filter Res', y, 'F On');
      }}
      color={samplerInk}
    />
  </div>
{/snippet}
{#snippet oscEnvSlot()}<EnvelopeGraph {params} names={sampleEnvelope('Oe', true)} ink={samplerInk.primary} sw="Osc On" knobs="short" />{/snippet}
{#snippet pitchEnvSlot()}<EnvelopeGraph {params} names={sampleEnvelope('Pe', true)} ink={samplerInk.primary} sw="Pe On" knobs="short" />{/snippet}
{#snippet filterEnvSlot()}<EnvelopeGraph {params} names={sampleEnvelope('Fe', true)} ink={samplerInk.primary} sw="Fe On" knobs="short" />{/snippet}
{#snippet ampSlot()}<EnvelopeGraph {params} names={sampleEnvelope('Ve', true)} ink={samplerInk.primary} knobs="side" />{/snippet}
{#snippet auxEnvSlot()}<EnvelopeGraph {params} names={sampleEnvelope('Ae', true)} ink={samplerInk.primary} sw="Ae On" knobs="short" />{/snippet}

<div class="h-full w-full overflow-hidden relative">
  {#if instrument && device && centralDisplayStore.expanded}
    <!-- Full screen (ADR-521): every section on one board. -->
    <InstrumentPanelView
      panel={SAMPLER_PANEL}
      {params}
      color={samplerInk}
      board
      slots={{ filter: filterSlot, oscEnv: oscEnvSlot, pitchEnv: pitchEnvSlot, filterEnv: filterEnvSlot, amp: ampSlot, auxEnv: auxEnvSlot }}
    />
  {:else if instrument && device}
    <!-- The face (ADR-510): the Sampler kit's sections, less the pads,
         on one grid of equal columns — Global [Gain/Trnsp | Spread] under
         the swap pill · Pitch / Osc · the Amp Envelope's Time pad, eight
         columns (the Filter pad is the chain cell's). The face owns the inset (--central-inset); the row
         carries none of its own. The wheels left for the MidiWheels
         device's chain cell (user, 2026-10-26). -->
    <SamplerControlsRow
      {values}
      {states}
      color={samplerInk}
      hidden={['selector']}
      envelope={ampEnvelope}
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

<style>
  /* The amp envelope's Time pad: the whole of the row's `.envelope-host`,
     both its rows and every column of the section. */
  .amp-pad {
    grid-column: 1 / -1;
    grid-row: 1 / -1;
    min-width: 0;
    min-height: 0;
  }
</style>
