<script lang="ts">
  import { session } from '$lib/stores/session.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import OrbControl from '../../device-panel/OrbControl.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import MidiWheelsPanel from '../../midi/MidiWheelsPanel.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { deviceInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { familyScheme } from '$lib/config/devicePresets';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  // Track reactive state
  let trackIndex = $derived(session.selectedTrackIndex);
  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);

  // PR-3.5.2a: path-keyed device lookup (v3 tree, chain-order indexed).
  // Returns `undefined` on cold start — same "show ghost" posture as
  // the v2 .find() it replaces.
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);

  // Fallback body scheme (distortion family) — used only on cold start, plus
  // the FX toggle + empty-state glyph. The whole view otherwise wears the
  // focused track's ink (ADR-402): every XY pad + the ORB take omniInk, so the
  // view reads as its track. Sections stay distinguished by their titles.
  const omnisphereColor = familyScheme('distortion');

  let omniInk = $derived(selectedTrackScheme() ?? {
    primary: deviceInk(omnisphereColor.primary, paintModeReactive()),
    secondary: omnisphereColor.secondary,
    accent: deviceInk(omnisphereColor.accent, paintModeReactive())
  });

  // All parameter values as $derived - always reactive to store changes
  let vibratoXValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 1)) ?? 0.5 : 0.5);
  let vibratoYValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 2)) ?? 0.5 : 0.5);
  let filterXValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 3)) ?? 0.5 : 0.5);
  let filterYValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 4)) ?? 0.5 : 0.5);
  let unisonXValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 6)) ?? 0.5 : 0.5);
  let unisonYValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 7)) ?? 0.5 : 0.5);
  let timeXValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 8)) ?? 0.5 : 0.5);
  let timeYValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 11)) ?? 0.5 : 0.5);
  let ambianceXValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 19)) ?? 0.5 : 0.5);
  let ambianceYValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 18)) ?? 0.5 : 0.5);
  let eqLoValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 20)) ?? 0.5 : 0.5);
  let eqMidValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 21)) ?? 0.5 : 0.5);
  let eqHiValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 22)) ?? 0.5 : 0.5);
  let fxValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 24)) ?? 0 : 0);
  let orbAngleValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 25)) ?? 0.5 : 0.5);
  let orbRadiusValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 26)) ?? 0.5 : 0.5);

  let fxIsOn = $derived(fxValue < 0.5); // Inverted: ON when param is 0, OFF when param is 1

  // XY interaction handlers - just send to store, control components handle local state
  function handleVibratoXYInteraction(x: number, y: number) {
    if (!device) return;
    const xPath = selectedTrackStore.paramPath(device, 1);
    const yPath = selectedTrackStore.paramPath(device, 2);
    selectedTrackStore.setParamValue(xPath, x);
    selectedTrackStore.setParamValue(yPath, y);
  }

  function handleFilterXYInteraction(x: number, y: number) {
    if (!device) return;
    const xPath = selectedTrackStore.paramPath(device, 3);
    const yPath = selectedTrackStore.paramPath(device, 4);
    selectedTrackStore.setParamValue(xPath, x);
    selectedTrackStore.setParamValue(yPath, y);
  }

  function handleUnisonXYInteraction(x: number, y: number) {
    if (!device) return;
    const xPath = selectedTrackStore.paramPath(device, 6);
    const yPath = selectedTrackStore.paramPath(device, 7);
    selectedTrackStore.setParamValue(xPath, x);
    selectedTrackStore.setParamValue(yPath, y);
  }

  function handleTimeXYInteraction(x: number, y: number) {
    if (!device) return;
    const xPath = selectedTrackStore.paramPath(device, 8);
    const yPath = selectedTrackStore.paramPath(device, 11);
    selectedTrackStore.setParamValue(xPath, x);
    selectedTrackStore.setParamValue(yPath, y);
  }

  function handleAmbianceXYInteraction(x: number, y: number) {
    if (!device) return;
    const xPath = selectedTrackStore.paramPath(device, 19);
    const yPath = selectedTrackStore.paramPath(device, 18);
    selectedTrackStore.setParamValue(xPath, x);
    selectedTrackStore.setParamValue(yPath, y);
  }

  function handleOrbInteraction(angle: number, radius: number) {
    if (!device) return;
    const anglePath = selectedTrackStore.paramPath(device, 25);
    const radiusPath = selectedTrackStore.paramPath(device, 26);
    selectedTrackStore.setParamValue(anglePath, angle);
    selectedTrackStore.setParamValue(radiusPath, radius);
  }

  // Handle FX toggle (inverted: clicking ON sets param to 0, clicking OFF sets param to 1)
  function handleFxToggle() {
    if (!device) return;
    const newValue = fxIsOn ? 1 : 0; // Inverted logic
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 24), newValue);
  }
</script>

