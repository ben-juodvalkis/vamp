<script lang="ts">
  import { session } from '$lib/stores/session.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import OrbControl from '../../device-panel/OrbControl.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import EnvelopeEditor, { type EnvelopeStage } from '../../device-panel/EnvelopeEditor.svelte';
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

  // The two envelopes, each an ADSR drawn as Live draws one (user's layout,
  // 2026-09-29: sliders first, then the curve). They replaced the Time pad,
  // which drove amp attack and release as one XY. Parameter slots: amp
  // A-D-S-R are 8-11, filter A-D-S-R 13-16, the filter envelope's amount 5.
  const AMP_ENV: Record<EnvelopeStage, number> = { attack: 8, decay: 9, sustain: 10, release: 11 };
  const FILTER_ENV: Record<EnvelopeStage, number> = { attack: 13, decay: 14, sustain: 15, release: 16 };
  const FILTER_ENV_AMOUNT = 5;

  function paramDisplay(index: number): string | undefined {
    return device ? selectedTrackStore.paramDisplay(selectedTrackStore.paramPath(device, index)) : undefined;
  }

  function envDisplays(env: Record<EnvelopeStage, number>) {
    return {
      attack: paramDisplay(env.attack),
      decay: paramDisplay(env.decay),
      sustain: paramDisplay(env.sustain),
      release: paramDisplay(env.release)
    };
  }

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
    <!-- Main content grid, the user's layout (2026-09-29): five equal
         columns before the seam: the ORB takes one, the envelopes two, each
         XY pad one; then the seam and the MIDI wheels. Four rows: a header
         (the envelope's name, and the swap pill over the XY pads), the top
         controls, the filter envelope's name, the bottom controls. Every
         control in a band starts on the same line, whatever sits above it. -->
    <div class="omni-grid h-full w-full grid gap-(--central-gap) p-(--central-inset)">
      <!-- Col 1, under the header: the ORB. -->
      <div class="min-h-0" style="grid-column: 1; grid-row: 2 / 5;">
        <OrbControl
          angle={orbAngleValue}
          radius={orbRadiusValue}
          title="Orb"
          onInteraction={handleOrbInteraction}
          color={omniInk}
        />
      </div>

      <!-- Cols 2-3: the envelopes, amp over filter, each an editable curve;
           the filter's Amount takes the fifth column, and FX stands over it
           in the amp row's. It shares
           the view's rows (subgrid), so its names sit in the header and
           middle rows and its sliders start level with the pads. -->
      <div class="omni-envelopes min-w-0 min-h-0" style="grid-column: 2 / 4; grid-row: 1 / 5;">
        <span class="omni-env-title" style="color: {omniInk.primary}; grid-column: 1 / 5; grid-row: 1;">Amp Env</span>
        <div class="min-w-0 min-h-0" style="grid-column: 1 / 5; grid-row: 2;">
          <EnvelopeEditor
            title="Amp Envelope"
            attack={paramValue(AMP_ENV.attack)}
            decay={paramValue(AMP_ENV.decay)}
            sustain={paramValue(AMP_ENV.sustain)}
            release={paramValue(AMP_ENV.release)}
            displays={envDisplays(AMP_ENV)}
            color={omniInk}
            onChange={(stage, value) => writeParam(AMP_ENV[stage], value)}
          />
        </div>
        <button
          class="physical-button omni-fx w-full h-full min-h-0 text-xl font-bold"
          class:active={fxIsOn}
          style="--btn-tint: {omniInk.primary}; grid-column: 5; grid-row: 2;"
          onclick={handleFxToggle}
        >
          FX
        </button>
        <span class="omni-env-title" style="color: {omniInk.primary}; grid-column: 1 / 6; grid-row: 3;">Filter Env</span>
        <div class="min-w-0 min-h-0" style="grid-column: 1 / 5; grid-row: 4;">
          <EnvelopeEditor
            title="Filter Envelope"
            attack={paramValue(FILTER_ENV.attack)}
            decay={paramValue(FILTER_ENV.decay)}
            sustain={paramValue(FILTER_ENV.sustain)}
            release={paramValue(FILTER_ENV.release)}
            displays={envDisplays(FILTER_ENV)}
            color={omniInk}
            onChange={(stage, value) => writeParam(FILTER_ENV[stage], value)}
          />
        </div>
        <div class="min-w-0 min-h-0" style="grid-column: 5; grid-row: 4;">
          <DeviceSlider
            value={paramValue(FILTER_ENV_AMOUNT)}
            title="Amt"
            orientation="vertical"
            color={omniInk}
            onInteraction={(value) => writeParam(FILTER_ENV_AMOUNT, value)}
          />
        </div>
      </div>

      <!-- Cols 4-5, header: the swap pill, one line across both pads. -->
      <div class="flex flex-col justify-center min-w-0" style="grid-column: 4 / 6; grid-row: 1;">
        <HostedSwapPill />
      </div>

      <!-- Col 4, top: UNISON XY Pad -->
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 4; grid-row: 2;">
        <DeviceXY
          xValue={unisonXValue}
          yValue={unisonYValue}
          title="Unison"
          titleClass="text-2xl font-bold"
          onInteraction={handleUnisonXYInteraction}
          color={omniInk}
        />
      </div>

      <!-- Col 5, top: SPACE XY Pad -->
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 5; grid-row: 2;">
        <DeviceXY
          xValue={ambianceXValue}
          yValue={ambianceYValue}
          title="Space"
          titleClass="text-2xl font-bold"
          onInteraction={handleAmbianceXYInteraction}
          color={omniInk}
        />
      </div>

      <!-- Col 4, bottom: FILTER XY Pad, level with the filter envelope. -->
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 4; grid-row: 4;">
        <DeviceXY
          xValue={filterXValue}
          yValue={filterYValue}
          title="Filter"
          titleClass="text-2xl font-bold"
          onInteraction={handleFilterXYInteraction}
          color={omniInk}
        />
      </div>

      <!-- Col 5, bottom: VIBRATO XY Pad -->
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 5; grid-row: 4;">
        <DeviceXY
          xValue={vibratoXValue}
          yValue={vibratoYValue}
          title="Vibrato"
          titleClass="text-2xl font-bold"
          onInteraction={handleVibratoXYInteraction}
          color={omniInk}
        />
      </div>

      <!-- The wheels send MIDI, not Omnisphere parameters: a seam divides the
           device from them, as in every instrument view (2026-09-13). The
           wrapper spans every row — SectionDivider takes no class of its own. -->
      <div class="flex min-h-0" style="grid-column: 6; grid-row: 1 / 5;">
        <SectionDivider orientation="vertical" />
      </div>

      <!-- Col 7, every row: MIDI Wheels -->
      <div class="flex flex-col min-h-0" style="grid-column: 7; grid-row: 1 / 5;">
        <MidiWheelsPanel />
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
  /* Amp title, amp stages, filter title, filter stages — the view's rows.
     Amount's column is
     narrower: it is one control beside a curve. */
  .omni-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr)) auto minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto minmax(0, 1fr);
  }

  .omni-envelopes {
    display: grid;
    grid-template-columns: repeat(4, 1fr) 0.8fr;
    grid-template-rows: subgrid;
    column-gap: var(--central-gap);
  }

  /* The eyebrow every named group in a central view wears (EnvelopeGroup's). */
  .omni-env-title {
    align-self: center;
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