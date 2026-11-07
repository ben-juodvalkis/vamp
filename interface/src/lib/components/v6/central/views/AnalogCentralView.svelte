<script lang="ts">
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import ScrubTabs from '../../device-panel/ScrubTabs.svelte';
  import type { ControlGlyphName } from '../../device-panel/ControlGlyph.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { familyScheme } from '$lib/config/devicePresets';
  import { SECTION_SWITCH_ON_ABOVE } from '$lib/services/drumVirtualMacros';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import ChoicePicker from '../ChoicePicker.svelte';
  import AnalogPages from './analog/AnalogPages.svelte';
  import InstrumentBoard, { type BoardRow } from '../InstrumentBoard.svelte';
  import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import InstrumentPanelView from './panel/InstrumentPanelView.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import { usePanelParams } from './panel/usePanelParams.svelte';
  import { ANALOG_PANEL } from './panel/analogPanel';
  import {
    ANALOG_VOICE,
    ANALOG_VOICES,
    ANALOG_POLY_VOICES,
    ANALOG_UNISON_ON,
    ANALOG_VIB_ON,
    ANALOG_GLIDE_ON,
    ANALOG_GLIDE_TIME,
    ANALOG_NOISE_ON,
    ANALOG_NOISE_BALANCE,
    ANALOG_NOISE_LEVEL,
    ANALOG_F2_SLAVE,
    ANALOG_SHAPES,
    ANALOG_RECT,
    ANALOG_OCTAVES,
    ANALOG_FILTER_TYPES,
    ANALOG_FILTER_FAMILIES,
    ANALOG_DRIVES,
    filterTypeForFamily,
    routeOf,
    nextRouteBalance,
    type AnalogVoice
  } from './analogParams';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);

  let trackScheme = $derived(selectedTrackScheme());
  const analogColor = familyScheme('distortion');
  let analogInk = $derived(trackScheme ?? {
    primary: trackInk(analogColor.primary, paintModeReactive()),
    secondary: analogColor.secondary,
    accent: trackInk(analogColor.accent, paintModeReactive())
  });

  /**
   * Voice 1 orange, Voice 2 blue, Noise red — Drift's source colours, so
   * the same colour means the same thing in both synths. Here a colour
   * names a whole HALF of Analog: the oscillator card, the filter and the
   * envelope all wear the voice the switch is on, so one glance says which
   * of the two synths every control in front of you is moving.
   */
  const SOURCE_COLORS = {
    1: { primary: '#ff8244', secondary: 'rgba(255, 130, 68, 0.1)', accent: '#ff9e60' },
    2: { primary: '#12b2f4', secondary: 'rgba(18, 178, 244, 0.1)', accent: '#33cdff' },
    noise: { primary: '#ff5d5d', secondary: 'rgba(255, 93, 93, 0.1)', accent: '#ff7d7d' }
  } as const;

  function sourceInk(source: keyof typeof SOURCE_COLORS) {
    const raw = SOURCE_COLORS[source];
    const mode = paintModeReactive();
    return { primary: trackInk(raw.primary, mode), secondary: raw.secondary, accent: trackInk(raw.accent, mode) };
  }

  let noiseInk = $derived(sourceInk('noise'));

  /**
   * Which half of Analog the view is showing. View state only: it writes
   * nothing to Live, and it does not follow what a patch has switched on,
   * so a load never takes the card away mid-edit.
   */
  let voice = $state<AnalogVoice>(1);

  /** The pages behind the face's eyebrows, the shown voice's, by Live's names (ADR-487). */
  const panelParams = usePanelParams(() => device);

  /**
   * The section page on screen in place of the face, or none. Analog draws
   * its own pages (`analog/AnalogPages.svelte`, ADR-510) rather than the
   * panel's rule-laid ones, so the face's eyebrows open these.
   */
  let analogPage = $state<string | null>(null);
  const openAnalogPage = (page: string) => (analogPage = page);

  /**
   * Full screen (ADR-512): every page at once, the two voices side by side
   * in every row and the shared sections at its right. Osc 1 and 2 with
   * Vibrato; Filter and Amp of each voice with Noise; each voice's
   * envelopes (both as boxes, then the Amp and Filter envelopes' modes and
   * velocity) with MPE; both LFOs and Global, which hosts the swap pill so
   * the board has the frame's whole width. Analog holds the most of any
   * instrument, so its board is compact (8px inset and gap, ADR-434) and
   * every column holds two knobs, small: four rows of two-high columns are
   * the only way all of it is on one screen with every knob's name under
   * it. The tiles whose knobs have long names (Osc, Vibrato, LFO, Global)
   * sit in the rows of fewest columns, the short-named ones (Filter, Amp,
   * Noise, the envelopes' boxes, MPE) in the others. The weights give each
   * row what its tallest column needs: Osc's four touch rows (On, Mode,
   * Octave, Semi), and the five filter families and LFO shapes at the 44px
   * floor.
   */
  const BOARD: readonly BoardRow[] = [
    { tiles: [{ id: 'osc1', cols: 7 }, { id: 'osc2', cols: 7 }, { id: 'vibrato', cols: 4 }] },
    {
      tiles: [{ id: 'filter1', cols: 6 }, { id: 'amp1', cols: 4 }, { id: 'filter2', cols: 6 }, { id: 'amp2', cols: 4 }, { id: 'noise', cols: 2 }],
      weight: 1.02
    },
    {
      tiles: [
        { id: 'env1', cols: 5 }, { id: 'aeg1', cols: 2 }, { id: 'feg1', cols: 2 },
        { id: 'env2', cols: 5 }, { id: 'aeg2', cols: 2 }, { id: 'feg2', cols: 2 },
        { id: 'mpe', cols: 5 }
      ],
      weight: 0.92
    },
    { tiles: [{ id: 'lfo1', cols: 5 }, { id: 'lfo2', cols: 5 }, { id: 'global', cols: 9 }], weight: 1.02 }
  ];
  let p = $derived(ANALOG_VOICE[voice]);
  let voiceInk = $derived(sourceInk(voice));

  // ---- reads and writes. Raw for the switches and choosers, whose values
  // are Live's own steps; normalized through Live's range for the faders.

  function raw(index: number, atRest: number): number {
    if (!device) return atRest;
    return selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, index)) ?? atRest;
  }

  function norm(index: number, atRest: number): number {
    if (!device) return atRest;
    const path = selectedTrackStore.paramPath(device, index);
    const value = selectedTrackStore.paramValueArmed(path);
    if (value === undefined) return atRest;
    const range = selectedTrackStore.paramRange(path);
    if (!range || range.max <= range.min) return Math.max(0, Math.min(1, value));
    return Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min)));
  }

  function write(index: number, value: number) {
    if (!device) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, index), value);
  }

  function writeNorm(index: number, value: number) {
    if (!device) return;
    const path = selectedTrackStore.paramPath(device, index);
    const range = selectedTrackStore.paramRange(path);
    selectedTrackStore.setParamValue(path, range && range.max > range.min ? range.min + value * (range.max - range.min) : value);
  }

  /** A switch written only when it changes, so a scrub that stays put sends nothing. */
  function writeSwitch(index: number, on: boolean, current: boolean) {
    if (on !== current) write(index, on ? 1 : 0);
  }

  /**
   * Live's own value for a slider's readout (ADR-477), shown while it is
   * dragged. Undefined until the UI has written the parameter: Live sends
   * the string only then.
   */
  function display(index: number): string | undefined {
    if (!device) return undefined;
    return selectedTrackStore.paramDisplay(selectedTrackStore.paramPath(device, index));
  }

  // ---- oscillator

  let osc1On = $derived(raw(ANALOG_VOICE[1].oscOn, 1) >= 0.5);
  let osc2On = $derived(raw(ANALOG_VOICE[2].oscOn, 1) >= 0.5);
  let oscOn = $derived(voice === 1 ? osc1On : osc2On);
  let shape = $derived(Math.round(raw(p.shape, 1)));
  let octave = $derived(Math.round(raw(p.octave, 0)));
  let oscMode = $derived(Math.round(raw(p.mode, 0)));
  let route = $derived(routeOf(raw(p.balance, 1)));

  /** Reaching for an oscillator's control is the request to hear it, as in Drift. */
  function writeOsc(index: number, value: number) {
    if (!device) return;
    if (!oscOn) write(p.oscOn, 1);
    write(index, value);
  }

  const octaveLabel = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  /** Octaves top to bottom, +3 first. */
  const OCTAVES_UP = [...ANALOG_OCTAVES].reverse();

  /** One cycle each, peak y=2, floor y=10, in Drift's glyph grammar. */
  const SHAPE_GLYPHS: Record<string, string> = {
    Sine: 'M0 6 Q6 -1 12 6 T24 6',
    Saw: 'M0 10 L20 2 L20 10',
    Rect: 'M0 10 L0 2 L12 2 L12 10 L24 10',
    Noise: 'M0 6 L3 3 L5 9 L8 2 L11 8 L13 4 L16 10 L19 3 L21 7 L24 5'
  };

  // ---- noise (shared by both voices)

  let noiseOn = $derived(raw(ANALOG_NOISE_ON, 0) >= 0.5);
  let noiseLevel = $derived(norm(ANALOG_NOISE_LEVEL, 0));
  let noiseRoute = $derived(routeOf(raw(ANALOG_NOISE_BALANCE, 0.5)));

  // ---- filter

  let filterType = $derived(Math.round(raw(p.filterType, 1)));
  let filterFamily = $derived(Math.floor(filterType / 2));
  let drive = $derived(Math.round(raw(p.drive, 0)));
  let f2Slave = $derived(raw(ANALOG_F2_SLAVE, 0) >= 0.5);
  /** Live's drive names, for the face's chooser: the value written is the index. */
  const DRIVE_NAMES = [...ANALOG_DRIVES];

  // ---- envelopes: Amp over Filter, both in view (ADR-477), A D S R each.
  // What each drives sits beside it as a knob since ADR-510's face: the
  // amp's level in the Osc card, the filter envelope's amount on Filter.

  let envelopes = $derived([
    {
      title: 'Amp',
      stages: [
        { index: p.aegAttack, title: 'A', icon: 'attack' as const, atRest: 0 },
        { index: p.aegDecay, title: 'D', icon: 'decay' as const, atRest: 0.6 },
        { index: p.aegSustain, title: 'S', icon: 'sustain' as const, atRest: 0 },
        { index: p.aegRelease, title: 'R', icon: 'release' as const, atRest: 0.6 }
      ]
    },
    {
      title: 'Filter',
      stages: [
        { index: p.fegAttack, title: 'A', icon: 'attack' as const, atRest: 0 },
        { index: p.fegDecay, title: 'D', icon: 'decay' as const, atRest: 0.6 },
        { index: p.fegSustain, title: 'S', icon: 'sustain' as const, atRest: 0 },
        { index: p.fegRelease, title: 'R', icon: 'release' as const, atRest: 0.6 }
      ]
    }
  ]);

  // ---- voicing

  let voices = $derived(Math.round(raw(ANALOG_VOICES, 0)));
  let isMono = $derived(voices === 0);
  let unisonOn = $derived(raw(ANALOG_UNISON_ON, 0) >= 0.5);
  let vibOn = $derived(raw(ANALOG_VIB_ON, 0) >= 0.5);
  let glideOn = $derived(raw(ANALOG_GLIDE_ON, 0) >= 0.5);
  let glideTime = $derived(norm(ANALOG_GLIDE_TIME, 0.5));

  /** Poly keeps a patch's own voice count; only from Mono does it choose one (8). */
  function setMono(mono: boolean) {
    if (mono === isMono) return;
    write(ANALOG_VOICES, mono ? 0 : ANALOG_POLY_VOICES);
  }
