<script lang="ts">
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import EnvelopeGroup from './EnvelopeGroup.svelte';
  import MidiWheel from '../../midi/MidiWheel.svelte';
  import { sendPitchWheel, sendModWheel } from '$lib/api/midiWheels';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { PITCH_COLOR, MOD_COLOR, familyScheme } from '$lib/config/devicePresets';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import { meldFilterCurve, FILTER_FREQ_RANGE } from '$lib/utils/instrumentFilterCurves';
  import {
    MELD_ENGINE,
    MELD_DRIVE,
    MELD_SPREAD,
    MELD_OCTAVES,
    MELD_OSC_TYPES,
    MELD_FILTER_TYPES,
    stepOscType,
    type MeldEngine
  } from './meldParams';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);

  // Meld color scheme — timeSpace teal (the view's old teal on the gap
  // wheel, ADR-400), now worn only by what both engines share.
  const meldColor = familyScheme('timeSpace');

  let trackScheme = $derived(selectedTrackScheme());
  let meldInk = $derived(trackScheme ?? {
    primary: trackInk(meldColor.primary, paintModeReactive()),
    secondary: meldColor.secondary,
    accent: trackInk(meldColor.accent, paintModeReactive())
  });
  let pitchInk = $derived(trackScheme ?? {
    primary: trackInk(PITCH_COLOR.primary, paintModeReactive()),
    secondary: PITCH_COLOR.secondary,
    accent: trackInk(PITCH_COLOR.accent, paintModeReactive())
  });
  let modInk = $derived(trackScheme ?? {
    primary: trackInk(MOD_COLOR.primary, paintModeReactive()),
    secondary: MOD_COLOR.secondary,
    accent: trackInk(MOD_COLOR.accent, paintModeReactive())
  });

  /**
   * Engine A orange, Engine B blue — Analog's voice colours, so the same
   * colour means the same half in both synths. The oscillator, the filter
   * and the envelopes all wear the engine the switch is on.
   */
  const ENGINE_COLORS = {
    A: { primary: '#ff8244', secondary: 'rgba(255, 130, 68, 0.1)', accent: '#ff9e60' },
    B: { primary: '#12b2f4', secondary: 'rgba(18, 178, 244, 0.1)', accent: '#33cdff' }
  } as const;

  /**
   * Which engine the view is showing. View state only, as on Analog: it
   * writes nothing to Live (not even Meld's own `selected_engine`), so a
   * patch change never takes the half away mid-edit.
   */
  let engine = $state<MeldEngine>('A');
  let p = $derived(MELD_ENGINE[engine]);
  let engineInk = $derived.by(() => {
    const raw = ENGINE_COLORS[engine];
    const mode = paintModeReactive();
    return { primary: trackInk(raw.primary, mode), secondary: raw.secondary, accent: trackInk(raw.accent, mode) };
  });

  /** Every parameter the view drives is natively 0..1 or a raw step, so no rescaling. */
  function read(index: number, atRest: number): number {
    if (!device) return atRest;
    return selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, index)) ?? atRest;
  }

  function write(index: number, value: number) {
    if (!device) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, index), value);
  }

  // ---- engine and oscillator

  let aOn = $derived(read(MELD_ENGINE.A.on, 1) >= 0.5);
  let bOn = $derived(read(MELD_ENGINE.B.on, 1) >= 0.5);
  let engineOn = $derived(engine === 'A' ? aOn : bOn);

  let oscType = $derived(Math.round(read(p.oscType, 0)));
  let octave = $derived(Math.round(read(p.octave, 0)));

  /** Reaching for an engine's oscillator is the request to hear it, as on Analog. */
  function writeOsc(index: number, value: number) {
    if (!engineOn) write(p.on, 1);
    write(index, value);
  }

  function handleOscXY(x: number, y: number) {
    writeOsc(p.oscShape, x);
    writeOsc(p.oscTone, y);
  }

  const octaveLabel = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  // ---- filter

  let filterType = $derived(Math.round(read(p.filterType, 0)));
  let filterOn = $derived(read(p.filterOn, 1) >= 0.5);
  let filterCurve = $derived(meldFilterCurve(filterType, read(p.lbhn, 0)));

  function handleFilterXY(x: number, y: number) {
    write(p.freq, x);
    write(p.q, y);
  }

  /**
   * The open type chooser, if any: 25 oscillator types and 17 filter types
   * are too many for a row, so the name between the step arrows opens a
   * grid over its own pad, and a choice closes it.
   */
  let chooser = $state<'osc' | 'filter' | null>(null);

  // ---- envelopes: one bracket, Amp or Mod. The first slider is what that
  // envelope ends in — the engine's volume, the mod envelope's peak.

  let envView = $state<'amp' | 'mod'>('amp');

  let envStages = $derived(
    envView === 'amp'
      ? [
          { index: p.volume, title: 'Vol', icon: 'gain' as const, atRest: 0.635 },
          { index: p.ampAttack, title: 'A', icon: 'attack' as const, atRest: 0.07 },
          { index: p.ampDecay, title: 'D', icon: 'decay' as const, atRest: 0.35 },
          { index: p.ampSustain, title: 'S', icon: 'sustain' as const, atRest: 1 },
          { index: p.ampRelease, title: 'R', icon: 'release' as const, atRest: 0.19 }
        ]
      : [
          { index: p.modPeak, title: 'Peak', icon: 'depth' as const, atRest: 1 },
          { index: p.modAttack, title: 'A', icon: 'attack' as const, atRest: 0.07 },
          { index: p.modDecay, title: 'D', icon: 'decay' as const, atRest: 0.35 },
          { index: p.modSustain, title: 'S', icon: 'sustain' as const, atRest: 0 },
          { index: p.modRelease, title: 'R', icon: 'release' as const, atRest: 0.19 }
        ]
  );

  // ---- shared by both engines

  let drive = $derived(read(MELD_DRIVE, 0));
  let spread = $derived(read(MELD_SPREAD, 0));
