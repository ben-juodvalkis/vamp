<script lang="ts">
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import SimplerLoopControl from '$lib/components/v6/simpler/SimplerLoopControl.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import { Repeat } from 'lucide-svelte';
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

  // Simpler parameter indices (from device-configs.json). These are the
  // FALLBACK: a Simpler's list is not one shape — the `Acuff Kit` pads
  // (2026-09-07) list the filter section and not the pitch envelope, and
  // there `Ve Attack` sits at 21 and `Ve Release` at 24 while 26 is
  // `Ve Loop` and 29 `Trigger Mode`. So every parameter is resolved by
  // NAME off the device's own list first (`paramIndex`), and the index
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
  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);

  // PR-4a-6a1: path-keyed device lookup (v3 tree, chain-order indexed).
  // Returns `undefined` on cold start — same "show ghost" posture as
  // the v2 .find() it replaces.
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);

  // Random Start MIDI utility (M4L). SimplerLoadComponent prepends it
  // when a Simpler is created via capture or audio-clip → Simpler. We
  // resolve by `name` rather than chain-index so the knob keeps working
  // when the user reorders devices, drops a utility between Random
  // Start and Simpler, etc.
  //
  // Name literal must match Live's runtime `device.name` exactly —
  // currently the .amxd basename (`random-start`) since the Max patch
  // doesn't override via `live.thisdevice`. Mirror of
  // `SimplerLoadComponent.RANDOM_START_DEVICE_NAME` on the Python side.
  // Live shows the param as "Random Amount" (set by the patch's
  // `live.numbox @parameter_longname`).
  const RANDOM_START_DEVICE_NAME = 'random-start';
  const RANDOM_AMOUNT_PARAM_NAME = 'Random Amount';
  let randomStartDevice = $derived(
    selectedTrackStore.devicesByPath.find(
      (d) => d.name === RANDOM_START_DEVICE_NAME,
    ),
  );
  // Param record matched by name, not by index — Live's M4L params
  // can shift if the .amxd is rebuilt. The paramPath we read off the
  // record IS the canonical write/read key.
  let randomAmountParamPath = $derived.by<string | undefined>(() => {
    const dev = randomStartDevice;
    if (!dev) return undefined;
    for (const p of dev.params.values()) {
      if (p.name === RANDOM_AMOUNT_PARAM_NAME) return p.paramPath;
    }
    return undefined;
  });
  // Random Amount ships from Live as 0–100 (% of the headroom between
  // baseStart and the sample end — see the .js script's `state.amount`
  // and the .amxd's `live.numbox @_parameter_range 0. 100.`). Cold-read
  // fallback is 0 so the slider starts inert; the user dials in
  // randomization explicitly.
  let randomAmountValue = $derived(
    randomAmountParamPath
      ? selectedTrackStore.paramValueArmed(randomAmountParamPath) ?? 0
      : 0,
  );

  // PR-3.5.7-impl: v3 path-keyed lookup for property reads/writes.
  let devicePath = $derived(device?.devicePath);

  // The device's parameter names, first index per name — re-derived on
  // every tree mutation, so a section that appears later is found too.
  let paramNames = $derived(device ? selectedTrackStore.paramNamesForDevice(device) : []);
  let paramIndexByName = $derived.by(() => {
    const m = new Map<string, number>();
    paramNames.forEach((name, i) => {
      if (!m.has(name)) m.set(name, i);
    });
    return m;
  });
  /** The parameter's index on THIS device: by name when listed, else the table's index. */
  function paramIndex(key: keyof typeof SIMPLER_PARAMS): number {
    const name = SIMPLER_PARAM_NAMES[key];
    const byName = name ? paramIndexByName.get(name) : undefined;
    return byName ?? SIMPLER_PARAMS[key];
  }
  function paramPathOf(key: keyof typeof SIMPLER_PARAMS): string {
    return selectedTrackStore.paramPath(device!, paramIndex(key));
  }

  // All parameter values as $derived - always reactive to store changes
  let attackValue = $derived(device ? selectedTrackStore.paramValueArmed(paramPathOf('ATTACK')) ?? 0.5 : 0.5);
  let releaseValue = $derived(device ? selectedTrackStore.paramValueArmed(paramPathOf('RELEASE')) ?? 0.5 : 0.5);
  let slicingParam33 = $derived(device ? selectedTrackStore.paramValueArmed(paramPathOf('SLICE_ATTACK')) ?? 0.5 : 0.5);
  let slicingParam35 = $derived(device ? selectedTrackStore.paramValueArmed(paramPathOf('SLICE_RELEASE')) ?? 0.5 : 0.5);
  let transposeValue = $derived(device ? selectedTrackStore.paramValueArmed(paramPathOf('TRANSPOSE')) ?? 0 : 0);
  let transposeLabel = $derived.by(() => {
    const n = Math.round(transposeValue);
    if (n === 0) return 'Pitch 0';
    return `Pitch ${n > 0 ? '+' : ''}${n}`;
  });
  let fadeValue = $derived(device ? selectedTrackStore.paramValueArmed(paramPathOf('FADE')) ?? 0.5 : 0.5);

  // PR-3.5.7-impl: v3 property reads. Same `?? default` posture as
  // before — `undefined` while the cold-read echo is in flight.
  let playbackMode = $derived<number>((devicePath ? selectedTrackStore.propertyValue(devicePath, 'playback_mode') as number | undefined : undefined) ?? 0);
  let warpMode = $derived<number>((devicePath ? selectedTrackStore.propertyValue(devicePath, 'sample.warp_mode') as number | undefined : undefined) ?? 0);
  // sample.warping is bool on LOM but ships as int 0/1 on the wire (see
  // PropertyComponent.PropertySpec.coerce_bool_to_int) — coerce here.
  let warping = $derived<boolean>(devicePath ? Boolean(selectedTrackStore.propertyValue(devicePath, 'sample.warping') ?? 0) : false);
  // Loop is Simpler DeviceParameter index 5 ("S Loop On"), bool-as-float 0/1.
  let loopOnValue = $derived(device ? selectedTrackStore.paramValueArmed(paramPathOf('LOOP_ON')) ?? 0 : 0);
  let loopOn = $derived<boolean>(Boolean(loopOnValue));
  let slicingSensitivity = $derived<number>((devicePath ? selectedTrackStore.propertyValue(devicePath, 'sample.slicing_sensitivity') as number | undefined : undefined) ?? 0.5);
  // Slicing-mode voicing (Poly/Thru tab in the top-left column when
  // in Slice mode). Default to Thru while the cold-read is in flight
  // so the UI matches the post-swap default that SimplerLoadComponent
  // pins on the device.
  let slicingPlaybackMode = $derived<number>((devicePath ? selectedTrackStore.propertyValue(devicePath, 'slicing_playback_mode') as number | undefined : undefined) ?? SLICING_PLAYBACK_MODE.THRU);
  let sampleGain = $derived<number>((devicePath ? selectedTrackStore.propertyValue(devicePath, 'sample.gain') as number | undefined : undefined) ?? 1.0);

  // Sample marker properties (for syncing between modes)
  let sampleStartMarker = $derived<number>((devicePath ? selectedTrackStore.propertyValue(devicePath, 'sample.start_marker') as number | undefined : undefined) ?? 0);
  let sampleEndMarker = $derived<number>((devicePath ? selectedTrackStore.propertyValue(devicePath, 'sample.end_marker') as number | undefined : undefined) ?? 0);
  let sampleLengthFrames = $derived<number>((devicePath ? selectedTrackStore.propertyValue(devicePath, 'sample.length') as number | undefined : undefined) ?? 1);
  // Slice frame positions (Live 11+). Wire shape is a JSON-stringified
  // list-of-int — same lane Compressor2's routing pair uses. Parse
  // here so the canvas in SimplerLoopControl receives a numeric array;
  // empty array on cold-start / parse failure (matches the "no slices
  // yet" UI state where no lines render).
  let sampleSlicesRaw = $derived<unknown>(devicePath ? selectedTrackStore.propertyValue(devicePath, 'sample.slices') : undefined);
  let sampleSlices = $derived.by<number[]>(() => {
    const raw = sampleSlicesRaw;
    if (typeof raw !== 'string' || !raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'number') : [];
    } catch {
      return [];
    }
  });

  // PR-3.5.7-impl: refcount the 8 property subscriptions for as long as
  // this component is mounted with a resolved devicePath. The manager
  // sends `/looping/v3/property/subscribe` on first acquire and
  // `unsubscribe` on last release. Effect cleanup runs on unmount AND
  // whenever `devicePath` changes (e.g. instrument switch).
  $effect(() => {
    if (!devicePath) return;
    const release = [
      selectedTrackStore.subscribeProperty(devicePath, 'playback_mode'),
      selectedTrackStore.subscribeProperty(devicePath, 'slicing_playback_mode'),
      selectedTrackStore.subscribeProperty(devicePath, 'sample.warp_mode'),
      selectedTrackStore.subscribeProperty(devicePath, 'sample.warping'),
      selectedTrackStore.subscribeProperty(devicePath, 'sample.slicing_sensitivity'),
      selectedTrackStore.subscribeProperty(devicePath, 'sample.gain'),
      selectedTrackStore.subscribeProperty(devicePath, 'sample.start_marker'),
      selectedTrackStore.subscribeProperty(devicePath, 'sample.end_marker'),
      selectedTrackStore.subscribeProperty(devicePath, 'sample.length'),
      selectedTrackStore.subscribeProperty(devicePath, 'sample.slices')
    ];
    return () => release.forEach((fn) => fn());
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

<div class="h-full w-full flex flex-col min-h-0 p-(--central-inset)" style="gap: var(--central-gap);">
  {#if instrument && device}
    <!-- Unified grid: both the top half (mode toggle + brace) and bottom
         half (sliders) share the same column widths so Classic/Slice,
         Warp, and the bottom controls all line up.
         Col layout (7 normally; 9 with Random Start):
           col 1        — Classic/Slice button (top) / LOOP button (bottom)
           cols 2–6     — Brace (top, col-span-5) / PITCH + TIME + FADE/SENS + GAIN + ACTIONS
           col 7        — Warp (spans both rows)
           col 8        — the seam before Random Start (`auto`, bottom only)
           col 9        — Random Start slider (bottom only, conditional)
         The top row and Warp are placed EXPLICITLY and every bottom control
         carries `row-start-2`. They used to auto-place, and with Random
         Start loaded the grid had an empty top cell right of Warp: the first
         bottom control flowed up into it and the rest of the row shifted one
         to the left (audit, 2026-09-13). Random Start is its own device, so
         it also gets a seam. -->
    <div
      class="flex-1 min-h-0 grid grid-rows-2"
      style="gap: var(--central-gap); grid-template-columns: {randomAmountParamPath ? 'repeat(7, minmax(0, 1fr)) auto minmax(0, 1fr)' : 'repeat(7, minmax(0, 1fr))'};"
    >
      <!-- TOP-LEFT: the swap pill lying across the top of the left-hand
           column (user's layout, 2026-09-16), then the Classic/Slice toggle,
           with Poly/Thru stacked below in Slice mode. The toggle takes what
           the pill leaves, so Loop below keeps its row. -->
      <div class="col-start-1 row-start-1 col-span-1 row-span-1 min-h-0 min-w-0 flex flex-col" style="gap: var(--central-gap);">
        <HostedSwapPill />
        <button
          onclick={() => setPlaybackMode(isSlicing ? PLAYBACK_MODE.CLASSIC : PLAYBACK_MODE.SLICING)}
          class="mode-toggle-glass flex-1 min-h-0 w-full rounded-full text-[22px] font-bold uppercase tracking-wider active:scale-95"
          style="
            --mode-ink: {simplerInk.primary};
            transition: background-color var(--t-fast) var(--ease-precise), border-color var(--t-fast) var(--ease-precise), color var(--t-fast) var(--ease-precise), transform var(--t-fast) var(--ease-precise);
          "
          aria-label="Toggle playback mode (currently {isSlicing ? 'Slice' : 'Classic'})"
        >
          {isSlicing ? 'Slice' : 'Classic'}
        </button>
        {#if isSlicing}
          <!-- Poly/Thru segmented control. Same chrome family as
               the Warp column on the right (.device-segmented). Mono
               is intentionally omitted — the capture-into-Simpler
               flow doesn't benefit from it. -->
          <div
            class="device-segmented grid grid-cols-2 flex-1 min-h-0"
            style="--btn-tint: {simplerInk.primary};"
            role="radiogroup"
            aria-label="Slicing playback mode"
          >
            <button
              onclick={() => setSlicingPlaybackMode(SLICING_PLAYBACK_MODE.POLY)}
              class="device-segment text-[22px] font-bold uppercase"
              class:active={slicingPlaybackMode === SLICING_PLAYBACK_MODE.POLY}
              role="radio"
              aria-checked={slicingPlaybackMode === SLICING_PLAYBACK_MODE.POLY}
            >
              Poly
            </button>
            <button
              onclick={() => setSlicingPlaybackMode(SLICING_PLAYBACK_MODE.THRU)}
              class="device-segment text-[22px] font-bold uppercase"
              class:active={slicingPlaybackMode === SLICING_PLAYBACK_MODE.THRU}
              role="radio"
              aria-checked={slicingPlaybackMode === SLICING_PLAYBACK_MODE.THRU}
            >
              Thru
            </button>
          </div>
        {/if}
      </div>

      <!-- TOP-CENTRE: Loop brace (spans cols 2–6). -->
      <div class="col-start-2 row-start-1 col-span-5 row-span-1 min-h-0 relative">
        <SimplerLoopControl device={device} devicePath={devicePath} playbackMode={playbackMode} color={simplerInk} slices={sampleSlices} />
      </div>

      <!-- RIGHT: full-height Warp column (Off / Beats / Cplx / Pro stacked).
           row-span-2 so it covers both the top (brace) and bottom (controls) rows,
           keeping it the same width as every other single-column control. -->
      <div
        class="device-segmented col-start-7 row-start-1 col-span-1 row-span-2 grid grid-rows-4 min-h-0"
        style="--btn-tint: {simplerInk.primary};"
        role="radiogroup"
        aria-label="Warp mode"
      >
        <button
          onclick={() => selectWarpOption('off')}
          class="device-segment text-[22px] font-bold uppercase"
          class:active={!warping}
          role="radio"
          aria-checked={!warping}
        >
          Off
        </button>
        <button
          onclick={() => selectWarpOption('beats')}
          class="device-segment text-[22px] font-bold uppercase"
          class:active={warping && warpMode === 0}
          role="radio"
          aria-checked={warping && warpMode === 0}
        >
          Beats
        </button>
        <button
          onclick={() => selectWarpOption('complex')}
          class="device-segment text-[22px] font-bold uppercase"
          class:active={warping && warpMode === 4}
          role="radio"
          aria-checked={warping && warpMode === 4}
        >
          Cplx
        </button>
        <button
          onclick={() => selectWarpOption('pro')}
          class="device-segment text-[22px] font-bold uppercase"
          class:active={warping && warpMode === 6}
          role="radio"
          aria-checked={warping && warpMode === 6}
        >
          Pro
        </button>
      </div>

      <!-- BOTTOM HALF: control row (cols 1–6, leaving col 7 to Warp above).
           Order L→R: LOOP (Classic only) | PITCH | TIME XY (2-3) | FADE/SENS | GAIN | ACTIONS
           LOOP is hidden in Slice mode; TIME XY expands to fill the gap. -->

      <!-- LOOP on/off (Classic only — hidden in Slice; sibling
           controls expand to fill the slot). -->
      {#if !isSlicing}
        <button
          onclick={toggleLoopOn}
          class="physical-button row-start-2 col-span-1 row-span-1 h-full w-full flex items-center justify-center"
          class:active={loopOn}
          style="--btn-tint: {simplerInk.primary};"
          aria-label="Loop {loopOn ? 'on' : 'off'}"
        >
          <Repeat size={36} strokeWidth={2.5} />
        </button>
      {/if}

      <!-- PITCH (vertical) -->
      <div class="row-start-2 col-span-1 row-span-1 min-h-0 min-w-0">
        <DeviceSlider
          value={transposeValue}
          title={transposeLabel}
          orientation="vertical"
          labelOrientation="horizontal"
          color={simplerInk}
          min={-48}
          max={48}
          centerOrigin={true}
          centerValue={0}
          onInteraction={(value) => {
            if (!device) return;
            // ±48 — the project-wide pitch range (user, 2026-09-07); was ±12.
            const semitones = Math.max(-48, Math.min(48, Math.round(value)));
            selectedTrackStore.setParamValue(paramPathOf('TRANSPOSE'), semitones);
          }}
        />
      </div>

      <!-- TIME XY. Expands when sibling controls are hidden so the
           row fills exactly cols 1–6 (col 7 is Warp's row-span-2).
           - Classic + non-warping: LOOP+PITCH+FADE+GAIN+ACTIONS = 5 → TIME col-span-1
           - Classic + warping:     LOOP+PITCH+GAIN+ACTIONS = 4     → TIME col-span-2
           - Slice:                 PITCH+SENS+GAIN+ACTIONS = 4     → TIME col-span-2 -->
      <div class="{(!isSlicing && warping) || isSlicing ? 'col-span-2' : 'col-span-1'} row-start-2 row-span-1 min-h-0 min-w-0" style="touch-action: none;">
        {#if !isSlicing}
          <DeviceXY
            xValue={attackValue}
            yValue={releaseValue}
            title="Time"
            onInteraction={handleTimeXYInteraction}
            color={simplerInk}
          />
        {:else}
          <DeviceXY
            xValue={slicingParam33}
            yValue={slicingParam35}
            title="Time"
            onInteraction={handleSlicingTimeXYInteraction}
            color={simplerInk}
          />
        {/if}
      </div>

      <!-- FADE (Classic, only when not warping) / SENS (Slice).
           Hidden in Classic when warping is on — sibling controls expand. -->
      {#if isSlicing}
        <div class="row-start-2 col-span-1 row-span-1 min-h-0 min-w-0">
          <DeviceSlider
            value={slicingSensitivity}
            title="Sens"
            orientation="vertical"
            labelOrientation="horizontal"
            color={simplerInk}
            onInteraction={(value) => {
              if (!device) return;
              handleSlicingSensitivity(value);
            }}
          />
        </div>
      {:else if !warping}
        <div class="row-start-2 col-span-1 row-span-1 min-h-0 min-w-0">
          <DeviceSlider
            value={fadeValue}
            title="Fade"
            orientation="vertical"
            labelOrientation="horizontal"
            color={simplerInk}
            onInteraction={(value) => {
              if (!device) return;
              selectedTrackStore.setParamValue(paramPathOf('FADE'), value);
            }}
          />
        </div>
      {/if}

      <!-- GAIN (vertical) -->
      <div class="row-start-2 col-span-1 row-span-1 min-h-0 min-w-0">
        <DeviceSlider
          value={sampleGain}
          title="Gain"
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
      </div>

      <!-- ACTIONS — Reverse always; ½× / 2× only when warping is on
           (the underlying SimplerDevice methods no-op without warping;
           hiding them keeps the row honest). Reverse is symmetric so
           we don't track an "is reversed" state — tap toggles. -->
      <div class="row-start-2 col-span-1 row-span-1 min-h-0 min-w-0 grid {warping ? 'grid-rows-3' : 'grid-rows-1'}" style="gap: var(--spacing-sm);">
        <button
          onclick={handleReverse}
          class="physical-button h-full w-full flex items-center justify-center text-[18px] font-bold uppercase tracking-wider"
          style="--btn-tint: {simplerInk.primary};"
          aria-label="Reverse sample"
        >
          Rev
        </button>
        {#if warping}
          <button
            onclick={handleWarpHalf}
            class="physical-button h-full w-full flex items-center justify-center text-[18px] font-bold uppercase tracking-wider"
            style="--btn-tint: {simplerInk.primary};"
            aria-label="Halve warped tempo"
          >
            ½×
          </button>
          <button
            onclick={handleWarpDouble}
            class="physical-button h-full w-full flex items-center justify-center text-[18px] font-bold uppercase tracking-wider"
            style="--btn-tint: {simplerInk.primary};"
            aria-label="Double warped tempo"
          >
            2×
          </button>
        {/if}
      </div>

      <!-- RANDOM (vertical) — Random Start's "Random Amount" param.
           Only renders when the device is on the chain; resolved by
           name so reordering / inserting utilities between Random
           Start and Simpler doesn't break the binding. Range is
           0–100 (%) to match the .amxd's parameter declaration.
           Sits in col 9 of the bottom row, past the seam in col 8 (col 7
           is Warp, which spans both rows). -->
      {#if randomAmountParamPath}
        <!-- Random Start is its own device, an M4L utility ahead of the
             Simpler, so a seam divides it from the Simpler's controls. -->
        <div class="col-start-8 row-start-2 flex min-h-0">
          <SectionDivider orientation="vertical" />
        </div>
        <div class="col-start-9 row-start-2 col-span-1 row-span-1 min-h-0 min-w-0">
          <DeviceSlider
            value={randomAmountValue}
            title="Random"
            orientation="vertical"
            labelOrientation="horizontal"
            color={simplerInk}
            min={0}
            max={100}
            onInteraction={(value) => {
              if (!randomAmountParamPath) return;
              selectedTrackStore.setParamValue(randomAmountParamPath, value);
            }}
          />
        </div>
      {/if}
    </div>
  {:else}
    <!-- Default state when no Simpler present -->
    <div class="flex-1 flex items-center justify-center">
      <DeviceEmptyState glyph="🎵" message="Load Simpler to test LiveAPI properties" color={simplerInk.primary} />
    </div>
  {/if}
</div>

<!-- Physical-button and segmented chrome now live in app.css as the shared
     .physical-button / .device-segmented / .device-segment classes (§5.5). -->

<style>
  /* Classic/Slice mode toggle chrome (GRATICULE) — the same declarations
     that used to sit inline on the button, lifted onto a class so the flat
     grammar below can re-skin them without `!important`. `--mode-ink` is
     set at the call site (the focused track's ink, ADR-402). */
  .mode-toggle-glass {
    background: color-mix(in oklab, var(--mode-ink) 30%, var(--card));
    border: 1px solid var(--mode-ink);
    color: var(--foreground);
  }

  /* ---- Live skin (flat grammar) ------------------------------------
     Simpler's Classic/Slice chooser is a plain rectangular control field
     in Live — no ink wash, no pill, no letter-spaced bold caps; the label
     alone says which mode is engaged. Poly/Thru + Warp segments and the
     LOOP / Rev / ½× / 2× physical buttons already come flat from app.css
     (.device-segmented / .physical-button); only the utility-class
     typography they carry here (font-bold uppercase tracking-wider) needs
     quieting to Live's regular-case, medium-weight control text. */
  :global([data-grammar="flat"]) .mode-toggle-glass {
    border-radius: var(--radius-sm);
    border-color: var(--line-strong);
    background: var(--surface-well);
    color: var(--foreground);
  }
  :global([data-grammar="flat"]) .mode-toggle-glass,
  :global([data-grammar="flat"]) .device-segment,
  :global([data-grammar="flat"]) .physical-button {
    text-transform: none;
    letter-spacing: 0;
    font-weight: var(--font-weight-medium);
  }
</style>
