<script lang="ts">
  import { press } from '$lib/actions/press';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import SimplerLoopControl from '$lib/components/v6/simpler/SimplerLoopControl.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import Repeat from '@lucide/svelte/icons/repeat';
  import { logger } from '$lib/utils/logger';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { CHARTREUSE_SCHEME } from '$lib/config/devicePresets';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import {
    simplerReverse,
    simplerWarpHalf,
    simplerWarpDouble,
  } from '$lib/services/simplerActions';
  import { addPresetToChain } from '$lib/services/deviceMoveService';
  import constants from '$config/constants.json';
  import { onDestroy } from 'svelte';
  import InstrumentPanelView from './panel/InstrumentPanelView.svelte';
  import { usePanelParams } from './panel/usePanelParams.svelte';
  import { useDeviceProperties } from '../useDeviceProperties.svelte';
  import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
  import { SIMPLER_PANEL, SAMPLE_LFO_WAVES, sampleEnvelope } from './panel/samplePanels';
  import EnvelopeGraph from '../EnvelopeGraph.svelte';
  import LfoGraph from '../LfoGraph.svelte';
  import { liveFilterCurve, FILTER_FREQ_RANGE } from '$lib/utils/instrumentFilterCurves';

  // Simpler parameter indices (from device-configs.json). These are the
  // FALLBACK: a Simpler's list is not one shape — the `Acuff Kit` pads
  // (2026-09-07) list the filter section and not the pitch envelope, and
  // there `Ve Attack` sits at 21 and `Ve Release` at 24 while 26 is
  // `Ve Loop` and 29 `Trigger Mode`. So every parameter is resolved by
  // NAME off the device's own list first (`paramPathOf`), and the index
  // below is used only when the name is not listed.
  const SIMPLER_PARAMS = {
    START: 3,          // Sample start position (0-1)
    LENGTH: 4,         // Sample length (0-1)
    LOOP_ON: 5,        // Loop on/off (0 or 1) — "S Loop On"
    FADE: 7,           // Fade amount — "S Loop Fade"
    TRANSPOSE: 11,     // Transpose in semitones
    ATTACK: 26,        // Amp envelope attack — "Ve Attack"
    RELEASE: 29,       // Amp envelope release — "Ve Release"
    SLICE_ATTACK: 33,  // Slicing mode attack
    SLICE_RELEASE: 35  // Slicing mode release
  } as const;
  const SIMPLER_PARAM_NAMES: Partial<Record<keyof typeof SIMPLER_PARAMS, string>> = {
    START: 'S Start',
    LENGTH: 'S Length',
    LOOP_ON: 'S Loop On',
    FADE: 'S Loop Fade',
    TRANSPOSE: 'Transpose',
    ATTACK: 'Ve Attack',
    RELEASE: 'Ve Release'
  };

  // Simpler playback modes
  const PLAYBACK_MODE = {
    CLASSIC: 0,
    SLICING: 2
  } as const;

  // Slicing-mode voicing. Live's enum is 0=Mono, 1=Poly, 2=Thru;
  // we surface only Poly/Thru since Mono is rarely useful for the
  // capture-into-Simpler workflow. DeviceInitComponent seeds Poly
  // on insert.
  const SLICING_PLAYBACK_MODE = {
    POLY: 1,
    THRU: 2
  } as const;

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  // Track reactive state

  // PR-4a-6a1: path-keyed device lookup (v3 tree, chain-order indexed).
  // Returns `undefined` on cold start — same "show ghost" posture as
  // the v2 .find() it replaces.
  let device = $derived(selectedTrackStore.instrumentDevice(instrument));

  // Random Start, the M4L utility behind the Random slider
  // (`constants.devices.randomStart`). Not on a track until the slider first
  // moves (2026-11-01, Ben): the first drag loads it through `device/load`
  // and the value it was dragged to is written once Live shows the device.
  // Found by name, not chain index, so a reorder never loses it; its
  // parameter by name too, since a rebuilt .amxd may shift indices.
  const RANDOM_START = constants.devices.randomStart;
  let randomStartDevice = $derived(
    selectedTrackStore.devicesByPath.find(
      (d) => d.className === RANDOM_START.className && d.name === RANDOM_START.deviceName,
    ),
  );
  let randomAmountParamPath = $derived.by<string | undefined>(() => {
    const dev = randomStartDevice;
    if (!dev) return undefined;
    for (const p of dev.params.values()) {
      if (p.name === RANDOM_START.amountParam) return p.paramPath;
    }
    return undefined;
  });

  // The value a drag reached before the device arrived, and the track its
  // load was sent for (a second drag sends no second load).
  const RANDOM_LOAD_TIMEOUT_MS = 5000;
  let randomPending = $state<number | null>(null);
  let randomLoadFor = $state<string | null>(null);
  let randomLoadTimer: ReturnType<typeof setTimeout> | null = null;

  // Random Amount is 0–100 (% of the headroom between the start and the
  // sample's end). With no device the slider shows 0, or the drag's value.
  let randomAmountValue = $derived(
    randomAmountParamPath
      ? selectedTrackStore.paramValueArmed(randomAmountParamPath) ?? 0
      : randomPending ?? 0,
  );

  function setRandomAmount(value: number) {
    if (randomAmountParamPath) {
      selectedTrackStore.setParamValue(randomAmountParamPath, value);
      return;
    }
    randomPending = value;
    const trackPath = selectedTrackStore.selectedTrackPath;
    if (randomLoadFor === trackPath) return;
    randomLoadFor = trackPath;
    addPresetToChain(trackPath, '', '', `place:${RANDOM_START.place}`, RANDOM_START.rel).catch(() => {
      randomLoadFor = null;
    });
    if (randomLoadTimer) clearTimeout(randomLoadTimer);
    // A load that never lands lets the next drag try again.
    randomLoadTimer = setTimeout(() => {
      randomLoadFor = null;
      randomLoadTimer = null;
    }, RANDOM_LOAD_TIMEOUT_MS);
  }

  // The device arrived: it starts at its own default (50 %), so the drag's
  // value goes on at once.
  $effect(() => {
    const path = randomAmountParamPath;
    if (!path || randomPending === null) return;
    const value = randomPending;
    randomPending = null;
    randomLoadFor = null;
    if (randomLoadTimer) {
      clearTimeout(randomLoadTimer);
      randomLoadTimer = null;
    }
    selectedTrackStore.setParamValue(path, value);
  });

  // Another track: whatever was waiting belonged to the last one.
  $effect(() => {
    void selectedTrackStore.selectedTrackPath;
    randomPending = null;
    randomLoadFor = null;
  });

  onDestroy(() => {
    if (randomLoadTimer) clearTimeout(randomLoadTimer);
  });

  // PR-3.5.7-impl: v3 path-keyed lookup for property reads/writes.
  let devicePath = $derived(device?.devicePath);

  // The device's parameters by name, resolved over its live list, so a
  // section that appears later is found too (`usePanelParams`).
  const params = usePanelParams(() => device);
  /** The parameter's path on THIS device: by name when listed, else the table's index. */
  function paramPathOf(key: keyof typeof SIMPLER_PARAMS): string {
    const name = SIMPLER_PARAM_NAMES[key];
    return (name ? params.pathOf(name) : undefined) ?? selectedTrackStore.paramPath(device!, SIMPLER_PARAMS[key]);
  }

  // All parameter values as $derived - always reactive to store changes
  let attackValue = $derived(device ? selectedTrackStore.paramValueArmed(paramPathOf('ATTACK')) ?? 0.5 : 0.5);
  let releaseValue = $derived(device ? selectedTrackStore.paramValueArmed(paramPathOf('RELEASE')) ?? 0.5 : 0.5);
  let slicingParam33 = $derived(device ? selectedTrackStore.paramValueArmed(paramPathOf('SLICE_ATTACK')) ?? 0.5 : 0.5);
  let slicingParam35 = $derived(device ? selectedTrackStore.paramValueArmed(paramPathOf('SLICE_RELEASE')) ?? 0.5 : 0.5);
  let transposeValue = $derived(device ? selectedTrackStore.paramValueArmed(paramPathOf('TRANSPOSE')) ?? 0 : 0);
  let fadeValue = $derived(device ? selectedTrackStore.paramValueArmed(paramPathOf('FADE')) ?? 0.5 : 0.5);

  // PR-3.5.7-impl: v3 property reads, subscribed for as long as this view
  // is mounted with a resolved devicePath (re-subscribed on an instrument
  // switch). Each reads its default while the cold-read echo is in flight.
  const deviceProps = useDeviceProperties(() => devicePath, [
    'playback_mode',
    'slicing_playback_mode',
    'sample.warp_mode',
    'sample.warping',
    'sample.slicing_sensitivity',
    'sample.gain',
    'sample.start_marker',
    'sample.end_marker',
    'sample.length',
    'sample.slices'
  ]);
  let playbackMode = $derived(deviceProps.get('playback_mode', 0));
  let warpMode = $derived(deviceProps.get('sample.warp_mode', 0));
  // sample.warping is bool on LOM but ships as int 0/1 on the wire (see
  // PropertyComponent.PropertySpec.coerce_bool_to_int) — coerce here.
  let warping = $derived(Boolean(deviceProps.get('sample.warping', 0)));
  // Loop is Simpler DeviceParameter index 5 ("S Loop On"), bool-as-float 0/1.
  let loopOnValue = $derived(device ? selectedTrackStore.paramValueArmed(paramPathOf('LOOP_ON')) ?? 0 : 0);
  let loopOn = $derived<boolean>(Boolean(loopOnValue));
  let slicingSensitivity = $derived(deviceProps.get('sample.slicing_sensitivity', 0.5));
  // Slicing-mode voicing (Poly/Thru tab in the top-left column when
  // in Slice mode). Default to Thru while the cold-read is in flight
  // so the UI matches the post-swap default that SimplerLoadComponent
  // pins on the device.
  let slicingPlaybackMode = $derived<number>(deviceProps.get('slicing_playback_mode', SLICING_PLAYBACK_MODE.THRU));
  let sampleGain = $derived(deviceProps.get('sample.gain', 1.0));

  // Sample marker properties (for syncing between modes)
  let sampleStartMarker = $derived(deviceProps.get('sample.start_marker', 0));
  let sampleEndMarker = $derived(deviceProps.get('sample.end_marker', 0));
  let sampleLengthFrames = $derived(deviceProps.get('sample.length', 1));
  // Slice frame positions (Live 11+). Wire shape is a JSON-stringified
  // list-of-int — same lane Compressor2's routing pair uses. Parse
  // here so the canvas in SimplerLoopControl receives a numeric array;
  // empty array on cold-start / parse failure (matches the "no slices
  // yet" UI state where no lines render).
  let sampleSlices = $derived.by<number[]>(() => {
    const raw = deviceProps.raw('sample.slices');
    if (typeof raw !== 'string' || !raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'number') : [];
    } catch {
      return [];
    }
  });

  // Classic mode parameters (for syncing between modes)
  let paramStart = $derived(device ? selectedTrackStore.paramValueArmed(paramPathOf('START')) ?? 0 : 0);
  let paramLength = $derived(device ? selectedTrackStore.paramValueArmed(paramPathOf('LENGTH')) ?? 1 : 1);

  // Warp mode mapping (only Beats, Complex, Pro)
  const WARP_MODE_MAP = {
    'beats': 0,
    'complex': 4,
    'pro': 6
  };

  // Check if in slicing mode
  let isSlicing = $derived(playbackMode === PLAYBACK_MODE.SLICING);

  // The instrument view wears the focused TRACK's ink (ADR-402): a Simpler
  // IS the track's voice, so the whole view reads as its track rather than
  // signaling Classic/Slice by hue. Mode is read from the toggle's label +
  // active state instead. Passed to children (SimplerLoopControl paints
  // color.primary on canvas; sliders/pads tint from it) so they match too.
  // Falls back to a calibrated chartreuse only on cold start (no track record).
  let simplerInk = $derived(selectedTrackScheme() ?? {
    primary: trackInk(CHARTREUSE_SCHEME.primary, paintModeReactive()),
    secondary: CHARTREUSE_SCHEME.secondary,
    accent: trackInk(CHARTREUSE_SCHEME.accent, paintModeReactive()),
  });

  // Set playback mode explicitly, syncing loop positions across the swap.
  // No-op if already in the requested mode.
  function setPlaybackMode(newMode: number) {
    if (!device) return;
    if (newMode === playbackMode) return;

    // Validate sample length before syncing
    if (sampleLengthFrames <= 0) {
      logger.warn('Cannot sync loop position: invalid sample length', { sampleLengthFrames });
      // Still allow mode change, just skip sync
      if (devicePath) selectedTrackStore.setPropertyValue(devicePath, 'playback_mode', newMode);
      return;
    }

    // Live rejects `end_marker >= sample.length` ("Cannot set marker outside
    // of the sample"), so the highest valid frame index is length - 1.
    const maxEndMarker = Math.max(0, sampleLengthFrames - 1);

    if (newMode === PLAYBACK_MODE.SLICING) {
      // Switching TO slicing: sync markers from params
      // Clamp values to valid range before converting
      const clampedStart = Math.max(0, Math.min(1, paramStart));
      const clampedLength = Math.max(0, Math.min(1 - clampedStart, paramLength));
      const newStartMarker = Math.round(clampedStart * sampleLengthFrames);
      const newEndMarker = Math.min(maxEndMarker, Math.round((clampedStart + clampedLength) * sampleLengthFrames));
      if (devicePath) {
        selectedTrackStore.setPropertyValue(devicePath, 'sample.start_marker', newStartMarker);
        selectedTrackStore.setPropertyValue(devicePath, 'sample.end_marker', newEndMarker);
      }
    } else {
      // Switching TO classic: capture the brace's current normalized
      // position from the slice markers BEFORE we zero them, then write
      // those into params 3/4 so the brace stays put visually. Resetting
      // start_marker to 0 (and end_marker to length-1) means param 3
      // — which is offset from start_marker in Live's internal model —
      // can sweep the entire sample without a baked-in offset.
      const normalizedStart = Math.max(0, Math.min(1, sampleStartMarker / sampleLengthFrames));
      const normalizedLength = Math.max(0, Math.min(1 - normalizedStart, (sampleEndMarker - sampleStartMarker) / sampleLengthFrames));
      if (devicePath) {
        selectedTrackStore.setPropertyValue(devicePath, 'sample.start_marker', 0);
        selectedTrackStore.setPropertyValue(devicePath, 'sample.end_marker', maxEndMarker);
      }
      selectedTrackStore.setParamValue(paramPathOf('START'), normalizedStart);
      selectedTrackStore.setParamValue(paramPathOf('LENGTH'), normalizedLength);
    }

    if (devicePath) selectedTrackStore.setPropertyValue(devicePath, 'playback_mode', newMode);
  }

  // Set warp mode — passing 'off' disables warping; any mode enables it
  // and selects that mode. Surface coerces 0/1 ↔ bool for sample.warping.
  function selectWarpOption(option: 'off' | 'beats' | 'complex' | 'pro') {
    if (!devicePath) return;
    if (option === 'off') {
      if (warping) selectedTrackStore.setPropertyValue(devicePath, 'sample.warping', 0);
      return;
    }
    if (!warping) selectedTrackStore.setPropertyValue(devicePath, 'sample.warping', 1);
    const modeNumber = WARP_MODE_MAP[option];
    if (modeNumber !== undefined) {
      selectedTrackStore.setPropertyValue(devicePath, 'sample.warp_mode', modeNumber);
    }
  }

  // Toggle Simpler's Loop parameter (index 5, "S Loop On").
  function toggleLoopOn() {
    if (!device) return;
    selectedTrackStore.setParamValue(paramPathOf('LOOP_ON'), loopOn ? 0 : 1);
  }

  // Set slicing sensitivity - just send to store, control component handles local state
  function handleSlicingSensitivity(value: number) {
    if (!devicePath) return;
    selectedTrackStore.setPropertyValue(devicePath, 'sample.slicing_sensitivity', value);
  }

  function setSlicingPlaybackMode(newMode: number) {
    if (!devicePath) return;
    if (newMode === slicingPlaybackMode) return;
    selectedTrackStore.setPropertyValue(devicePath, 'slicing_playback_mode', newMode);
  }

  // Set sample gain - just send to store, control component handles local state
  function handleSampleGain(value: number) {
    if (!devicePath) return;
    selectedTrackStore.setPropertyValue(devicePath, 'sample.gain', value);
  }

  // Simpler side-effect actions — addresses verified via lom_invoke probe.
  // reverse() is symmetric (calling twice un-reverses). warp_half / double
  // require sample.warping=true; the UI hides those buttons when warp is off
  // so the "warping required" failure path is unreachable from the GUI.
  function handleReverse() {
    if (!devicePath) return;
    simplerReverse(devicePath);
  }
  function handleWarpHalf() {
    if (!devicePath) return;
    simplerWarpHalf(devicePath);
  }
  function handleWarpDouble() {
    if (!devicePath) return;
    simplerWarpDouble(devicePath);
  }

  // The full-screen board (ADR-521) binds by Live's names (`params`, above),
  // like the other instruments' boards: the filter's pad and curve, the
  // LFO's wave and rate.
  let filterCurve = $derived(
    liveFilterCurve(params.raw('Filter Type') ?? 0, params.raw('Filter Slope') ?? 1, params.raw('Filter Morph') ?? 0)
  );
  let lfoShape = $derived(SAMPLE_LFO_WAVES[Math.round(params.raw('L Wave') ?? 0)]);
  let lfoRate = $derived(Math.round(params.raw('L Sync') ?? 0) === 1 ? 'L Sync Rate' : 'L Rate');

  // XY interaction handlers - just send to store, control components handle local state
  function handleTimeXYInteraction(x: number, y: number) {
    if (!device) return;
    selectedTrackStore.setParamValue(paramPathOf('ATTACK'), x);
    selectedTrackStore.setParamValue(paramPathOf('RELEASE'), y);
  }

  function handleSlicingTimeXYInteraction(x: number, y: number) {
    if (!device) return;
    selectedTrackStore.setParamValue(paramPathOf('SLICE_ATTACK'), x);
    selectedTrackStore.setParamValue(paramPathOf('SLICE_RELEASE'), y);
  }