<div class="h-full w-full">
  {#if instrument}
    <!-- Main content grid: 2 rows x 6 cols, plus an `auto` track for the seam -->
    <!-- ORB: 2 cols (double height), XY pads: 1 col each, seam, MIDI wheels: 1 col (double height) -->
    <div class="h-full w-full grid grid-rows-2 gap-(--central-gap) p-(--central-inset)" style="grid-template-columns: repeat(5, 1fr) auto 1fr;">
      <!-- Cols 1-2, Row 1 & 2: ORB Control (2 cols wide, double height),
           leading the view with the swap pill lying across it (user's
           layout, 2026-09-16) — it sat right of the pads, by the wheels.
           First in the DOM, so the pads flow into columns 3-5 around it. -->
      <div class="flex flex-col gap-(--central-gap) min-h-0 col-span-2 row-span-2">
        <HostedSwapPill />
        <div class="flex-1 min-h-0">
          <OrbControl
            angle={orbAngleValue}
            radius={orbRadiusValue}
            title="Orb"
            onInteraction={handleOrbInteraction}
            color={omniInk}
          />
        </div>
      </div>

      <!-- Col 3, Row 1: TIME XY Pad -->
      <div class="flex flex-col min-h-0 col-span-1">
        <DeviceXY
          xValue={timeXValue}
          yValue={timeYValue}
          title="Time"
          titleClass="text-2xl font-bold"
          onInteraction={handleTimeXYInteraction}
          color={omniInk}
        />
      </div>

      <!-- Col 4, Row 1: UNISON XY Pad -->
      <div class="flex flex-col min-h-0 col-span-1">
        <DeviceXY
          xValue={unisonXValue}
          yValue={unisonYValue}
          title="Unison"
          titleClass="text-2xl font-bold"
          onInteraction={handleUnisonXYInteraction}
          color={omniInk}
        />
      </div>

      <!-- Col 5, Row 1: SPACE XY Pad -->
      <div class="flex flex-col min-h-0 col-span-1">
        <DeviceXY
          xValue={ambianceXValue}
          yValue={ambianceYValue}
          title="Space"
          titleClass="text-2xl font-bold"
          onInteraction={handleAmbianceXYInteraction}
          color={omniInk}
        />
      </div>

      <!-- The wheels send MIDI, not Omnisphere parameters: a seam divides the
           device from them, as in every instrument view (2026-09-13). The
           wrapper spans both rows — SectionDivider takes no class of its own. -->
      <div class="flex min-h-0 row-span-2">
        <SectionDivider orientation="vertical" />
      </div>

      <!-- Col 7, Row 1 & 2: MIDI Wheels (double height) -->
      <div class="flex flex-col min-h-0 col-span-1 row-span-2">
        <MidiWheelsPanel />
      </div>

      <!-- Col 3, Row 2: FILTER XY Pad -->
      <div class="flex flex-col min-h-0 col-span-1">
        <DeviceXY
          xValue={filterXValue}
          yValue={filterYValue}
          title="Filter"
          titleClass="text-2xl font-bold"
          onInteraction={handleFilterXYInteraction}
          color={omniInk}
        />
      </div>

      <!-- Col 4, Row 2: VIBRATO XY Pad -->
      <div class="flex flex-col min-h-0 col-span-1">
        <DeviceXY
          xValue={vibratoXValue}
          yValue={vibratoYValue}
          title="Vibrato"
          titleClass="text-2xl font-bold"
          onInteraction={handleVibratoXYInteraction}
          color={omniInk}
        />
      </div>

      <!-- Col 5, Row 2: FX Button -->
      <div class="flex flex-col min-h-0 col-span-1">
        <button
          class="physical-button omni-fx h-full w-full text-4xl font-bold"
          class:active={fxIsOn}
          style="--btn-tint: {omniInk.primary};"
          onclick={handleFxToggle}
        >
          FX
        </button>
      </div>

      <!-- EQ Sliders commented out for now
      <div class="flex gap-1 min-h-0 col-span-2">
        <div class="flex-1">
          <DeviceSlider
            value={eqLoValue}
            title="LO"
            orientation="vertical"
            color={omnisphereColor}
            onInteraction={(value) => {
              if (!device) return;
              selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 20), value);
            }}
          />
        </div>
        <div class="flex-1">
          <DeviceSlider
            value={eqMidValue}
            title="MID"
            orientation="vertical"
            color={omnisphereColor}
            onInteraction={(value) => {
              if (!device) return;
              selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 21), value);
            }}
          />
        </div>
        <div class="flex-1">
          <DeviceSlider
            value={eqHiValue}
            title="HI"
            orientation="vertical"
            color={omnisphereColor}
            onInteraction={(value) => {
              if (!device) return;
              selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 22), value);
            }}
          />
        </div>
      </div>
      -->
    </div>
  {:else}
    <!-- Default state when no Omnisphere present -->
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <div class="text-4xl mb-4" style="color: {omniInk.primary}">🎹</div>
        <p class="text-sm text-muted-foreground/70">Load Omnisphere to access macro controls</p>
      </div>
    </div>
  {/if}
</div>

<style>
  /* ---- Live skin (flat grammar): the five XY pads are DeviceXY (flat
     well, 1px frame, re-cased title — its .center-title rule outranks the
     text-2xl / font-bold titleClass passed here), the ORB is OrbControl
     (flat well + re-cased title live in that component) and the wheels are
     MidiWheelsPanel — their flat look is theirs to own, not restyled from
     here. The only chrome this file draws itself is the FX toggle: a .physical-button
     (already the flat field / ChosenDefault ON) whose bold literal settles
     to medium. Graticule is untouched — the rule sits under
     [data-grammar="flat"]. */
  :global([data-grammar="flat"]) .omni-fx {
    font-weight: var(--font-weight-medium);
  }
</style>