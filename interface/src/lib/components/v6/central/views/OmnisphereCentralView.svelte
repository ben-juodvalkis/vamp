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
  let ambianceXValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 19)) ?? 0.5 : 0.5);
  let ambianceYValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 18)) ?? 0.5 : 0.5);
  let eqLoValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 20)) ?? 0.5 : 0.5);
  let eqMidValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 21)) ?? 0.5 : 0.5);
  let eqHiValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 22)) ?? 0.5 : 0.5);
  let fxValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 24)) ?? 0 : 0);
  let orbAngleValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 25)) ?? 0.5 : 0.5);
  let orbRadiusValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 26)) ?? 0.5 : 0.5);

  // The two envelopes, one slider a stage (user's layout, 2026-09-29: they
  // replaced the Time pad, which drove amp attack and release as one XY).
  // Parameter slots: amp A-D-S-R are 8-11, filter A-D-S-R 13-16, and the
  // filter envelope's amount is 5.
  const AMP_ENV = [
    { title: 'A', index: 8 },
    { title: 'D', index: 9 },
    { title: 'S', index: 10 },
    { title: 'R', index: 11 }
  ];
  const FILTER_ENV = [
    { title: 'A', index: 13 },
    { title: 'D', index: 14 },
    { title: 'S', index: 15 },
    { title: 'R', index: 16 },
    { title: 'Amt', index: 5 }
  ];

  function paramValue(index: number): number {
    return device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, index)) ?? 0.5 : 0.5;
  }

  function writeParam(index: number, value: number) {
    if (!device) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, index), value);
  }

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
    <!-- Main content grid, the user's layout (2026-09-29): the ORB column
         (swap pill, FX, ORB), the two envelopes stacked, the four XY pads in
         a 2 x 2, then the seam and the MIDI wheels. -->
    <div class="h-full w-full grid grid-rows-2 gap-(--central-gap) p-(--central-inset)" style="grid-template-columns: 2fr 2fr 1.5fr 1.5fr auto 1fr;">
      <!-- Col 1, both rows: the swap pill, the FX toggle under it, then the
           ORB taking the rest of the column. -->
      <div class="flex flex-col gap-(--central-gap) min-h-0 row-span-2">
        <HostedSwapPill />
        <button
          class="physical-button omni-fx w-full h-12 shrink-0 text-xl font-bold"
          class:active={fxIsOn}
          style="--btn-tint: {omniInk.primary};"
          onclick={handleFxToggle}
        >
          FX
        </button>
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

      <!-- Col 2, both rows: the envelopes. Amp over filter, on one ruler, so
           each amp stage stands over the same filter stage; the filter's
           Amount takes the fifth column, which the amp row leaves empty. -->
      <div class="omni-envelopes min-w-0 min-h-0 row-span-2">
        <span class="omni-env-title" style="color: {omniInk.primary}; grid-column: 1 / 5;">Amp Env</span>
        {#each AMP_ENV as stage (stage.index)}
          <div class="min-w-0 min-h-0" style="grid-row: 2;">
            <DeviceSlider
              value={paramValue(stage.index)}
              title={stage.title}
              orientation="vertical"
              color={omniInk}
              onInteraction={(value) => writeParam(stage.index, value)}
            />
          </div>
        {/each}
        <span class="omni-env-title" style="color: {omniInk.primary}; grid-column: 1 / 6; grid-row: 3; margin-top: var(--central-gap);">Filter Env</span>
        {#each FILTER_ENV as stage (stage.index)}
          <div class="min-w-0 min-h-0" style="grid-row: 4;">
            <DeviceSlider
              value={paramValue(stage.index)}
              title={stage.title}
              orientation="vertical"
              color={omniInk}
              onInteraction={(value) => writeParam(stage.index, value)}
            />
          </div>
        {/each}
      </div>

      <!-- Col 3, Row 1: UNISON XY Pad -->
      <div class="flex flex-col min-h-0 min-w-0">
        <DeviceXY
          xValue={unisonXValue}
          yValue={unisonYValue}
          title="Unison"
          titleClass="text-2xl font-bold"
          onInteraction={handleUnisonXYInteraction}
          color={omniInk}
        />
      </div>

      <!-- Col 4, Row 1: SPACE XY Pad -->
      <div class="flex flex-col min-h-0 min-w-0">
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

      <!-- Col 6, both rows: MIDI Wheels -->
      <div class="flex flex-col min-h-0 row-span-2">
        <MidiWheelsPanel />
      </div>

      <!-- Col 3, Row 2: FILTER XY Pad -->
      <div class="flex flex-col min-h-0 min-w-0">
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
      <div class="flex flex-col min-h-0 min-w-0">
        <DeviceXY
          xValue={vibratoXValue}
          yValue={vibratoYValue}
          title="Vibrato"
          titleClass="text-2xl font-bold"
          onInteraction={handleVibratoXYInteraction}
          color={omniInk}
        />
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
  /* ---- Live skin (flat grammar): the four XY pads are DeviceXY (flat
     well, 1px frame, re-cased title — its .center-title rule outranks the
     text-2xl / font-bold titleClass passed here), the ORB is OrbControl
     (flat well + re-cased title live in that component) and the wheels are
     MidiWheelsPanel — their flat look is theirs to own, not restyled from
     here. The only chrome this file draws itself is the FX toggle: a .physical-button
     (already the flat field / ChosenDefault ON) whose bold literal settles
     to medium. Graticule is untouched — the rule sits under
     [data-grammar="flat"]. */
  /* Amp title, amp stages, filter title, filter stages. Amount's column is
     narrower: it is one knob beside a set, not a fifth stage. */
  .omni-envelopes {
    display: grid;
    grid-template-columns: repeat(4, 1fr) 0.8fr;
    grid-template-rows: auto 1fr auto 1fr;
    column-gap: var(--central-gap);
    row-gap: var(--spacing-xs);
  }

  /* The eyebrow every named group in a central view wears (EnvelopeGroup's). */
  .omni-env-title {
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-align: center;
    white-space: nowrap;
  }

  :global([data-grammar="flat"]) .omni-env-title {
    letter-spacing: normal;
    font-weight: var(--font-weight-medium);
  }

  :global([data-grammar="flat"]) .omni-fx {
    font-weight: var(--font-weight-medium);
  }
</style>