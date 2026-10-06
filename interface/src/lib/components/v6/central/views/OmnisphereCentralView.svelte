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

  // The two envelopes, each four plain sliders, A-D-S-R (user's call,
  // 2026-10-01: the drawn curve's handles were too fiddly for a finger).
  // Parameter slots: amp A-D-S-R are 8-11, filter A-D-S-R 13-16, the filter
  // envelope's amount 5.
  const AMP_ENV = [['A', 8, 'attack'], ['D', 9, 'decay'], ['S', 10, 'sustain'], ['R', 11, 'release']] as const;
  const FILTER_ENV = [['A', 13, 'attack'], ['D', 14, 'decay'], ['S', 15, 'sustain'], ['R', 16, 'release']] as const;
  const FILTER_ENV_AMOUNT = 5;

  // Which envelope the sliders drive. The view's own, so it starts on Amp.
  let envMode = $state<'amp' | 'filter'>('amp');
  let env = $derived(envMode === 'amp' ? AMP_ENV : FILTER_ENV);

  // Color says which envelope is up (user's call, 2026-10-01): Amp wears the
  // theme's ON orange on the switch and its sliders; Filter wears the track's
  // ink on both, as the rest of the view does.
  const AMP_INK = {
    primary: 'var(--phosphor)',
    secondary: 'color-mix(in oklab, var(--phosphor) 10%, transparent)',
    accent: 'var(--phosphor)'
  };
  let envInk = $derived(envMode === 'amp' ? AMP_INK : omniInk);

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
         XY pad one; then the seam and the MIDI wheels. Three rows: a header
         (FX over the ORB, the Amp | Filter switch, and the swap pill over the
         XY pads), then
         two rows of controls. Every control starts on the same line under
         the header. -->
    <div class="omni-grid h-full w-full grid gap-(--central-gap) p-(--central-inset)">
      <!-- Col 1: FX in the header, the ORB under it (user's layout,
           2026-09-29). -->
      <button
        class="physical-button omni-fx w-full min-w-0 text-xl font-bold"
        class:active={fxIsOn}
        style="--btn-tint: {omniInk.primary}; grid-column: 1; grid-row: 1; height: var(--height-touch, 44px);"
        onclick={handleFxToggle}
      >
        FX
      </button>
      <div class="min-h-0" style="grid-column: 1; grid-row: 2 / 4;">
        <OrbControl
          angle={orbAngleValue}
          radius={orbRadiusValue}
          title="Orb"
          onInteraction={handleOrbInteraction}
          color={omniInk}
        />
      </div>

      <!-- Cols 2-3: one envelope at a time, full height, the Amp | Filter
           switch over it in the header (user's layout, 2026-09-29). Under
           Filter the envelope's Amount stands full height in the fifth
           column; under Amp the four sliders take that column too. It shares the
           view's rows (subgrid), so the switch sits level with the swap pill
           and the sliders start level with the pads. -->
      <div class="omni-envelopes min-w-0 min-h-0" style="grid-column: 2 / 4; grid-row: 1 / 4;">
        <div
          class="device-segmented omni-env-switch grid grid-cols-2 min-w-0"
          style="--btn-tint: {envInk.primary}; grid-column: 1 / 6; grid-row: 1;"
          role="radiogroup"
          aria-label="Envelope"
        >
          {#each [['amp', 'Amp'], ['filter', 'Filter']] as [mode, label] (mode)}
            <button
              class="device-segment text-base font-bold"
              class:active={envMode === mode}
              role="radio"
              aria-checked={envMode === mode}
              onclick={() => (envMode = mode as 'amp' | 'filter')}
            >
              {label}
            </button>
          {/each}
        </div>
        <div
          class="omni-env-sliders min-w-0 min-h-0"
          style="grid-column: {envMode === 'filter' ? '1 / 5' : '1 / 6'}; grid-row: 2 / 4;"
        >
          <!-- Keyed, so a switch mid-drag drops the held slider rather than
               carrying it onto the other envelope's parameters. -->
          {#key envMode}
            {#each env as [label, index, glyph] (index)}
              <DeviceSlider
                value={paramValue(index)}
                title={label}
                icon={glyph}
                orientation="vertical"
                labelOrientation="horizontal"
                color={envInk}
                onInteraction={(value) => writeParam(index, value)}
              />
            {/each}
          {/key}
        </div>
        {#if envMode === 'filter'}
          <div class="min-w-0 min-h-0" style="grid-column: 5; grid-row: 2 / 4;">
            <DeviceSlider
              value={paramValue(FILTER_ENV_AMOUNT)}
              title="Amt"
              icon="depth"
              orientation="vertical"
              labelOrientation="horizontal"
              color={omniInk}
              onInteraction={(value) => writeParam(FILTER_ENV_AMOUNT, value)}
            />
          </div>
        {/if}
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
          icon="unison"
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
          icon="reverb"
          titleClass="text-2xl font-bold"
          onInteraction={handleAmbianceXYInteraction}
          color={omniInk}
        />
      </div>

      <!-- Col 4, bottom: FILTER XY Pad -->
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 4; grid-row: 3;">
        <DeviceXY
          xValue={filterXValue}
          yValue={filterYValue}
          title="Filter"
          icon="filter"
          titleClass="text-2xl font-bold"
          onInteraction={handleFilterXYInteraction}
          color={omniInk}
        />
      </div>

      <!-- Col 5, bottom: VIBRATO XY Pad -->
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 5; grid-row: 3;">
        <DeviceXY
          xValue={vibratoXValue}
          yValue={vibratoYValue}
          title="Vibrato"
          icon="lfo"
          titleClass="text-2xl font-bold"
          onInteraction={handleVibratoXYInteraction}
          color={omniInk}
        />
      </div>

      <!-- The wheels send MIDI, not Omnisphere parameters: a seam divides the
           device from them, as in every instrument view (2026-09-13). The
           wrapper spans every row — SectionDivider takes no class of its own. -->
      <div class="flex min-h-0" style="grid-column: 6; grid-row: 1 / 4;">
        <SectionDivider orientation="vertical" />
      </div>

      <!-- Col 7, every row: MIDI Wheels -->
      <div class="flex flex-col min-h-0" style="grid-column: 7; grid-row: 1 / 4;">
        <MidiWheelsPanel />
      </div>

      <!-- EQ Sliders commented out for now
      <div class="flex gap-1 min-h-0 col-span-2">
        <div class="flex-1">
          <DeviceSlider
            value={eqLoValue}
            title="LO"
            icon="low"
            orientation="vertical"
            labelOrientation="horizontal"
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
            icon="tone"
            orientation="vertical"
            labelOrientation="horizontal"
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
            icon="high"
            orientation="vertical"
            labelOrientation="horizontal"
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
  /* The switch, then the curve down the view's other two rows. Amount's
     column (Filter only) is narrower: it is one control beside a curve. */
  .omni-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr)) auto minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) minmax(0, 1fr);
  }

  .omni-envelopes {
    display: grid;
    grid-template-columns: repeat(4, 1fr) 0.8fr;
    grid-template-rows: subgrid;
    column-gap: var(--central-gap);
  }

  .omni-env-sliders {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    column-gap: var(--central-gap);
  }

  /* The shared segmented chrome divides its options top to bottom; these two
     sit side by side, so the hairline goes between them instead. */
  .omni-env-switch {
    height: var(--height-touch, 44px);
  }
  .omni-env-switch :global(.device-segment + .device-segment) {
    border-top: 0;
    border-left: 1px solid var(--line-faint);
  }
  :global([data-grammar="flat"]) .omni-env-switch :global(.device-segment + .device-segment) {
    border-top: 0;
    border-left: 1px solid var(--line-strong);
  }

  /* The flat grammar fills every ON segment with its orange; here the fill
     follows the envelope's ink instead. */
  :global([data-grammar="flat"]) .omni-env-switch :global(.device-segment.active) {
    background: var(--btn-tint);
  }

  :global([data-grammar="flat"]) .omni-fx {
    font-weight: var(--font-weight-medium);
  }
</style>