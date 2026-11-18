<script lang="ts">
  /**
   * Omnisphere Central View: the plug-in's macros as the user laid them out
   * (2026-10-12). Compact (ADR-546): the swap pill over six pads, three
   * columns of two: Unison over Filter, Space over Vibrato, and the two
   * envelopes as Time pads, Amp (Attack across, Release up) over Filter
   * Env (Attack across, Decay up); then the FX switch over the Filter
   * envelope's Amount, each level with its envelope. Full screen: the four
   * macro pads, then both envelopes' four stages, Amp over Filter, then FX
   * over Env Amt (the compact layout until ADR-546).
   *
   * Ink (ADR-544): everything is the selected track's. The Amp envelope
   * wore the theme's ON colour to tell it from the Filter's (2026-10-01);
   * ON's colour is a lit switch's alone now, and the two envelopes are
   * told apart by their names. An envelope's stages are knobs, each with
   * its letter in its middle (ADR-509's A D S R): as short value boxes, a
   * stage at its top was a solid block of the amount's colour beside the
   * FX switch and read as a second switch that was on. A knob turns as the
   * box moved (the same drag over the same travel), so nothing changes
   * under a finger. Env Amt stays a box (user, 2026-11-06).
   */
  import { press } from '$lib/actions/press';
  import { session } from '$lib/stores/session.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import EnvelopeGroup from './EnvelopeGroup.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { selectedAmountScheme } from '$lib/utils/selectedTrackInk';
  import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  // Track reactive state
  let trackIndex = $derived(session.selectedTrackIndex);

  // PR-3.5.2a: path-keyed device lookup (v3 tree, chain-order indexed).
  // Returns `undefined` on cold start — same "show ghost" posture as
  // the v2 .find() it replaces.
  let device = $derived(selectedTrackStore.instrumentDevice(instrument));

  // One ink (ADR-544): the selected track's, for every pad, stage and box.
  let omniInk = $derived(selectedAmountScheme());

  // All parameter values as $derived - always reactive to store changes
  let vibratoXValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 1)) ?? 0.5 : 0.5);
  let vibratoYValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 2)) ?? 0.5 : 0.5);
  let filterXValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 3)) ?? 0.5 : 0.5);
  let filterYValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 4)) ?? 0.5 : 0.5);
  let unisonXValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 6)) ?? 0.5 : 0.5);
  let unisonYValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 7)) ?? 0.5 : 0.5);
  let ambianceXValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 19)) ?? 0.5 : 0.5);
  let ambianceYValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 18)) ?? 0.5 : 0.5);
  let fxValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 24)) ?? 0 : 0);

  // The two envelopes, each four plain controls, A-D-S-R (user's call,
  // 2026-10-01: the drawn curve's handles were too fiddly for a finger).
  // Parameter slots: amp A-D-S-R are 8-11, filter A-D-S-R 13-16, the filter
  // envelope's amount 5.
  const AMP_ENV = [['A', 8, 'Attack'], ['D', 9, 'Decay'], ['S', 10, 'Sustain'], ['R', 11, 'Release']] as const;
  const FILTER_ENV = [['A', 13, 'Attack'], ['D', 14, 'Decay'], ['S', 15, 'Sustain'], ['R', 16, 'Release']] as const;
  const FILTER_ENV_AMOUNT = 5;
  const ENVELOPES = [
    { title: 'Amp Envelope', stages: AMP_ENV },
    { title: 'Filter Envelope', stages: FILTER_ENV }
  ] as const;

  /** The compact face's Time pads (ADR-546): [title, x param, y param]. */
  const TIME_PADS = [
    { title: 'Amp', x: 8, y: 11 },
    { title: 'Filter Env', x: 13, y: 14 }
  ] as const;

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

  // Handle FX toggle (inverted: clicking ON sets param to 0, clicking OFF sets param to 1)
  function handleFxToggle() {
    if (!device) return;
    const newValue = fxIsOn ? 1 : 0; // Inverted logic
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 24), newValue);
  }
</script>

