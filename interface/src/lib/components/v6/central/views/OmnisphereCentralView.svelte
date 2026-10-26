<script lang="ts">
  import { session } from '$lib/stores/session.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import OrbControl from '../../device-panel/OrbControl.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import EnvelopeGroup from './EnvelopeGroup.svelte';
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

  // Color says which envelope is which (user's call, 2026-10-01): Amp wears
  // the theme's ON orange; Filter wears the track's ink, as the rest of the
  // view does. Both are in view since ADR-477, Amp over Filter.
  const AMP_INK = {
    primary: 'var(--phosphor)',
    secondary: 'color-mix(in oklab, var(--phosphor) 10%, transparent)',
    accent: 'var(--phosphor)'
  };

  function paramValue(index: number): number {
    return device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, index)) ?? 0.5 : 0.5;
  }

  function writeParam(index: number, value: number) {
    if (!device) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, index), value);
  }

  /** Live's own value, a box's readout while it is dragged (ADR-477); sent only while the UI writes. */
  function display(index: number): string | undefined {
    if (!device) return undefined;
    return selectedTrackStore.paramDisplay(selectedTrackStore.paramPath(device, index));
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
    <!-- Main content grid, the user's layout (2026-10-12): six equal
         columns in three equal sections: the four XY pads take two, the ORB
         two (2026-10-12), the envelopes two; then the FX switch, the
         column's full height. Three rows: a header (the swap pill over the
         pads), then two rows of controls. The ORB and the envelopes take
         all three rows, full height (2026-10-12; the envelopes since
         ADR-477). The seam and the wheels that stood under FX left for the
         MidiWheels device's chain cell (user, 2026-10-26). -->
    <div class="omni-grid h-full w-full grid gap-(--central-gap) p-(--central-inset)">
      <!-- Cols 1-2, header: the swap pill, top-left as in every instrument
           view (2026-10-06), over the pads. -->
      <div class="flex flex-col justify-center min-w-0" style="grid-column: 1 / 3; grid-row: 1;">
        <HostedSwapPill />
      </div>

      <!-- Cols 3-4, every row: the ORB. -->
      <div class="min-h-0" style="grid-column: 3 / 5; grid-row: 1 / 4;">
        <OrbControl
          angle={orbAngleValue}
          radius={orbRadiusValue}
          title="Orb"
          onInteraction={handleOrbInteraction}
          color={omniInk}
        />
      </div>

      <!-- Cols 5-6, every row: both envelopes, Amp over Filter, as value
           boxes (ADR-477) — no switch, each box half a slider's height and
           as fine. The Filter envelope's Amount is its fifth box, narrower:
           one control beside a curve. A seam between the two. -->
      <div class="omni-envelopes min-w-0 min-h-0 flex flex-col gap-(--central-gap)" style="grid-column: 5 / 7; grid-row: 1 / 4;">
        <EnvelopeGroup ink={AMP_INK.primary} title="Amp Envelope" edges="none">
          {#each AMP_ENV as [label, index, glyph] (index)}
            <div class="flex-1 min-w-0 h-full">
              <DeviceSlider
                value={paramValue(index)}
                title={label}
                icon={glyph}
                orientation="vertical"
                color={AMP_INK}
                readout={display(index)}
                onInteraction={(value) => writeParam(index, value)}
              />
            </div>
          {/each}
        </EnvelopeGroup>
        <SectionDivider orientation="horizontal" ink={omniInk.primary} />
        <EnvelopeGroup ink={omniInk.primary} title="Filter Envelope" edges="none">
          {#each FILTER_ENV as [label, index, glyph] (index)}
            <div class="flex-1 min-w-0 h-full">
              <DeviceSlider
                value={paramValue(index)}
                title={label}
                icon={glyph}
                orientation="vertical"
                color={omniInk}
                readout={display(index)}
                onInteraction={(value) => writeParam(index, value)}
              />
            </div>
          {/each}
          <div class="env-amount min-w-0 h-full">
            <DeviceSlider
              value={paramValue(FILTER_ENV_AMOUNT)}
              title="Amt"
              icon="depth"
              orientation="vertical"
              color={omniInk}
              readout={display(FILTER_ENV_AMOUNT)}
              onInteraction={(value) => writeParam(FILTER_ENV_AMOUNT, value)}
            />
          </div>
        </EnvelopeGroup>
      </div>

      <!-- Col 1, top: UNISON XY Pad -->
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 1; grid-row: 2;">
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

      <!-- Col 2, top: SPACE XY Pad -->
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 2; grid-row: 2;">
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

      <!-- Col 1, bottom: FILTER XY Pad -->
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 1; grid-row: 3;">
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

      <!-- Col 2, bottom: VIBRATO XY Pad -->
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 2; grid-row: 3;">
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

      <!-- Col 7, every row: the FX switch. -->
      <button
        class="physical-button omni-fx w-full h-full min-w-0 min-h-0 text-xl font-bold"
        class:active={fxIsOn}
        style="--btn-tint: {omniInk.primary}; grid-column: 7; grid-row: 1 / 4;"
        onclick={handleFxToggle}
      >
        FX
      </button>

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
     (flat well + re-cased title live in that component) — their flat look
     is theirs to own, not restyled from here. The only chrome this file draws itself is the FX toggle: a .physical-button
     (already the flat field / ChosenDefault ON) whose bold literal settles
     to medium. Graticule is untouched — the rule sits under
     [data-grammar="flat"]. */
  /* Six equal columns, then the FX switch's column at a fixed width. */
  .omni-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr)) 72px;
    grid-template-rows: auto minmax(0, 1fr) minmax(0, 1fr);
  }

  /* The Filter envelope's Amount: one control beside a curve, narrower. */
  .env-amount {
    flex: 0.8 1 0;
  }

  :global([data-grammar="flat"]) .omni-fx {
    font-weight: var(--font-weight-medium);
  }
</style>