</script>

{#snippet typeChooser(kind: 'osc' | 'filter', label: string, onStep: (step: number) => void)}
  <div class="type-chooser" style="--btn-tint: {engineInk.primary};">
    <button class="physical-button chooser-step" aria-label="Previous {kind} type" onclick={() => onStep(-1)}>‹</button>
    <button
      class="physical-button chooser-name"
      class:active={chooser === kind}
      aria-expanded={chooser === kind}
      aria-label="Choose {kind === 'osc' ? 'oscillator' : 'filter'} type, now {label}"
      onclick={() => (chooser = chooser === kind ? null : kind)}
    >{label}</button>
    <button class="physical-button chooser-step" aria-label="Next {kind} type" onclick={() => onStep(1)}>›</button>
  </div>
{/snippet}

<div class="meld-root h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <div class="h-full w-full flex min-h-0 p-(--central-inset)" style="gap: var(--central-gap);">

      <!-- THE ENGINE. Meld is two synths, Osc → Filter → Amp twice, so the
           A/B switch flips this pad, the filter and the envelopes together
           and the colour says which half is up. -->
      <div class="paths flex-[2.3] min-w-0 min-h-0 flex relative" style="gap: var(--central-gap);">
      <div class="engine-col flex-[1.3] min-w-0 min-h-0 flex flex-col gap-(--central-gap)">
        <HostedSwapPill />
        <div class="engine-head flex-none">
          <button
            class="osc-badge"
            style="--osc-badge-ink: {engineInk.primary};"
            aria-label="Engine {engine} — switch to engine {engine === 'A' ? 'B' : 'A'}"
            onclick={() => (engine = engine === 'A' ? 'B' : 'A')}
          >
            <span class="osc-badge-eyebrow">Engine</span>
            <span class="osc-badge-pair">
              <span class="osc-badge-n" class:on={engine === 'A'} class:silent={!aOn}>A</span><span
                class="osc-badge-slash">/</span><span
                class="osc-badge-n" class:on={engine === 'B'} class:silent={!bOn}>B</span>
            </span>
          </button>
          {@render typeChooser('osc', MELD_OSC_TYPES[oscType] ?? '—', (step) => writeOsc(p.oscType, stepOscType(oscType, step)))}
        </div>
        <div class="flex-1 min-h-0 relative" style={engineOn ? '' : 'opacity: var(--opacity-ghost);'}>
          <DeviceXY
            xValue={read(p.oscShape, 0)}
            yValue={read(p.oscTone, 0)}
            title="Osc {engine}"
            icon="macro"
            isGhost={!engineOn}
            onInteraction={handleOscXY}
            color={engineInk}
          />
        </div>
        <div class="device-segmented octave-row flex-none" style="--btn-tint: {engineInk.primary}; grid-template-columns: repeat({MELD_OCTAVES.length}, 1fr);">
          {#each MELD_OCTAVES as n}
            <button
              class="device-segment strip-step"
              class:active={octave === n}
              aria-label="Engine {engine} octave {octaveLabel(n)}"
              aria-pressed={octave === n}
              onclick={() => writeOsc(p.octave, n)}
            >{octaveLabel(n)}</button>
          {/each}
        </div>
      </div>

      <SectionDivider orientation="vertical" ink={engineInk.primary} />

      <!-- The engine's filter: cutoff across, Q up, its type under it. -->
      <div class="filter-col flex-1 min-w-0 min-h-0 flex flex-col gap-(--central-gap)">
        <div class="flex-1 min-h-0 relative">
          <DeviceXY
            xValue={read(p.freq, 1)}
            yValue={read(p.q, 0)}
            title="Filter {engine}"
            showCurve={filterOn && filterCurve.curveType !== 'none'}
            curveType={filterCurve.curveType}
            curveOrder={filterCurve.order}
            curveFreqRange={FILTER_FREQ_RANGE.meld}
            onInteraction={handleFilterXY}
            color={engineInk}
          />
        </div>
        {@render typeChooser('filter', MELD_FILTER_TYPES[filterType] ?? '—', (step) => {
          const n = MELD_FILTER_TYPES.length;
          write(p.filterType, (((filterType + step) % n) + n) % n);
        })}
      </div>

        <!-- A type grid lies over both pads, so 25 names have room to read. -->
        {#if chooser === 'osc'}
          <div class="type-grid osc-types" style="--btn-tint: {engineInk.primary};">
            {#each MELD_OSC_TYPES as label, value}
              <button
                class="physical-button type-option"
                class:active={oscType === value}
                onclick={() => {
                  writeOsc(p.oscType, value);
                  chooser = null;
                }}
              >{label}</button>
            {/each}
          </div>
        {/if}
        {#if chooser === 'filter'}
          <div class="type-grid filter-types" style="--btn-tint: {engineInk.primary};">
            {#each MELD_FILTER_TYPES as label, value}
              <button
                class="physical-button type-option"
                class:active={filterType === value}
                onclick={() => {
                  write(p.filterType, value);
                  chooser = null;
                }}
              >{label}</button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- The engine's envelopes, Amp or Mod in one bracket: five sliders
           whichever is up, so switching never moves the edges. -->
      <div class="env-col flex-none min-h-0 flex gap-(--central-gap)">
        <EnvelopeGroup ink={engineInk.primary} title={envView === 'amp' ? 'Amp Envelope' : 'Mod Envelope'}>
          {#snippet header()}
            <div class="device-segmented env-switch flex-none" style="--btn-tint: {engineInk.primary};">
              {#each [['amp', 'Amp'], ['mod', 'Mod']] as [key, label]}
                <button
                  class="device-segment strip-step"
                  class:active={envView === key}
                  aria-pressed={envView === key}
                  onclick={() => (envView = key as 'amp' | 'mod')}
                >{label}</button>
              {/each}
            </div>
          {/snippet}
          {#each envStages as stage (stage.index)}
            <div class="env-slider min-h-0 h-full">
              <DeviceSlider
                value={read(stage.index, stage.atRest)}
                title={stage.title}
                icon={stage.icon}
                orientation="vertical"
                labelSize="small"
                color={engineInk}
                onInteraction={(v) => write(stage.index, v)}
              />
            </div>
          {/each}
        </EnvelopeGroup>
      </div>

      <!-- Drive and Voice Spread: Meld's own, after both engines. -->
      <div class="global-col flex-none min-h-0 flex gap-(--central-gap)">
        <div class="env-slider min-h-0 h-full">
          <DeviceSlider
            value={drive}
            title="Drive"
            icon="drive"
            orientation="vertical"
            labelSize="small"
            color={meldInk}
            onInteraction={(v) => write(MELD_DRIVE, v)}
          />
        </div>
        <div class="env-slider min-h-0 h-full">
          <DeviceSlider
            value={spread}
            title="Spread"
            icon="width"
            orientation="vertical"
            labelSize="small"
            color={meldInk}
            onInteraction={(v) => write(MELD_SPREAD, v)}
          />
        </div>
      </div>

      <SectionDivider orientation="vertical" ink={meldInk.primary} />

      <div class="flex-none flex gap-(--central-gap) min-h-0">
        <div class="wheel-col h-full">
          <MidiWheel type="pitch" onInteraction={sendPitchWheel} color={pitchInk} />
        </div>
        <div class="wheel-col h-full">
          <MidiWheel type="modwheel" onInteraction={sendModWheel} color={modInk} />
        </div>
      </div>
    </div>
  {:else}
    <DeviceEmptyState glyph="~" message="Load Meld to access controls" color={meldInk.primary} />
  {/if}
</div>

<style>
  .meld-root {
    --meld-slider-w: var(--height-touch);
    --meld-wheel-w: 56px;
  }

  .engine-head {
    display: flex;
    gap: var(--spacing-sm);
    height: var(--height-touch);
    min-width: 0;
  }

  /* ‹ name › — the arrows step, the name opens the grid over its pad. */
  .type-chooser {
    flex: 0 0 auto;
    min-width: 0;
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) 36px;
    gap: var(--spacing-xs);
    height: var(--height-touch);
  }
  .chooser-step,
  .chooser-name {
    min-height: 0;
    min-width: 0;
    padding: 0 4px;
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .chooser-step {
    font-size: 1.125rem;
  }
  .chooser-name {
    overflow: hidden;
    font-size: 0.75rem;
    line-height: 1.1;
  }
  .engine-head .type-chooser {
    flex: 1 1 0;
  }

  .type-grid {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: grid;
    gap: var(--spacing-sm);
    background: var(--background);
  }
  .osc-types {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    grid-template-rows: repeat(5, minmax(0, 1fr));
  }
  .filter-types {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    grid-template-rows: repeat(4, minmax(0, 1fr));
  }
  .type-option {
    min-height: 0;
    min-width: 0;
    padding: 2px 4px;
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.1;
    overflow: hidden;
  }

  .octave-row,
  .env-switch {
    display: grid;
    height: var(--height-touch);
  }
  .env-switch {
    grid-template-columns: repeat(2, 1fr);
  }
  .octave-row .device-segment + .device-segment,
  .env-switch .device-segment + .device-segment {
    border-top: 0;
    border-left: 1px solid var(--line-faint);
  }
  .device-segment.active,
  .device-segment.active + .device-segment {
    border-left-color: transparent;
  }
  .strip-step {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    min-width: 0;
    padding: 2px;
    font-size: 0.75rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  /* Five stages and their four gaps, plus the bracket's own two seams and
     the gap beside each — EnvelopeGroup draws them inside this column. */
  .env-col {
    width: calc(5 * var(--meld-slider-w) + 6 * var(--central-gap) + 2px);
  }
  .env-slider {
    flex: 0 0 var(--meld-slider-w);
    width: var(--meld-slider-w);
  }
  .wheel-col {
    width: var(--meld-wheel-w);
  }

  /* The Engine A/B switch: Analog's voice badge, a circle a touch row tall. */
  .osc-badge {
    flex: 0 0 auto;
    width: var(--height-touch);
    height: var(--height-touch);
    border-radius: 999px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    line-height: 1;
    background: var(--osc-badge-ink);
    border: 1px solid var(--osc-badge-ink);
    color: var(--flat-on-fg);
    cursor: pointer;
    transition: background-color var(--t-fast) var(--ease-precise);
  }
  .osc-badge-eyebrow {
    font-size: 7px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    opacity: 0.8;
  }
  .osc-badge-pair {
    display: flex;
    align-items: baseline;
    font-size: 14px;
    font-weight: 700;
  }
  .osc-badge-n {
    opacity: 0.45;
  }
  .osc-badge-n.on {
    opacity: 1;
  }
  .osc-badge-n.silent {
    opacity: 0.25;
  }
  .osc-badge-n.on.silent {
    opacity: 0.55;
  }
  .osc-badge-slash {
    opacity: 0.45;
    padding: 0 1px;
  }

  /* ---- Flat grammar: Analog's, so the two two-engine synths read alike.
     The engine colour is re-asserted against the house pair — here the
     colour IS the meaning (which half you are holding). */
  :global([data-grammar="flat"]) .meld-root .physical-button {
    font-weight: var(--font-weight-medium);
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
  :global([data-grammar="flat"]) .meld-root .physical-button.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }
  :global([data-grammar="flat"]) .meld-root .device-segmented .device-segment + .device-segment {
    border-top: 0;
    border-left: 1px solid var(--line-strong);
  }
  :global([data-grammar="flat"]) .meld-root .device-segment.active,
  :global([data-grammar="flat"]) .meld-root .device-segment.active + .device-segment {
    border-left-color: transparent;
  }
  :global([data-grammar="flat"]) .meld-root .device-segment {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
  :global([data-grammar="flat"]) .meld-root .device-segment:hover:not(.active) {
    color: var(--btn-tint);
    background: color-mix(in srgb, var(--btn-tint) 12%, transparent);
  }
  :global([data-grammar="flat"]) .meld-root .device-segment.active {
    background: var(--btn-tint);
    color: var(--flat-on-fg);
  }
</style>