</script>

{#snippet shapeGlyph(label: string)}
  <svg class="wave-glyph" viewBox="0 0 24 12" aria-hidden="true" focusable="false">
    <path
      d={SHAPE_GLYPHS[label] ?? ''}
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
{/snippet}

<!-- A knob on the face: medium, no caption (its rows are ~100px, a
     captioned medium knob needs ~126), its mark or glyph saying which. -->
{#snippet faceKnob(o: { value: number; title: string; mark?: string; icon?: ControlGlyphName; ink: typeof analogInk; ghost?: boolean; readout?: string; bipolar?: boolean; write: (v: number) => void })}
  <div class="r knob-cell" data-knob={o.title}>
    <DeviceSlider
      value={o.value}
      title={o.title}
      face="knob"
      knobSize="m"
      knobCaption={false}
      knobMark={o.mark}
      icon={o.icon}
      orientation="vertical"
      labelSize="small"
      min={o.bipolar ? -1 : 0}
      max={1}
      centerOrigin={o.bipolar}
      centerValue={o.bipolar ? 0 : undefined}
      isGhost={o.ghost}
      color={o.ink}
      readout={o.readout}
      onInteraction={o.write}
    />
  </div>
{/snippet}

<div class="analog-root h-full w-full overflow-hidden relative" data-density={instrument && device && centralDisplayStore.expanded ? 'compact' : undefined}>
  {#if instrument && device && centralDisplayStore.expanded}
    <InstrumentBoard rows={BOARD} ink={analogInk.primary}>
      {#snippet tile(id)}
        <AnalogPages
          page={id}
          params={panelParams}
          ink={analogInk}
          voiceInks={{ 1: sourceInk(1), 2: sourceInk(2) }}
          {noiseInk}
          onOpen={() => {}}
          onBack={() => {}}
          {shapeGlyph}
          board
        />
      {/snippet}
    </InstrumentBoard>
  {:else if instrument && device}
    <InstrumentPanelView panel={ANALOG_PANEL} params={panelParams} color={analogInk}>
    {#snippet face()}
    {#if analogPage}
    <AnalogPages
      page={analogPage}
      params={panelParams}
      ink={analogInk}
      voiceInks={{ 1: sourceInk(1), 2: sourceInk(2) }}
      {noiseInk}
      onOpen={openAnalogPage}
      onBack={() => (analogPage = null)}
      {shapeGlyph}
    />
    {:else}
    <!-- One grid, eleven columns (ADR-510), ~80px each so a medium knob
         is its full 70px: Osc 4 (the voice's oscillator, and the source
         levels with Noise's route), Filter 2 (and the voice's amp level,
         the stage after it), Envelopes 4, Global 1, Osc → Filter → Amp as
         Live runs them. Every column has the same three rows, a touch row
         and two knob rows, so every knob on the face sits on one of two
         lines. The filter's pad is not here: the chain cell draws Filter
         1's, and the Filter page draws the shown voice's. -->
    <FaceGrid sections={[4, 2, 4, 1]} data-analog-face={voice}>
      <!-- THE VOICE CARD. Analog is two synths, Osc → Filter → Amp twice,
           so the switch in its first cell flips the whole half — this card,
           the filter and the envelopes together — and the colour says which
           half is up. The last column is the levels: the oscillator's in
           the voice's colour, Noise (the one source both halves share) in
           its own red, Noise's route over them, Noise's eyebrow on top. -->
      <FaceSection span={4}>
        {#snippet head()}
          <div class="head-cols">
            <span class="head-col face-span-3"><PanelEyebrow title="Osc {voice}" page="osc{voice}" onOpen={openAnalogPage} color={voiceInk.primary} /></span>
            <span class="head-col"><PanelEyebrow title="Noise" page="noise" onOpen={openAnalogPage} color={analogInk.primary} /></span>
          </div>
        {/snippet}
        <!-- The switch, the four shapes two by two, and where the
             oscillator goes: Filter 1, 2 or both (its Balance, which is what
             makes Analog's two halves cross). -->
        <div class="col">
          <div class="r1">
            <button
              class="osc-badge"
              style="--osc-badge-ink: {voiceInk.primary};"
              aria-label="Voice {voice} of 2 — switch to voice {voice === 1 ? 2 : 1}"
              onclick={() => (voice = voice === 1 ? 2 : 1)}
            >
              <span class="osc-badge-eyebrow">Voice</span>
              <span class="osc-badge-pair">
                <span class="osc-badge-n" class:on={voice === 1} class:silent={!osc1On}>1</span><span
                  class="osc-badge-slash">/</span><span
                  class="osc-badge-n" class:on={voice === 2} class:silent={!osc2On}>2</span>
              </span>
            </button>
          </div>
          <div class="r" class:osc-off={!oscOn}>
            <ScrubTabs
              options={[0, 1, 2, 3]}
              selected={shape}
              onSelect={(_, value) => writeOsc(p.shape, value)}
              cols={2}
              tint={voiceInk.primary}
              inked
              label={(value) => `Osc ${voice} shape ${ANALOG_SHAPES[value]}`}
              class="h-full"
            >
              {#snippet item(value)}{@render shapeGlyph(ANALOG_SHAPES[value])}{/snippet}
            </ScrubTabs>
          </div>
          <div class="r sw-cell">
            <button
              class="physical-button route-button route-chip"
              style="--btn-tint: {voiceInk.primary};"
              title="Osc {voice} Balance"
              aria-label="Osc {voice} to {route}"
              onclick={() => write(p.balance, nextRouteBalance(raw(p.balance, 1)))}
            >
              <span class="route-arrow">→</span>{route}
            </button>
          </div>
        </div>
        <!-- Octaves stand +3 at the top: pitch climbs as the eye does. -->
        <div class="col" class:osc-off={!oscOn}>
          <ScrubTabs
            options={OCTAVES_UP}
            selected={OCTAVES_UP.indexOf(octave as (typeof OCTAVES_UP)[number])}
            onSelect={(_, n) => writeOsc(p.octave, n)}
            cols={1}
            tint={voiceInk.primary}
            inked
            label={(n) => `Osc ${voice} octave ${octaveLabel(n)}`}
            class="h-full"
          >
            {#snippet item(n)}{octaveLabel(n)}{/snippet}
          </ScrubTabs>
        </div>
        <!-- Sub or Sync, how much, and pulse width (lit on Rect, the one
             shape it shapes). -->
        <div class="col">
          <div class="r1" class:osc-off={!oscOn}>
            <ScrubTabs
              options={[0, 1]}
              selected={oscMode}
              onSelect={(_, value) => writeOsc(p.mode, value)}
              cols={2}
              tint={voiceInk.primary}
              inked
              label={(value) => `Osc ${voice} ${value === 1 ? 'Sync' : 'Sub'}`}
              class="h-full"
              style="--scrub-font-size: 0.75rem;"
            >
              {#snippet item(value)}{value === 1 ? 'Sync' : 'Sub'}{/snippet}
            </ScrubTabs>
          </div>
          {@render faceKnob({ value: norm(p.subSync, 0), title: oscMode === 1 ? 'Sync' : 'Sub', mark: oscMode === 1 ? 'Syn' : 'Sub', ink: voiceInk, ghost: !oscOn, readout: display(p.subSync), write: (v) => writeOsc(p.subSync, v) })}
          {@render faceKnob({ value: norm(p.pw, 0.5), title: 'PW', mark: 'PW', ink: voiceInk, ghost: !oscOn || shape !== ANALOG_RECT, readout: display(p.pw), write: (v) => writeOsc(p.pw, v) })}
        </div>
        <!-- The levels. Noise's switch is its level, Drift's rule: up turns
             it on, the floor turns it off, from a finger only. -->
        <div class="col">
          <div class="r1">
            <button
              class="physical-button route-button route-chip"
              style="--btn-tint: {noiseInk.primary};"
              title="Noise Balance"
              aria-label="Noise to {noiseRoute}"
              onclick={() => write(ANALOG_NOISE_BALANCE, nextRouteBalance(raw(ANALOG_NOISE_BALANCE, 0.5)))}
            >
              <span class="route-arrow">→</span>{noiseRoute}
            </button>
          </div>
          {@render faceKnob({ value: norm(p.level, 0.81), title: 'Level', mark: 'Lvl', ink: voiceInk, ghost: !oscOn, readout: display(p.level), write: (v) => writeOsc(p.level, v) })}
          {@render faceKnob({ value: noiseLevel, title: 'Noise', icon: 'noise', ink: noiseInk, ghost: !noiseOn, readout: display(ANALOG_NOISE_LEVEL), write: (v) => {
            writeNorm(ANALOG_NOISE_LEVEL, v);
            writeSwitch(ANALOG_NOISE_ON, v > SECTION_SWITCH_ON_ABOVE, noiseOn);
          } })}
        </div>
      </FaceSection>
      <FaceSeam ink={voiceInk.primary} />

      <!-- The voice's filter: its drive and type (five families; a second
           tap on the lit one flips its slope), whether Filter 2's cutoff
           follows Filter 1's, the filter envelope's amount, and the amp's
           level after the filter. -->
      <FaceSection span={2}>
        {#snippet head()}<PanelEyebrow title="Filter {voice}" page="filter{voice}" onOpen={openAnalogPage} color={voiceInk.primary} />{/snippet}
        <div class="col">
          <div class="r1 drive-cell">
            <ChoicePicker options={DRIVE_NAMES} selected={drive} onSelect={(i) => write(p.drive, i)} label="Filter {voice} drive" tint={voiceInk.primary} />
          </div>
          <div class="r23 device-segmented family-tab" style="--btn-tint: {voiceInk.primary};">
            {#each ANALOG_FILTER_FAMILIES as family, i}
              <button
                class="device-segment strip-step"
                class:active={filterFamily === i}
                title={ANALOG_FILTER_TYPES[filterFamily === i ? filterType : i * 2 + (filterType % 2)]}
                aria-label="Filter {voice} {ANALOG_FILTER_TYPES[filterFamily === i ? filterType : i * 2 + (filterType % 2)]}"
                aria-pressed={filterFamily === i}
                onclick={() => write(p.filterType, filterTypeForFamily(filterType, i))}
              >
                <span>{family.label}{#if filterFamily === i}<span class="strip-sub"> {family.slopes[filterType % 2]}</span>{/if}</span>
              </button>
            {/each}
          </div>
        </div>
        <div class="col">
          <!-- F2 Slave: Filter 2's cutoff follows Filter 1's. One switch
               for both halves, so it reads the same on either. -->
          <div class="r1">
            <button
              class="physical-button slave-chip"
              class:active={f2Slave}
              style="--btn-tint: {voiceInk.primary};"
              title="Filter 2's cutoff follows Filter 1's"
              aria-label="F2 follows F1"
              aria-pressed={f2Slave}
              onclick={() => write(ANALOG_F2_SLAVE, f2Slave ? 0 : 1)}
            >F2 Follow</button>
          </div>
          {@render faceKnob({ value: raw(p.envAmount, 0), title: 'Env', mark: 'Env', bipolar: true, ink: voiceInk, readout: display(p.envAmount), write: (v) => write(p.envAmount, Math.max(-1, Math.min(1, v))) })}
          {@render faceKnob({ value: norm(p.ampLevel, 0.87), title: 'Amp', mark: 'Vol', ink: voiceInk, readout: display(p.ampLevel), write: (v) => writeNorm(p.ampLevel, v) })}
        </div>
      </FaceSection>
      <FaceSeam ink={voiceInk.primary} />

      <!-- The swap pill over the voice's two envelopes, Amp over Filter, as
           value boxes (ADR-477), a stage a column: their heights draw each
           envelope. -->
      <FaceSection span={4}>
        {#snippet head()}<PanelEyebrow title="Envelopes" page="env{voice}" onOpen={openAnalogPage} color={voiceInk.primary} />{/snippet}
        <div class="env-grid face-span-all">
          <div class="env-pill"><HostedSwapPill /></div>
          {#each envelopes as envelope (envelope.title)}
            <div class="env-row" data-envelope={envelope.title}>
              <span class="env-label" style="color: {voiceInk.primary};">{envelope.title}</span>
              {#each envelope.stages as stage (stage.index)}
                <div class="min-h-0 h-full">
                  <DeviceSlider
                    value={norm(stage.index, stage.atRest)}
                    title={stage.title}
                    icon={stage.icon}
                    orientation="vertical"
                    labelSize="small"
                    color={voiceInk}
                    readout={display(stage.index)}
                    onInteraction={(v) => writeNorm(stage.index, v)}
                  />
                </div>
              {/each}
            </div>
          {/each}
        </div>
      </FaceSection>
      <FaceSeam ink={analogInk.primary} />

      <!-- Mono or Poly, one choice; Uni and Vib switches of their own (Vib
           a switch because its depth rides the mod wheel); Glide, its switch
           its level as Noise's is. -->
      <FaceSection span={1}>
        {#snippet head()}<PanelEyebrow title="Global" page="global" onOpen={openAnalogPage} color={analogInk.primary} />{/snippet}
        <div class="col">
          <div class="r1">
            <ScrubTabs
              options={[true, false]}
              selected={isMono ? 0 : 1}
              onSelect={(_, mono) => setMono(mono)}
              cols={2}
              tint={analogInk.primary}
              label={(mono) => (mono ? 'Mono' : 'Poly')}
              class="h-full"
              style="--scrub-font-size: 0.6875rem; --scrub-padding: 0;"
            />
          </div>
          <div class="r sw-pair">
            <button class="physical-button mode-button" class:active={unisonOn} style="--btn-tint: {analogInk.primary};" aria-pressed={unisonOn} onclick={() => write(ANALOG_UNISON_ON, unisonOn ? 0 : 1)}>Uni</button>
            <button class="physical-button mode-button" class:active={vibOn} style="--btn-tint: {analogInk.primary};" aria-pressed={vibOn} onclick={() => write(ANALOG_VIB_ON, vibOn ? 0 : 1)}>Vib</button>
          </div>
          {@render faceKnob({ value: glideOn ? glideTime : 0, title: 'Glide', icon: 'glide', ink: analogInk, ghost: !glideOn, readout: display(ANALOG_GLIDE_TIME), write: (v) => {
            writeSwitch(ANALOG_GLIDE_ON, v > SECTION_SWITCH_ON_ABOVE, glideOn);
            if (v > SECTION_SWITCH_ON_ABOVE) writeNorm(ANALOG_GLIDE_TIME, v);
          } })}
        </div>
      </FaceSection>
    </FaceGrid>
    {/if}
    {/snippet}
    </InstrumentPanelView>
  {:else}
    <DeviceEmptyState glyph="~" message="Load Analog to access its controls" color={analogInk.primary} />
  {/if}
</div>

<style>
  /* The face's layout is the FaceGrid (ADR-510): eleven equal columns,
     Osc 4, Filter 2, Envelopes 4, Global 1. Every column is three rows:
     a touch row (`.r1`), then two equal rows (`.r`), or the two together
     (`.r23`), or the whole height. */
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    min-width: 0;
    min-height: 0;
  }
  .r1 {
    flex: none;
    height: var(--height-touch);
    min-width: 0;
  }
  .r1 > .physical-button {
    width: 100%;
    height: 100%;
  }
  .r {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
  }
  .r23 {
    flex: 1 1 0;
    min-height: 0;
  }
  .osc-off {
    opacity: var(--opacity-ghost);
  }
  /* A switch: one touch row, centred in its row. */
  .sw-cell {
    display: flex;
    align-items: center;
  }
  .sw-cell > button {
    width: 100%;
    height: var(--height-touch);
  }
  /* Two switches stacked in one knob row: Uni over Vib. */
  .sw-pair {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--spacing-sm);
  }
  .sw-pair > button {
    flex: none;
    height: var(--height-touch);
  }
  .route-chip {
    height: var(--height-touch);
  }
  .drive-cell {
    display: flex;
    align-items: center;
  }
  .drive-cell > :global(*) {
    width: 100%;
  }
  .route-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 2px;
    min-height: 0;
    min-width: 0;
    font-size: 0.75rem;
    font-weight: 600;
    gap: 2px;
    white-space: nowrap;
  }
  .route-arrow {
    opacity: 0.7;
  }
  .wave-glyph {
    width: 100%;
    height: 100%;
    max-height: 22px;
  }

  /* The filter's five families down a column, the lit one naming its slope. */
  .family-tab {
    display: grid;
    grid-auto-rows: minmax(0, 1fr);
    min-height: 0;
  }
  .family-tab .device-segment + .device-segment {
    border-left: 0;
    border-top: 1px solid var(--line-faint);
  }
  .strip-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 0;
    min-width: 0;
    padding: 2px;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.1;
  }
  .strip-sub {
    font-size: 0.625rem;
    font-weight: 500;
    opacity: 0.85;
  }
  .slave-chip,
  .mode-button {
    padding: 0 2px;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }

  /* The Osc section's header line: Osc over the voice card's four
     columns, Noise over its own, on the face's gutters. */
  .head-cols {
    flex: 1 1 auto;
    align-self: stretch;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    column-gap: var(--face-gutter);
    min-width: 0;
  }
  .head-col {
    display: flex;
    justify-content: center;
    align-items: center;
    min-width: 0;
  }
  .head-col.face-span-3 {
    grid-column: span 3;
  }
  /* The pill over the two envelopes, a stage a face column; each row
     named in a line over its boxes. */
  .env-grid {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: var(--height-touch) minmax(0, 1fr) minmax(0, 1fr);
    row-gap: var(--spacing-sm);
    min-width: 0;
    min-height: 0;
  }
  .env-pill {
    grid-column: 1 / -1;
    min-width: 0;
  }
  .env-row {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: auto minmax(0, 1fr);
    row-gap: 2px;
    min-height: 0;
  }
  .env-label {
    grid-column: 1 / -1;
    font-size: 0.6875rem;
    font-weight: 700;
    line-height: 0.75rem;
  }

  /* The Voice 1/2 switch: Drift's OSC badge, one touch row in the voice's ink. */
  .osc-badge {
    width: 100%;
    height: 100%;
    border-radius: var(--radius-sm, 2px);
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
    font-size: 8px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0.8;
  }
  .osc-badge-pair {
    display: flex;
    align-items: baseline;
    font-size: 15px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
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

  /* ---- Flat grammar. The voice colour re-asserted against the house
     pair: here the colour IS the meaning (which half you are holding), as
     on Drift's source cards. */
  :global([data-grammar="flat"]) .analog-root .family-tab .device-segment {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
  :global([data-grammar="flat"]) .analog-root .family-tab .device-segment:hover:not(.active) {
    color: var(--btn-tint);
    background: color-mix(in srgb, var(--btn-tint) 12%, transparent);
  }
  :global([data-grammar="flat"]) .analog-root .family-tab .device-segment.active {
    background: var(--btn-tint);
    color: var(--flat-on-fg);
  }
  :global([data-grammar="flat"]) .analog-root .route-chip,
  :global([data-grammar="flat"]) .analog-root .slave-chip {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
  :global([data-grammar="flat"]) .analog-root .slave-chip.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }
</style>