{#snippet unisonPad()}
  <DeviceXY
    xValue={unisonXValue}
    yValue={unisonYValue}
    title="Unison"
    icon="unison"
    titleClass="text-2xl font-bold"
    onInteraction={handleUnisonXYInteraction}
    color={omniInk}
  />
{/snippet}
{#snippet spacePad()}
  <DeviceXY
    xValue={ambianceXValue}
    yValue={ambianceYValue}
    title="Space"
    icon="reverb"
    titleClass="text-2xl font-bold"
    onInteraction={handleAmbianceXYInteraction}
    color={omniInk}
  />
{/snippet}
{#snippet filterPad()}
  <DeviceXY
    xValue={filterXValue}
    yValue={filterYValue}
    title="Filter"
    icon="filter"
    titleClass="text-2xl font-bold"
    onInteraction={handleFilterXYInteraction}
    color={omniInk}
  />
{/snippet}
{#snippet vibratoPad()}
  <DeviceXY
    xValue={vibratoXValue}
    yValue={vibratoYValue}
    title="Vibrato"
    icon="lfo"
    titleClass="text-2xl font-bold"
    onInteraction={handleVibratoXYInteraction}
    color={omniInk}
  />
{/snippet}
{#snippet fxSwitch()}
  <button
    class="physical-button btn-toggle omni-fx w-full h-full min-w-0 min-h-0 text-xl font-bold"
    class:active={fxIsOn}
    aria-pressed={fxIsOn}
    use:press={{ onPress: () => handleFxToggle() }}
  >
    FX
  </button>
{/snippet}
{#snippet envAmount()}
  <div class="env-amount w-full min-w-0 min-h-0 h-full" data-param="filter-env-amount">
    <DeviceSlider
      value={paramValue(FILTER_ENV_AMOUNT)}
      title="Env Amt"
      orientation="vertical"
      color={omniInk}
      readout={display(FILTER_ENV_AMOUNT)}
      onInteraction={(value) => writeParam(FILTER_ENV_AMOUNT, value)}
    />
  </div>
{/snippet}

<div class="h-full w-full">
  {#if instrument && centralDisplayStore.expanded}
    <!-- Full screen (ADR-546): the four macro pads, then both envelopes'
         four stages, Amp over Filter, then FX over Env Amt (the compact
         layout of 2026-10-12 to ADR-546). Three rows: a header (the swap
         pill over the pads), then two rows of controls; the envelopes take
         all three (ADR-477). -->
    <div class="omni-grid omni-board h-full w-full grid gap-(--central-gap) p-(--central-inset)">
      <div class="flex flex-col justify-center min-w-0" style="grid-column: 1 / 3; grid-row: 1;">
        <HostedSwapPill />
      </div>

      <!-- Cols 3-4, every row: both envelopes, Amp over Filter, a seam
           between the two. A stage is a knob with its letter in its
           middle (ADR-509), named in full for assistive tech; its value
           takes the letter's place while a finger turns it. -->
      <div class="omni-envelopes min-w-0 min-h-0 flex flex-col gap-(--central-gap)" style="grid-column: 3 / 5; grid-row: 1 / 4;">
        {#each ENVELOPES as envelope, e (envelope.title)}
          {#if e > 0}<SectionDivider orientation="horizontal" ink={omniInk.primary} />{/if}
          <!-- `ink` colours the group's name: a section's name is a label, not the amount's colour. -->
          <EnvelopeGroup ink="var(--value)" title={envelope.title} edges="none">
            {#each envelope.stages as [letter, index, name] (index)}
              <div class="flex-1 min-w-0 h-full" data-envelope-stage={letter}>
                <DeviceSlider
                  value={paramValue(index)}
                  title={name}
                  face="knob"
                  knobSize="m"
                  knobFit
                  knobCaption={false}
                  knobMark={letter}
                  color={omniInk}
                  readout={display(index)}
                  onInteraction={(value) => writeParam(index, value)}
                />
              </div>
            {/each}
          </EnvelopeGroup>
        {/each}
      </div>

      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 1; grid-row: 2;">{@render unisonPad()}</div>
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 2; grid-row: 2;">{@render spacePad()}</div>
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 1; grid-row: 3;">{@render filterPad()}</div>
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 2; grid-row: 3;">{@render vibratoPad()}</div>

      <!-- Col 5: the FX switch over the Filter envelope's Amount, built like
           the envelopes beside it — a title line, the control, the seam, a
           title line, the control — so FX is exactly as tall as the Amp
           stages and Env Amt as the Filter's. -->
      <div class="omni-fx-col min-w-0 min-h-0 flex flex-col gap-(--central-gap)" style="grid-column: 5; grid-row: 1 / 4;">
        <EnvelopeGroup ink={omniInk.primary} title={'\u00a0'} edges="none">
          {@render fxSwitch()}
        </EnvelopeGroup>
        <!-- The seam's 1px, kept so the rows line up, but not drawn: the
             envelopes' seam is the one that reads. -->
        <div class="flex-none" style="height: 1px;" aria-hidden="true"></div>
        <EnvelopeGroup ink={omniInk.primary} title={'\u00a0'} edges="none">
          {@render envAmount()}
        </EnvelopeGroup>
      </div>
    </div>
  {:else if instrument}
    <!-- Compact (ADR-546): the swap pill over three columns of two pads,
         Unison over Filter, Space over Vibrato, Amp's Time over the Filter
         envelope's; then FX level with Amp and Env Amt level with the
         Filter envelope it scales. -->
    <div class="omni-grid omni-face h-full w-full grid gap-(--central-gap) p-(--central-inset)">
      <div class="flex flex-col justify-center min-w-0" style="grid-column: 1 / 4; grid-row: 1;">
        <HostedSwapPill />
      </div>
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 1; grid-row: 2;">{@render unisonPad()}</div>
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 2; grid-row: 2;">{@render spacePad()}</div>
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 1; grid-row: 3;">{@render filterPad()}</div>
      <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 2; grid-row: 3;">{@render vibratoPad()}</div>
      {#each TIME_PADS as pad, row (pad.title)}
        <div class="flex flex-col min-h-0 min-w-0" style="grid-column: 3; grid-row: {row + 2};" data-envelope={pad.title} data-time-pad>
          <DeviceXY
            xValue={paramValue(pad.x)}
            yValue={paramValue(pad.y)}
            title={pad.title}
            icon="envelope"
            titleClass="text-2xl font-bold"
            onInteraction={(x, y) => {
              writeParam(pad.x, x);
              writeParam(pad.y, y);
            }}
            color={omniInk}
          />
        </div>
      {/each}
      <div class="min-w-0 min-h-0" style="grid-column: 4; grid-row: 2;">{@render fxSwitch()}</div>
      <div class="min-w-0 min-h-0" style="grid-column: 4; grid-row: 3;">{@render envAmount()}</div>
    </div>
  {:else}
    <!-- Default state when no Omnisphere present -->
    <DeviceEmptyState message="Load Omnisphere to access macro controls" color={omniInk.primary} />
  {/if}
</div>

<style>
  /* ---- Live skin (flat grammar): the four XY pads are DeviceXY (flat
     well, 1px frame, re-cased title — its .center-title rule outranks the
     text-2xl / font-bold titleClass passed here) — their flat look
     is theirs to own, not restyled from here. The only chrome this file draws itself is the FX toggle: a .physical-button
     (already the flat field / ChosenDefault ON) whose bold literal settles
     to medium. Graticule is untouched — the rule sits under
     [data-grammar="flat"]. */
  /* Full screen: four equal columns, then the FX switch's column at a fixed width. */
  .omni-grid {
    grid-template-rows: auto minmax(0, 1fr) minmax(0, 1fr);
  }
  .omni-board {
    grid-template-columns: repeat(4, minmax(0, 1fr)) 72px;
  }
  /* Three equal columns of pads, then FX and Env Amt at the same width. */
  .omni-face {
    grid-template-columns: repeat(3, minmax(0, 1fr)) 72px;
  }


  :global([data-grammar="flat"]) .omni-fx {
    font-weight: var(--font-weight-medium);
  }
</style>