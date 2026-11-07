<script lang="ts">
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import MeldPages from './meld/MeldPages.svelte';
  import InstrumentBoard, { type BoardRow } from '../InstrumentBoard.svelte';
  import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
  import { meldEngineStore } from '$lib/stores/v6/meldEngineStore.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import InstrumentPanelView from './panel/InstrumentPanelView.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import { usePanelParams } from './panel/usePanelParams.svelte';
  import { MELD_PANEL } from './panel/meldPanel';
  import EnvelopeGroup from './EnvelopeGroup.svelte';
  import MeldOscIcon from './meld/MeldOscIcon.svelte';
  import ScrubTabs from '../../device-panel/ScrubTabs.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { familyScheme } from '$lib/config/devicePresets';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import { meldFilterCurve, FILTER_FREQ_RANGE } from '$lib/utils/instrumentFilterCurves';
  import {
    MELD_ENGINE,
    MELD_DRIVE,
    MELD_SPREAD,
    MELD_OCTAVES,
    MELD_OSC_TYPES,
    MELD_FILTER_TYPES,
    MELD_FILTER_EXTRA_NAMES,
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
   * Which engine the view is showing, picked by touching its level box at
   * the view's left (2026-11-05; an A/B badge before). Shared with the
   * effect chain's Meld cell (`meldEngineStore`, 2026-11-06), whose pad
   * then drives this engine's oscillator. It writes nothing to Live (not
   * even Meld's own `selected_engine`), so a patch change never takes the
   * half away mid-edit.
   */
  let devicePath = $derived(device?.devicePath);
  let engine = $derived(meldEngineStore.engineOf(devicePath));
  const showEngine = (e: MeldEngine) => meldEngineStore.select(devicePath, e);

  /**
   * The section page on screen in place of the face, or none. Meld draws
   * its own pages (`meld/MeldPages.svelte`, ADR-510), as Drift does,
   * rather than the panel's rule-laid ones.
   */
  let meldPage = $state<string | null>(null);
  const openMeldPage = (page: string) => (meldPage = page);

  /**
   * Full screen (ADR-512): every page of both engines at once, so there is
   * no engine switch. Engine A on top and Engine B under it, the same two
   * rows each (user, 2026-11-07): the oscillator and the filter, then the
   * envelopes (the tallest row, three knobs to a column) and the LFOs.
   * Global is its own short row across the foot. The face's controls are
   * all on these pages (the engine levels are Global's Mix).
   */
  const engineRows = (e: 'a' | 'b'): BoardRow[] => [
    { tiles: [{ id: `osc-${e}`, cols: 7 }, { id: `filter-${e}`, cols: 4 }], weight: 0.53 },
    { tiles: [{ id: `env-${e}`, cols: 7 }, { id: `lfo-${e}`, cols: 7 }], weight: 0.97 }
  ];
  const BOARD: readonly BoardRow[] = [
    ...engineRows('a'),
    ...engineRows('b'),
    { tiles: [{ id: 'global', cols: 9 }], weight: 0.43 }
  ];

  /** The pages behind the face's eyebrows, the shown engine's, by Live's names (ADR-487). */
  const panelParams = usePanelParams(() => device);
  let pageEngine = $derived(engine === 'A' ? 'a' : 'b');
  let p = $derived(MELD_ENGINE[engine]);
  function inkOf(e: MeldEngine) {
    const raw = ENGINE_COLORS[e];
    const mode = paintModeReactive();
    return { primary: trackInk(raw.primary, mode), secondary: raw.secondary, accent: trackInk(raw.accent, mode) };
  }
  let engineInk = $derived(inkOf(engine));

  /** Every parameter the view drives is natively 0..1 or a raw step, so no rescaling. */
  function read(index: number, atRest: number): number {
    if (!device) return atRest;
    return selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, index)) ?? atRest;
  }

  function write(index: number, value: number) {
    if (!device) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, index), value);
  }

  /** Live's own value, a box's readout while it is dragged (ADR-477); sent only while the UI writes. */
  function display(index: number): string | undefined {
    if (!device) return undefined;
    return selectedTrackStore.paramDisplay(selectedTrackStore.paramPath(device, index));
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

  const octaveLabel = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  /** The octave column, +3 at the top; a finger sweeps through it (ScrubTabs). */
  const OCTAVES_DOWN = [...MELD_OCTAVES].reverse();

  /** An engine's level; reaching for it shows that engine and turns it on. */
  function writeLevel(e: MeldEngine, value: number) {
    if (!(e === 'A' ? aOn : bOn)) write(MELD_ENGINE[e].on, 1);
    write(MELD_ENGINE[e].volume, value);
  }

  // ---- filter

  let filterType = $derived(Math.round(read(p.filterType, 0)));
  let filterOn = $derived(read(p.filterOn, 1) >= 0.5);
  let filterCurve = $derived(meldFilterCurve(filterType, read(p.lbhn, 0)));

  function handleFilterXY(x: number, y: number) {
    write(p.freq, x);
    write(p.q, y);
  }

  function stepFilter(step: number) {
    const n = MELD_FILTER_TYPES.length;
    write(p.filterType, (((filterType + step) % n) + n) % n);
  }

  /** The filter's second macro, titled with the name Live gives it under this type. */
  let filterExtra = $derived(read(p.lbhn, 0));
  let filterExtraTitle = $derived(MELD_FILTER_EXTRA_NAMES[filterType] ?? 'Extra');

  /**
   * The open type chooser, if any: 25 oscillator types and 17 filter types
   * are too many for a row, so the oscillator's tile and the filter's name
   * open a grid over the face, and a choice closes it.
   */
  let chooser = $state<'osc' | 'filter' | null>(null);

  // ---- envelopes: Amp over Mod, both in view (ADR-477). The engine's
  // volume is its level box at the view's left; the mod envelope's first
  // box is its peak.

  let envelopes = $derived([
    {
      title: 'Amp Envelope',
      stages: [
        { index: p.ampAttack, title: 'A', icon: 'attack' as const, atRest: 0.07 },
        { index: p.ampDecay, title: 'D', icon: 'decay' as const, atRest: 0.35 },
        { index: p.ampSustain, title: 'S', icon: 'sustain' as const, atRest: 1 },
        { index: p.ampRelease, title: 'R', icon: 'release' as const, atRest: 0.19 }
      ]
    },
    {
      title: 'Mod Envelope',
      stages: [
        { index: p.modPeak, title: 'Peak', icon: 'depth' as const, atRest: 1 },
        { index: p.modAttack, title: 'A', icon: 'attack' as const, atRest: 0.07 },
        { index: p.modDecay, title: 'D', icon: 'decay' as const, atRest: 0.35 },
        { index: p.modSustain, title: 'S', icon: 'sustain' as const, atRest: 0 },
        { index: p.modRelease, title: 'R', icon: 'release' as const, atRest: 0.19 }
      ]
    }
  ]);

  // ---- shared by both engines

  let drive = $derived(read(MELD_DRIVE, 0));
  let spread = $derived(read(MELD_SPREAD, 0));
</script>

{#snippet typeStep(kind: 'osc' | 'filter', onStep: (step: number) => void)}
  <button class="chooser-step" aria-label="Previous {kind === 'osc' ? 'oscillator' : 'filter'} type" onclick={() => onStep(-1)}>‹</button>
  <button class="chooser-step" aria-label="Next {kind === 'osc' ? 'oscillator' : 'filter'} type" onclick={() => onStep(1)}>›</button>
{/snippet}

<div class="meld-root h-full w-full overflow-hidden relative">
  {#if instrument && device && centralDisplayStore.expanded}
    <InstrumentBoard rows={BOARD} ink={meldInk.primary}>
      {#snippet tile(id)}
        <MeldPages
          page={id}
          params={panelParams}
          ink={meldInk}
          engineInks={{ A: inkOf('A'), B: inkOf('B') }}
          onBack={() => {}}
          board
        />
      {/snippet}
    </InstrumentBoard>
  {:else if instrument && device}
    <InstrumentPanelView panel={MELD_PANEL} params={panelParams} color={meldInk}>
    {#snippet face()}
    {#if meldPage}
    <MeldPages
      page={meldPage}
      params={panelParams}
      ink={meldInk}
      engineInks={{ A: inkOf('A'), B: inkOf('B') }}
      onBack={() => (meldPage = null)}
    />
    {:else}
    <!-- One grid, twelve columns (ADR-510, 2026-11-06): Engine 3 (the
         levels, the octaves, the oscillator), Filter 2, Envelopes 5,
         Global 2, Osc → Filter → Amp as Live runs them. The oscillator's
         Shape and Tone are the effect chain's pad (it follows the engine
         shown here, meldEngineStore), so the face has no pad of its own
         for them (user, 2026-11-06). -->
    <FaceGrid sections={[3, 2, 5, 2]} class="meld-face">
      <!-- THE ENGINE. Meld is two synths, Osc → Filter → Amp twice; the
           levels, Engine A over Engine B in the first column, each in its
           colour (user, 2026-11-05), pick which half is up: touching one
           flips the oscillator, the filter and the envelopes together. -->
      <FaceSection span={3}>
        {#snippet head()}<PanelEyebrow title="Engine {engine}" page="osc-{pageEngine}" onOpen={openMeldPage} color={engineInk.primary} />{/snippet}
        <div class="min-h-0 flex flex-col gap-(--spacing-sm)">
        {#each ['A', 'B'] as const as e (e)}
          <div class="flex-1 min-h-0" data-engine-level={e} class:shown={engine === e}>
            <DeviceSlider
              value={read(MELD_ENGINE[e].volume, 0.635)}
              title="Engine {e}"
              icon="gain"
              orientation="vertical"
              labelSize="small"
              isGhost={!(e === 'A' ? aOn : bOn)}
              color={inkOf(e)}
              readout={display(MELD_ENGINE[e].volume)}
              onDown={() => showEngine(e)}
              onInteraction={(v) => writeLevel(e, v)}
            />
          </div>
        {/each}
        </div>
        <div class="engine-body face-span-2">
          <!-- The octaves, +3 at the top, a column left of the oscillator
               (user, 2026-11-05), as on Wavetable. -->
          <div class="min-h-0 flex flex-col">
            <ScrubTabs
              options={OCTAVES_DOWN}
              selected={OCTAVES_DOWN.indexOf(octave as (typeof OCTAVES_DOWN)[number])}
              onSelect={(_, n) => writeOsc(p.octave, n)}
              cols={1}
              tint={engineInk.primary}
              inked
              label={(n) => `Engine ${engine} octave ${octaveLabel(n)}`}
              class="flex-1"
            >
              {#snippet item(n)}{octaveLabel(n)}{/snippet}
            </ScrubTabs>
          </div>
          <!-- The oscillator's type: its mark and name, which open the type
               grid, over the arrows that step it. -->
          <div class="osc-col" style={engineOn ? '' : 'opacity: var(--opacity-ghost);'}>
            <button
              class="osc-tile"
              class:active={chooser === 'osc'}
              style="--btn-tint: {engineInk.primary};"
              aria-expanded={chooser === 'osc'}
              aria-label="Choose oscillator type, now {MELD_OSC_TYPES[oscType] ?? 'unknown'}"
              onclick={() => (chooser = chooser === 'osc' ? null : 'osc')}
            >
              <span class="osc-mark"><MeldOscIcon type={oscType} color={engineInk.primary} /></span>
              <span class="osc-name">{MELD_OSC_TYPES[oscType] ?? '—'}</span>
            </button>
            <div class="type-steps stepper" style="--btn-tint: {engineInk.primary};">
              {@render typeStep('osc', (step) => writeOsc(p.oscType, stepOscType(oscType, step)))}
            </div>
          </div>
        </div>
      </FaceSection>
      <FaceSeam ink={engineInk.primary} />

      <!-- The engine's filter: cutoff across, Q up, its second macro (a
           knob, named as Live names it under the type) and its type under
           it. -->
      <FaceSection span={2}>
        {#snippet head()}<PanelEyebrow title="Filter {engine}" page="filter-{pageEngine}" onOpen={openMeldPage} color={engineInk.primary} />{/snippet}
        <div class="face-span-all min-w-0 min-h-0 flex flex-col gap-(--spacing-sm)">
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
        <div class="filter-extra flex-none">
          <DeviceSlider
            value={filterExtra}
            title={filterExtraTitle}
            face="knob"
            knobSize="m"
            icon="morph"
            orientation="vertical"
            labelSize="small"
            color={engineInk}
            readout={display(p.lbhn)}
            onInteraction={(v) => write(p.lbhn, v)}
          />
        </div>
        <div class="filter-type type-chooser stepper" style="--btn-tint: {engineInk.primary};">
          <button class="chooser-step" aria-label="Previous filter type" onclick={() => stepFilter(-1)}>‹</button>
          <button
            class="chooser-name"
            class:active={chooser === 'filter'}
            aria-expanded={chooser === 'filter'}
            aria-label="Choose filter type, now {MELD_FILTER_TYPES[filterType] ?? 'unknown'}"
            onclick={() => (chooser = chooser === 'filter' ? null : 'filter')}
          >{MELD_FILTER_TYPES[filterType] ?? '—'}</button>
          <button class="chooser-step" aria-label="Next filter type" onclick={() => stepFilter(1)}>›</button>
        </div>
        </div>
      </FaceSection>
      <FaceSeam ink={engineInk.primary} />

      <!-- The engine's two envelopes, Amp over Mod, as value boxes
           (ADR-477), a stage a column: both in view, so there is no
           Amp/Mod switch. A seam between them. -->
      <FaceSection span={5}>
        {#snippet head()}
          <PanelEyebrow title="Envelopes" page="env-{pageEngine}" onOpen={openMeldPage} color={engineInk.primary} />
          <PanelEyebrow title="LFOs" page="lfo-{pageEngine}" onOpen={openMeldPage} color={engineInk.primary} />
        {/snippet}
        <div class="env-stack face-span-all">
          {#each envelopes as envelope, i (envelope.title)}
            {#if i > 0}<div class="env-seam"><SectionDivider orientation="horizontal" ink={engineInk.primary} /></div>{/if}
            <EnvelopeGroup ink={engineInk.primary} title={envelope.title} onGrid>
              {#each envelope.stages as stage (stage.index)}
                <div class="min-h-0 h-full">
                  <DeviceSlider
                    value={read(stage.index, stage.atRest)}
                    title={stage.title}
                    icon={stage.icon}
                    orientation="vertical"
                    labelSize="small"
                    color={engineInk}
                    readout={display(stage.index)}
                    onInteraction={(v) => write(stage.index, v)}
                  />
                </div>
              {/each}
            </EnvelopeGroup>
          {/each}
        </div>
      </FaceSection>
      <FaceSeam ink={meldInk.primary} />

      <!-- Drive over Voice Spread: Meld's own, after both engines, two
           medium knobs over two columns (ADR-509: two captioned large
           knobs do not stack in the band; one column, ~67px, clamped a
           medium one to 66). -->
      <FaceSection span={2}>
        {#snippet head()}<PanelEyebrow title="Global" page="global" onOpen={openMeldPage} color={meldInk.primary} />{/snippet}
        <div class="face-span-all min-h-0 flex flex-col gap-(--spacing-sm)">
        {#each [{ index: MELD_DRIVE, title: 'Drive', icon: 'drive' as const, value: drive }, { index: MELD_SPREAD, title: 'Spread', icon: 'width' as const, value: spread }] as k (k.index)}
          <div class="flex-1 min-h-0">
            <DeviceSlider
              value={k.value}
              title={k.title}
              face="knob"
              knobSize="m"
              icon={k.icon}
              orientation="vertical"
              labelSize="small"
              color={meldInk}
              readout={display(k.index)}
              onInteraction={(v) => write(k.index, v)}
            />
          </div>
        {/each}
        </div>
      </FaceSection>

      <!-- A type grid lies over the whole face's controls, so 25 names
           have room to read: out of the grid's flow, on its second row. -->
      {#if chooser}
        <div class="type-overlay">
        {#if chooser === 'osc'}
          <!-- Scrubs: the type follows the finger, and the grid closes when it lifts. -->
          <ScrubTabs
            options={MELD_OSC_TYPES}
            selected={oscType}
            onSelect={(i) => writeOsc(p.oscType, i)}
            onDone={() => (chooser = null)}
            cols={5}
            tint={engineInk.primary}
            inked
            label={(l) => l}
            name="meld-osc-types"
            style="--scrub-padding: 2px 4px; --scrub-font-weight: var(--font-weight-medium);"
          />
        {/if}
        {#if chooser === 'filter'}
          <ScrubTabs
            options={MELD_FILTER_TYPES}
            selected={filterType}
            onSelect={(i) => write(p.filterType, i)}
            onDone={() => (chooser = null)}
            cols={5}
            rows={4}
            tint={engineInk.primary}
            inked
            label={(l) => l}
            name="meld-filter-types"
            style="--scrub-padding: 2px 4px; --scrub-font-weight: var(--font-weight-medium);"
          />
        {/if}
        </div>
      {/if}
    </FaceGrid>
    {/if}
    {/snippet}
    </InstrumentPanelView>
  {:else}
    <DeviceEmptyState glyph="~" message="Load Meld to access controls" color={meldInk.primary} />
  {/if}
</div>

<style>
  /* The face's layout is the FaceGrid (ADR-510): twelve equal columns,
     Engine 3, Filter 2, Envelopes 5, Global 2. What is left here is how a
     column fills its height. */
  :global(.meld-face) {
    position: relative;
  }
  /* The type grid over the face's controls (its second row, every column). */
  .type-overlay {
    position: absolute;
    grid-column: 1 / -1;
    grid-row: 2;
    inset: 0;
    /* Over every control's own layers (a value box's label stacks above
       its fill), on a solid ground so nothing under it reads through. */
    z-index: 30;
    isolation: isolate;
    background: var(--background);
    display: flex;
  }
  .type-overlay > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }

  /* The octaves and the oscillator, a column each. The swap pill is
     CentralDisplay's column at the view's left, as on Drift's face. */
  .engine-body {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
  }

  /* The oscillator: its mark and name over the step arrows. */
  .osc-col {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    min-width: 0;
    min-height: 0;
  }
  .osc-tile {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 0.25rem;
    padding: 0.375rem 0.25rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-well);
    color: var(--btn-tint);
    cursor: pointer;
  }
  .osc-tile.active {
    border-color: var(--btn-tint);
  }
  .osc-mark {
    position: relative;
    flex: 1 1 0;
    width: 100%;
    min-height: 0;
  }
  .osc-name {
    flex: none;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.15;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .type-steps {
    flex: none;
    height: var(--height-touch);
    min-width: 0;
  }

  /* Amp over Mod, a stage a face column, a seam between. */
  .env-stack {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: minmax(0, 1fr) auto minmax(0, 1fr);
    row-gap: var(--central-gap);
    min-width: 0;
    min-height: 0;
  }
  .env-seam {
    grid-column: 1 / -1;
  }

  /* ‹ name › — one `.stepper` (app.css): the arrows step, the name opens
     the grid. */
  .type-chooser {
    flex: none;
    min-width: 0;
    height: var(--height-touch);
  }
  .chooser-step,
  .chooser-name {
    min-height: 0;
    min-width: 0;
    padding: 0 4px;
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

  /* The filter's second macro: a medium knob, its name beside it. */
  .filter-extra {
    height: 92px;
  }
</style>