</script>

<!-- The Simpler's own controls, drawn by the band face and by the full-screen
     board's Sample tile alike (ADR-521). Each fills the cell its host gives it. -->
{#snippet modeTab(stacked = false)}
  <!-- Classic | Slice: two named settings, so a tab (ADR-544; one button
       that named the mode it was in until then). Each option writes only
       from the other mode, as the toggle did. -->
  <div
    class="device-segmented seg-grid simpler-tab grid min-h-0 h-full w-full {stacked ? 'grid-rows-2' : 'grid-cols-2'}"
    role="radiogroup"
    aria-label="Playback mode"
    data-simpler-mode={isSlicing ? 'slice' : 'classic'}
  >
    <button
      use:press={{ onPress: () => { if (isSlicing) setPlaybackMode(PLAYBACK_MODE.CLASSIC); } }}
      class="device-segment simpler-option"
      class:active={!isSlicing}
      role="radio"
      aria-checked={!isSlicing}
    >
      Classic
    </button>
    <button
      use:press={{ onPress: () => { if (!isSlicing) setPlaybackMode(PLAYBACK_MODE.SLICING); } }}
      class="device-segment simpler-option"
      class:active={isSlicing}
      role="radio"
      aria-checked={isSlicing}
    >
      Slice
    </button>
  </div>
{/snippet}

{#snippet loopOrVoicing()}
  <!-- LOOP on/off (Classic); in Slice, Poly / Thru in its place. -->
  {#if !isSlicing}
    <button
      use:press={{ onPress: () => toggleLoopOn() }}
      class="physical-button btn-toggle simpler-switch h-full w-full"
      class:active={loopOn}
      aria-label="Loop {loopOn ? 'on' : 'off'}"
      aria-pressed={loopOn}
    >
      <Repeat class="simpler-mark" size={28} strokeWidth={2} aria-hidden="true" />
      <span class="simpler-word">Loop</span>
    </button>
  {:else}
    <!-- Poly/Thru, Poly over Thru (a column is too narrow for the two
         abreast). Mono is intentionally omitted — the capture-into-Simpler
         flow doesn't benefit from it. -->
    <div
      class="device-segmented seg-grid simpler-tab grid grid-rows-2 min-h-0 h-full w-full"
      role="radiogroup"
      aria-label="Slicing playback mode"
    >
      <button
        use:press={{ onPress: () => setSlicingPlaybackMode(SLICING_PLAYBACK_MODE.POLY) }}
        class="device-segment simpler-option"
        class:active={slicingPlaybackMode === SLICING_PLAYBACK_MODE.POLY}
        role="radio"
        aria-checked={slicingPlaybackMode === SLICING_PLAYBACK_MODE.POLY}
      >
        Poly
      </button>
      <button
        use:press={{ onPress: () => setSlicingPlaybackMode(SLICING_PLAYBACK_MODE.THRU) }}
        class="device-segment simpler-option"
        class:active={slicingPlaybackMode === SLICING_PLAYBACK_MODE.THRU}
        role="radio"
        aria-checked={slicingPlaybackMode === SLICING_PLAYBACK_MODE.THRU}
      >
        Thru
      </button>
    </div>
  {/if}
{/snippet}

{#snippet brace()}
  <SimplerLoopControl device={device} devicePath={devicePath} playbackMode={playbackMode} color={simplerInk} slices={sampleSlices} />
{/snippet}

{#snippet warpTab(layout: string)}
  <!-- Off / Beats / Cplx / Pro: one tab, two by two on the face (a touch
       row each), four down on the board. -->
  <div
    class="device-segmented seg-grid simpler-tab grid min-h-0 h-full w-full {layout}"
    role="radiogroup"
    aria-label="Warp mode"
  >
    <button use:press={{ onPress: () => selectWarpOption('off') }} class="device-segment simpler-option" class:active={!warping} role="radio" aria-checked={!warping}>Off</button>
    <button use:press={{ onPress: () => selectWarpOption('beats') }} class="device-segment simpler-option" class:active={warping && warpMode === 0} role="radio" aria-checked={warping && warpMode === 0}>Beats</button>
    <button use:press={{ onPress: () => selectWarpOption('complex') }} class="device-segment simpler-option" class:active={warping && warpMode === 4} role="radio" aria-checked={warping && warpMode === 4}>Cplx</button>
    <button use:press={{ onPress: () => selectWarpOption('pro') }} class="device-segment simpler-option" class:active={warping && warpMode === 6} role="radio" aria-checked={warping && warpMode === 6}>Pro</button>
  </div>
{/snippet}

{#snippet trnspBox()}
  <!-- Transpose, ±48: the amount that is played, so a box (ADR-509), the
       name the kits and the Sampler give the same control. -->
  <DeviceSlider
    value={transposeValue}
    title="Trnsp"
    icon="transpose"
    orientation="vertical"
    labelOrientation="horizontal"
    color={simplerInk}
    min={-48}
    max={48}
    centerOrigin={true}
    discrete
    centerValue={0}
    onInteraction={(value) => {
      if (!device) return;
      // ±48 — the project-wide pitch range (user, 2026-09-07); was ±12.
      const semitones = Math.max(-48, Math.min(48, Math.round(value)));
      selectedTrackStore.setParamValue(paramPathOf('TRANSPOSE'), semitones);
    }}
  />
{/snippet}

{#snippet timePad()}
  {#if !isSlicing}
    <DeviceXY
      xValue={attackValue}
      yValue={releaseValue}
      title="Time"
      icon="envelope"
      onInteraction={handleTimeXYInteraction}
      color={simplerInk}
    />
  {:else}
    <DeviceXY
      xValue={slicingParam33}
      yValue={slicingParam35}
      title="Time"
      icon="envelope"
      onInteraction={handleSlicingTimeXYInteraction}
      color={simplerInk}
    />
  {/if}
{/snippet}

<!-- The view's knobs (Fade or Sens, Gain, Random) are set and left, and one
     size wherever they sit together: medium, the largest a half-height cell
     holds with its name (ADR-509, ADR-544). -->
{#snippet fadeKnob()}
  <!-- No mark: the `fade` glyph is two crossing ramps, which in a knob's
       middle read as a close mark (2026-11-17). Its name says it. -->
  <DeviceSlider
    value={fadeValue}
    title="Fade"
    face="knob"
    knobSize="m"
    knobFit
    orientation="vertical"
    labelOrientation="horizontal"
    color={simplerInk}
    onInteraction={(value) => {
      if (!device) return;
      selectedTrackStore.setParamValue(paramPathOf('FADE'), value);
    }}
  />
{/snippet}

{#snippet gainKnob()}
  <!-- The sample's gain: set for the sample and left, so a knob (a box
       until ADR-544, its name under its own fill). -->
  <DeviceSlider
    value={sampleGain}
    title="Gain"
    face="knob"
    knobSize="m"
    knobFit
    icon="gain"
    orientation="vertical"
    labelOrientation="horizontal"
    color={simplerInk}
    min={0}
    max={1}
    centerOrigin={true}
    centerValue={0.5}
    onInteraction={(value) => {
      if (!device) return;
      handleSampleGain(value);
    }}
  />
{/snippet}

{#snippet sensKnob()}
  <DeviceSlider
    value={slicingSensitivity}
    title="Sens"
    face="knob"
    knobSize="m"
    knobFit
    icon="slice"
    orientation="vertical"
    labelOrientation="horizontal"
    color={simplerInk}
    onInteraction={(value) => {
      if (!device) return;
      handleSlicingSensitivity(value);
    }}
  />
{/snippet}

{#snippet reverseButton()}
  <!-- Reverse is symmetric, so a tap toggles: a one-shot, round, its mark
       over its word. -->
  <div class="simpler-round-cell">
    <button
      use:press={{ onPress: () => handleReverse() }}
      class="physical-button btn-action simpler-round"
      aria-label="Reverse sample"
    >
      <svg class="simpler-mark" width="28" height="28" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7M19 12H4" /></svg>
      <span class="simpler-word">Rev</span>
    </button>
  </div>
{/snippet}

{#snippet warpActions(stacked = false)}
  <!-- ½× and 2× act on the warped tempo, so they sit with Warp and answer
       only while it is on (the SimplerDevice methods no-op without it):
       dimmed and inert while Warp is Off, where they were not drawn at all,
       so nothing moves when Warp turns on. -->
  <div class="simpler-pair" class:simpler-pair-stacked={stacked} class:simpler-pair-off={!warping}>
    <div class="simpler-round-cell">
      <button
        use:press={{ onPress: () => handleWarpHalf(), disabled: !warping }}
        class="physical-button btn-action simpler-round"
        disabled={!warping}
        aria-label="Halve warped tempo"
      >
        <span class="simpler-word simpler-word-lg">½×</span>
      </button>
    </div>
    <div class="simpler-round-cell">
      <button
        use:press={{ onPress: () => handleWarpDouble(), disabled: !warping }}
        class="physical-button btn-action simpler-round"
        disabled={!warping}
        aria-label="Double warped tempo"
      >
        <span class="simpler-word simpler-word-lg">2×</span>
      </button>
    </div>
  </div>
{/snippet}

{#snippet randomKnob()}
  <!-- Random Start's "Random Amount", 0–100 (%): a ghost until the track
       has the device, which the first drag loads (setRandomAmount). -->
  <DeviceSlider
    value={randomAmountValue}
    title="Random"
    face="knob"
    knobSize="m"
    knobFit
    icon="dice"
    orientation="vertical"
    labelOrientation="horizontal"
    color={simplerInk}
    min={0}
    max={100}
    isGhost={!randomAmountParamPath}
    onInteraction={setRandomAmount}
  />
{/snippet}

<!-- The full-screen board's slots (ADR-521). -->
{#snippet sampleSlot()}
  <!-- One row of full-height columns: Mode, Loop (or Poly / Thru), the
       brace, Warp, its ½× and 2×, Reverse, then the knobs (Gain, Sens in
       Slice, Random Start). -->
  <div class="simpler-board-sample" data-simpler-board-sample>
    <div class="min-h-0 min-w-0">{@render modeTab(true)}</div>
    <div class="min-h-0 min-w-0">{@render loopOrVoicing()}</div>
    <div class="min-h-0 min-w-0 relative">{@render brace()}</div>
    <div class="min-h-0 min-w-0">{@render warpTab('grid-rows-4')}</div>
    <div class="min-h-0 min-w-0">{@render warpActions(true)}</div>
    <div class="min-h-0 min-w-0">{@render reverseButton()}</div>
    <div class="min-h-0 min-w-0">{@render gainKnob()}</div>
    {#if isSlicing}<div class="min-h-0 min-w-0">{@render sensKnob()}</div>{/if}
    <div class="min-h-0 min-w-0">{@render randomKnob()}</div>
  </div>
{/snippet}

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
      color={simplerInk}
    />
  </div>
{/snippet}

{#snippet ampSlot()}<EnvelopeGraph {params} names={sampleEnvelope('Ve', false)} ink={simplerInk.primary} knobs="side" />{/snippet}
{#snippet filterEnvSlot()}<EnvelopeGraph {params} names={sampleEnvelope('Fe', false)} ink={simplerInk.primary} sw="Fe On" knobs="short" />{/snippet}
{#snippet pitchEnvSlot()}<EnvelopeGraph {params} names={sampleEnvelope('Pe', false)} ink={simplerInk.primary} sw="Pe On" knobs="short" />{/snippet}
{#snippet lfoSlot()}<LfoGraph {params} shape={lfoShape} rate={lfoRate} ink={simplerInk.primary} sw="L On" />{/snippet}

<div class="h-full w-full flex flex-col min-h-0">
  {#if instrument && device && centralDisplayStore.expanded}
    <!-- Full screen (ADR-521): every section on one board. -->
    <InstrumentPanelView
      panel={SIMPLER_PANEL}
      {params}
      color={simplerInk}
      board
      slots={{ sample: sampleSlot, filter: filterSlot, amp: ampSlot, filterEnv: filterEnvSlot, pitchEnv: pitchEnvSlot, lfo: lfoSlot }}
    />
  {:else if instrument && device}
    <!-- The face (ADR-510, re-laid for ADR-544): one grid of eight equal
         columns, a header line, identical seams, and every section's body
         the same two equal rows.

           Mode (2)             · Sample (5)                        · Warp (1)
           swap pill              Trnsp | the loop brace ......       Off  Beats
           Classic | Slice        (full | .....................       Cplx Pro
           Loop     Rev           height) Time  Fade  Gain  Random    ½×   2×

         The brace is the picture and the thing played, so it has half the
         height (a quarter until now, under three 96px knobs); Trnsp, the
         other played amount, is the full-height box it is on every kit and
         on the Sampler. The pill lies over two columns so its name fits
         (one column cut "Aurora Lead" to "A."). Fade (Sens in Slice), Gain
         and Random are set and left: three knobs of one size in one row.
         Warp and the two one-shots that need it share a column. Random
         Start, an M4L utility ahead of the Simpler, is the Sample row's
         last knob: it randomises where in the brace a note starts. -->
    <FaceGrid sections={[2, 5, 1]} data-simpler-face>
      <FaceSection span={2}>
        {#snippet head()}<PanelEyebrow title="Mode" color={simplerInk.primary} />{/snippet}
        <div class="simpler-rows face-span-all">
          <!-- The swap pill lying across the top of the left-hand column
               (user's layout, 2026-09-16), over Classic | Slice. -->
          <div class="simpler-pick">
            <HostedSwapPill />
            <div class="simpler-pick-mode">{@render modeTab()}</div>
          </div>
          <div class="row-start-2 min-h-0 min-w-0">{@render loopOrVoicing()}</div>
          <div class="row-start-2 min-h-0 min-w-0">{@render reverseButton()}</div>
        </div>
      </FaceSection>
      <FaceSeam ink={simplerInk.primary} />

      <FaceSection span={5}>
        {#snippet head()}<PanelEyebrow title="Sample" color={simplerInk.primary} />{/snippet}
        <div class="simpler-rows face-span-all">
          <!-- TRNSP, the section's first column, over both rows. -->
          <div class="simpler-trnsp min-h-0 min-w-0">{@render trnspBox()}</div>

          <!-- The loop brace, the other four columns of the first row. -->
          <div class="simpler-brace min-h-0 relative">{@render brace()}</div>

          <!-- TIME XY. Two columns when Fade is hidden, so the row always
               fills the four columns under the brace:
               - Classic + non-warping: TIME + FADE + GAIN + RANDOM
               - Classic + warping:     TIME (two columns) + GAIN + RANDOM
               - Slice:                 TIME + SENS + GAIN + RANDOM -->
          <div class="{!isSlicing && warping ? 'col-span-2' : 'col-span-1'} row-start-2 min-h-0 min-w-0" style="touch-action: none;">
            {@render timePad()}
          </div>

          <!-- FADE (Classic, only when not warping) / SENS (Slice). -->
          {#if isSlicing}
            <div class="row-start-2 min-h-0 min-w-0">{@render sensKnob()}</div>
          {:else if !warping}
            <div class="row-start-2 min-h-0 min-w-0">{@render fadeKnob()}</div>
          {/if}

          <div class="row-start-2 min-h-0 min-w-0">{@render gainKnob()}</div>
          <div class="row-start-2 min-h-0 min-w-0">{@render randomKnob()}</div>
        </div>
      </FaceSection>
      <FaceSeam ink={simplerInk.primary} />

      <FaceSection span={1}>
        {#snippet head()}<PanelEyebrow title="Warp" color={simplerInk.primary} />{/snippet}
        <div class="simpler-rows face-span-all">
          <div class="row-start-1 min-h-0 min-w-0">{@render warpTab('grid-cols-2 grid-rows-2')}</div>
          <div class="row-start-2 min-h-0 min-w-0">{@render warpActions()}</div>
        </div>
      </FaceSection>
    </FaceGrid>
  {:else}
    <!-- Default state when no Simpler present -->
    <div class="flex-1 flex items-center justify-center p-(--central-inset)">
      <DeviceEmptyState glyph="🎵" message="Load Simpler to test LiveAPI properties" color={simplerInk.primary} />
    </div>
  {/if}
</div>

<!-- Physical-button and segmented chrome live in app.css as the shared
     .physical-button / .device-segmented / .device-segment classes (§5.5). -->

<style>
  /* Every section's body is the same two equal rows (the brace's, then the
     controls': a medium knob and its name, ADR-509), its columns the face's
     own (subgrid), so the rows line up across the seams. */
  .simpler-rows {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: repeat(2, minmax(0, 1fr));
    row-gap: var(--face-gutter);
    min-width: 0;
    min-height: 0;
  }
  .simpler-trnsp {
    grid-row: 1 / span 2;
    grid-column: 1;
  }
  .simpler-brace {
    grid-row: 1;
    grid-column: 2 / -1;
  }
  /* The pill over Classic | Slice, across the Mode section's columns. */
  .simpler-pick {
    grid-row: 1;
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: var(--face-gutter);
    min-width: 0;
    min-height: 0;
  }
  .simpler-pick-mode {
    flex: 1 1 0;
    min-height: 0;
  }

  /* A tab's options: one size of word on every tab in the view. */
  .simpler-option {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: 0;
    padding: 2px;
    font-size: 0.9375rem;
    line-height: 1.1;
    overflow: hidden;
  }

  /* A switch carries its mark over its word (ADR-544). */
  .simpler-switch {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 0;
    min-height: 0;
    container-type: size;
  }
  .simpler-word {
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.1;
  }
  .simpler-word-lg {
    font-size: 1rem;
  }
  /* The word first, the mark where there is room. */
  @container (height < 72px) {
    .simpler-switch :global(.simpler-mark) {
      display: none;
    }
  }

  /* A one-shot DRAWS a circle, the largest its cell holds, and ANSWERS to
     its whole cell (the Clip view's rule): the circle is the button's
     `::before`. */
  .simpler-round-cell {
    container-type: size;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .simpler-round {
    position: relative;
    isolation: isolate;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-width: 0;
    min-height: 0;
  }
  .simpler-round::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: min(100cqw, 100cqh);
    height: min(100cqw, 100cqh);
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: var(--surface-well);
    z-index: -1;
  }
  @container (height < 72px) or (width < 72px) {
    .simpler-round :global(.simpler-mark) {
      display: none;
    }
  }
  /* ½× beside 2×, one cell; one over the other on the board. */
  .simpler-pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--face-gutter);
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .simpler-pair.simpler-pair-stacked {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: repeat(2, minmax(0, 1fr));
  }
  .simpler-pair.simpler-pair-off {
    opacity: var(--opacity-ghost);
  }

  /* The board's Sample tile (ADR-521): Mode | Loop | brace | Warp | ½× 2× |
     Rev | the knobs, each a column the tile's height. */
  .simpler-board-sample {
    display: grid;
    grid-auto-flow: column;
    /* The knobs' columns (the auto ones) are wide enough for a medium knob. */
    grid-template-columns: repeat(2, minmax(0, 1fr)) minmax(0, 4.4fr) minmax(0, 1fr) minmax(0, 0.9fr) minmax(0, 1fr);
    grid-auto-columns: minmax(0, 1.2fr);
    gap: var(--spacing-sm);
    height: 100%;
    min-height: 0;
  }

  /* ---- Ink (flat grammar, ADR-544) -----------------------------------
     The tabs and the Loop switch come flat from app.css (.device-segmented
     / .physical-button): the chosen option and a lit switch are ON's block,
     a word is a label. Here only the type, and a one-shot's circle in place
     of the button's own field. */
  :global([data-grammar="flat"]) .simpler-option,
  :global([data-grammar="flat"]) .simpler-switch {
    text-transform: none;
    letter-spacing: 0;
    font-weight: var(--font-weight-medium);
  }
  :global([data-grammar="flat"]) .simpler-round,
  :global([data-grammar="flat"]) .simpler-round:hover:not(.active) {
    background: transparent;
    border-color: transparent;
  }
  :global([data-grammar="flat"]) .simpler-round:hover:not(:disabled)::before {
    background: var(--secondary);
  }
</style>
