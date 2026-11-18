<script lang="ts">
  import { press } from '$lib/actions/press';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import ScrubTabs from '../../device-panel/ScrubTabs.svelte';
  import type { ControlGlyphName } from '../../device-panel/ControlGlyph.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { selectedAmountScheme } from '$lib/utils/selectedTrackInk';
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

  let device = $derived(selectedTrackStore.instrumentDevice(instrument));

  /**
   * One ink, the selected track's (ADR-544): every arc and fill. Voice 1
   * was orange, Voice 2 blue and Noise red until 2026-11-17, a colour for
   * each half of Analog; a second colour now has to mean a second owner.
   * Which half is up is said by the Voice switch (1 | 2, the chosen one
   * ON's block) and by the section names (Osc 1, Filter 1); Noise by its
   * name.
   */
  let analogInk = $derived(selectedAmountScheme());
  /** A pick's value is a name in plain ink, never the amount's colour. */
  const PICK_INK = 'var(--label)';

  /**
   * Which half of Analog the view is showing. View state only: it writes
   * nothing to Live, and it does not follow what a patch has switched on,
   * so a load never takes the card away mid-edit.
   */
  let voice = $state<AnalogVoice>(1);

  /** The pages behind the face's eyebrows, the shown voice's, by Live's names (ADR-487). */
  const panelParams = usePanelParams(() => device);

  /**
   * Full screen (ADR-512): every page at once, the two voices side by side
   * in every row and the shared sections at its right. Osc 1 and 2 with
   * Vibrato; Filter and Amp of each voice with Noise; each voice's
   * envelopes (both as boxes, then the Amp and Filter envelopes' modes and
   * velocity) with MPE; both LFOs and Global, which hosts the swap pill so
   * the board has the frame's whole width. Analog holds the most of any
   * instrument, so its board is compact (8px inset and gap, ADR-434) and
   * every column holds two knobs, small and one size, on its tile's two
   * lines (ADR-544): four rows of two-high columns are the only way all of
   * it is on one screen with every knob's name under it. The tiles whose knobs have long names (Osc, Vibrato, LFO, Global)
   * sit in the rows of fewest columns, the short-named ones (Filter, Amp,
   * Noise, the envelopes' boxes, MPE) in the others. The weights give each
   * row what its tallest column needs: Osc's four touch rows (On, Mode,
   * Octave, Semi), and the five filter families and LFO shapes at the 44px
   * floor.
   */
  const BOARD: readonly BoardRow[] = [
    { tiles: [{ id: 'osc1', cols: 7 }, { id: 'osc2', cols: 7 }, { id: 'vibrato', cols: 3 }], weight: 1 },
    {
      tiles: [{ id: 'filter1', cols: 6 }, { id: 'amp1', cols: 4 }, { id: 'filter2', cols: 6 }, { id: 'amp2', cols: 4 }, { id: 'noise', cols: 2 }],
      weight: 0.92
    },
    {
      tiles: [
        { id: 'env1', cols: 5 }, { id: 'aeg1', cols: 2 }, { id: 'feg1', cols: 2 },
        { id: 'env2', cols: 5 }, { id: 'aeg2', cols: 2 }, { id: 'feg2', cols: 2 },
        { id: 'mpe', cols: 5 }
      ],
      weight: 1.2
    },
    { tiles: [{ id: 'lfo1', cols: 5 }, { id: 'lfo2', cols: 5 }, { id: 'global', cols: 10 }], weight: 0.98 }
  ];
  let p = $derived(ANALOG_VOICE[voice]);

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

  // ---- envelopes: Amp beside Filter, each a Time pad on the face (ADR-546):
  // Attack across, the Amp's Release and the Filter's Decay up; the board
  // keeps all four stages. What each drives sits beside it as a knob since
  // ADR-510's face: the amp's level in the Osc card, the filter envelope's
  // amount on Filter.
  let timePads = $derived([
    { title: 'Amp', x: p.aegAttack, y: p.aegRelease },
    { title: 'Filter', x: p.fegAttack, y: p.fegDecay }
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

<!-- A knob on the face: small, its whole name under it (2026-11-08). Its
     rows are ~100px, which holds a small knob and its caption (48 + 44) but
     not a medium one's (70 + 50); until then the knobs were medium with a
     three-letter mark inside ("Lvl", "Syn"), the one face that abbreviated. -->
{#snippet faceKnob(o: { value: number; title: string; icon?: ControlGlyphName; ghost?: boolean; readout?: string; bipolar?: boolean; write: (v: number) => void })}
  <div class="r knob-cell" data-knob={o.title}>
    <DeviceSlider
      value={o.value}
      title={o.title}
      face="knob"
      knobSize="s"
      icon={o.icon}
      orientation="vertical"
      labelSize="small"
      centerOrigin={o.bipolar}
      centerValue={o.bipolar ? 0.5 : undefined}
      isGhost={o.ghost}
      color={analogInk}
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
          {shapeGlyph}
        />
      {/snippet}
    </InstrumentBoard>
  {:else if instrument && device}
    <InstrumentPanelView panel={ANALOG_PANEL} params={panelParams} color={analogInk}>
    {#snippet face()}
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
           the filter and the envelopes together — and the switch and the
           section names (Osc 1, Filter 1) say which half is up. The last
           column is the levels: the oscillator's and Noise's (the one
           source both halves share), Noise's route over them, Noise's
           eyebrow on top. -->
      <FaceSection span={4}>
        {#snippet head()}
          <div class="head-cols">
            <span class="head-col face-span-3"><PanelEyebrow title="Osc {voice}" color={analogInk.primary} /></span>
            <span class="head-col"><PanelEyebrow title="Noise" color={analogInk.primary} /></span>
          </div>
        {/snippet}
        <!-- The switch, the four shapes two by two, and where the
             oscillator goes: Filter 1, 2 or both (its Balance, which is what
             makes Analog's two halves cross). -->
        <div class="col">
          <div class="r1">
            <!-- One button drawn as a tab of two: a press anywhere flips
                 the half, as it always did. The chosen voice is ON's block;
                 a voice whose oscillator is off is dimmed. -->
            <button
              class="osc-badge device-segmented"
              aria-label="Voice {voice} of 2 — switch to voice {voice === 1 ? 2 : 1}"
              use:press={{ onPress: () => (voice = voice === 1 ? 2 : 1) }}
            >
              <span class="osc-badge-n" class:on={voice === 1} class:silent={!osc1On}>1</span>
              <span class="osc-badge-n" class:on={voice === 2} class:silent={!osc2On}>2</span>
            </button>
          </div>
          <div class="r" class:osc-off={!oscOn}>
            <ScrubTabs
              options={[0, 1, 2, 3]}
              selected={shape}
              onSelect={(_, value) => writeOsc(p.shape, value)}
              cols={2}
              label={(value) => `Osc ${voice} shape ${ANALOG_SHAPES[value]}`}
              class="h-full"
            >
              {#snippet item(value)}{@render shapeGlyph(ANALOG_SHAPES[value])}{/snippet}
            </ScrubTabs>
          </div>
          <div class="r sw-cell">
            <button
              class="physical-button route-button route-chip"
              title="Osc {voice} Balance"
              aria-label="Osc {voice} to {route}"
              use:press={{ onPress: () => write(p.balance, nextRouteBalance(raw(p.balance, 1))) }}
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
              label={(value) => `Osc ${voice} ${value === 1 ? 'Sync' : 'Sub'}`}
              class="h-full"
              style="--scrub-font-size: 0.75rem;"
            >
              {#snippet item(value)}{value === 1 ? 'Sync' : 'Sub'}{/snippet}
            </ScrubTabs>
          </div>
          {@render faceKnob({ value: norm(p.subSync, 0), title: oscMode === 1 ? 'Sync' : 'Sub', ghost: !oscOn, readout: display(p.subSync), write: (v) => writeOsc(p.subSync, v) })}
          {@render faceKnob({ value: norm(p.pw, 0.5), title: 'PW', ghost: !oscOn || shape !== ANALOG_RECT, readout: display(p.pw), write: (v) => writeOsc(p.pw, v) })}
        </div>
        <!-- The levels. Noise's switch is its level, Drift's rule: up turns
             it on, the floor turns it off, from a finger only. -->
        <div class="col">
          <div class="r1">
            <button
              class="physical-button route-button route-chip"
              title="Noise Balance"
              aria-label="Noise to {noiseRoute}"
              use:press={{ onPress: () => write(ANALOG_NOISE_BALANCE, nextRouteBalance(raw(ANALOG_NOISE_BALANCE, 0.5))) }}
            >
              <span class="route-arrow">→</span>{noiseRoute}
            </button>
          </div>
          {@render faceKnob({ value: norm(p.level, 0.81), title: 'Level', ghost: !oscOn, readout: display(p.level), write: (v) => writeOsc(p.level, v) })}
          {@render faceKnob({ value: noiseLevel, title: 'Noise', icon: 'noise', ghost: !noiseOn, readout: display(ANALOG_NOISE_LEVEL), write: (v) => {
            writeNorm(ANALOG_NOISE_LEVEL, v);
            writeSwitch(ANALOG_NOISE_ON, v > SECTION_SWITCH_ON_ABOVE, noiseOn);
          } })}
        </div>
      </FaceSection>
      <FaceSeam ink={analogInk.primary} />

      <!-- The voice's filter: its drive and type (five families; a second
           tap on the lit one flips its slope), whether Filter 2's cutoff
           follows Filter 1's, the filter envelope's amount, and the amp's
           level after the filter. -->
      <FaceSection span={2}>
        {#snippet head()}<PanelEyebrow title="Filter {voice}" color={analogInk.primary} />{/snippet}
        <div class="col">
          <div class="r1 drive-cell">
            <ChoicePicker options={DRIVE_NAMES} selected={drive} onSelect={(i) => write(p.drive, i)} label="Filter {voice} drive" tint={PICK_INK} />
          </div>
          <div class="r23 device-segmented family-tab">
            {#each ANALOG_FILTER_FAMILIES as family, i}
              <button
                class="device-segment strip-step"
                class:active={filterFamily === i}
                title={ANALOG_FILTER_TYPES[filterFamily === i ? filterType : i * 2 + (filterType % 2)]}
                aria-label="Filter {voice} {ANALOG_FILTER_TYPES[filterFamily === i ? filterType : i * 2 + (filterType % 2)]}"
                aria-pressed={filterFamily === i}
                use:press={{ onPress: () => write(p.filterType, filterTypeForFamily(filterType, i)) }}
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
              class="physical-button btn-toggle slave-chip"
              class:active={f2Slave}
              title="Filter 2's cutoff follows Filter 1's"
              aria-label="F2 follows F1"
              aria-pressed={f2Slave}
              use:press={{ onPress: () => write(ANALOG_F2_SLAVE, f2Slave ? 0 : 1) }}
            >F2 Follow</button>
          </div>
          {@render faceKnob({ value: (raw(p.envAmount, 0) + 1) / 2, title: 'Env', bipolar: true, readout: display(p.envAmount), write: (v) => write(p.envAmount, Math.max(-1, Math.min(1, v * 2 - 1))) })}
          {@render faceKnob({ value: norm(p.ampLevel, 0.87), title: 'Amp', readout: display(p.ampLevel), write: (v) => writeNorm(p.ampLevel, v) })}
        </div>
      </FaceSection>
      <FaceSeam ink={analogInk.primary} />

      <!-- The swap pill over the voice's two envelopes as Time pads, Amp
           beside Filter (ADR-546): Attack across, and up the Amp's Release
           and the Filter's Decay. Their four stages are on the board. -->
      <FaceSection span={4}>
        {#snippet head()}<PanelEyebrow title="Envelopes" color={analogInk.primary} />{/snippet}
        <div class="env-grid face-span-all">
          <div class="env-pill"><HostedSwapPill /></div>
          {#each timePads as pad (pad.title)}
            <div class="env-pad" data-envelope={pad.title} data-time-pad>
              <DeviceXY
                xValue={norm(pad.x, 0)}
                yValue={norm(pad.y, 0.6)}
                title={pad.title}
                icon="envelope"
                color={analogInk}
                onInteraction={(x, y) => {
                  writeNorm(pad.x, x);
                  writeNorm(pad.y, y);
                }}
              />
            </div>
          {/each}
        </div>
      </FaceSection>
      <FaceSeam ink={analogInk.primary} />

      <!-- Mono or Poly, one choice; Uni and Vib switches of their own (Vib
           a switch because its depth rides the mod wheel); Glide, its switch
           its level as Noise's is. -->
      <FaceSection span={1}>
        {#snippet head()}<PanelEyebrow title="Global" color={analogInk.primary} />{/snippet}
        <div class="col">
          <div class="r1">
            <ScrubTabs
              options={[true, false]}
              selected={isMono ? 0 : 1}
              onSelect={(_, mono) => setMono(mono)}
              cols={2}
              label={(mono) => (mono ? 'Mono' : 'Poly')}
              class="h-full"
              style="--scrub-font-size: 0.6875rem; --scrub-padding: 0;"
            />
          </div>
          <div class="r sw-pair">
            <button class="physical-button btn-toggle mode-button" class:active={unisonOn} aria-pressed={unisonOn} use:press={{ onPress: () => write(ANALOG_UNISON_ON, unisonOn ? 0 : 1) }}>Uni</button>
            <button class="physical-button btn-toggle mode-button" class:active={vibOn} aria-pressed={vibOn} use:press={{ onPress: () => write(ANALOG_VIB_ON, vibOn ? 0 : 1) }}>Vib</button>
          </div>
          {@render faceKnob({ value: glideOn ? glideTime : 0, title: 'Glide', icon: 'glide', ghost: !glideOn, readout: display(ANALOG_GLIDE_TIME), write: (v) => {
            writeSwitch(ANALOG_GLIDE_ON, v > SECTION_SWITCH_ON_ABOVE, glideOn);
            if (v > SECTION_SWITCH_ON_ABOVE) writeNorm(ANALOG_GLIDE_TIME, v);
          } })}
        </div>
      </FaceSection>
    </FaceGrid>
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
  /* The pill over the two Time pads, each two face columns. */
  .env-grid {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: var(--height-touch) minmax(0, 1fr);
    row-gap: var(--spacing-sm);
    min-width: 0;
    min-height: 0;
  }
  .env-pill {
    grid-column: 1 / -1;
    min-width: 0;
  }
  .env-pad {
    grid-column: span 2;
    min-width: 0;
    min-height: 0;
  }

  /* The Voice switch: one button drawn as a tab of two, 1 | 2, the voice
     shown ON's block (ADR-544). It was a block of the voice's colour
     reading "Voice 1/2" until 2026-11-17. */
  .osc-badge {
    width: 100%;
    height: 100%;
    padding: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    overflow: hidden;
    cursor: pointer;
  }
  .osc-badge-n {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    font-size: 1rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: var(--label);
    background: var(--surface-well);
    outline: 1px solid var(--line-strong);
  }
  .osc-badge-n.on {
    background: var(--on-bg);
    color: var(--on-fg);
  }
  /* A voice whose oscillator is switched off. */
  .osc-badge-n.silent {
    color: var(--signal-dim);
  }
  .osc-badge-n.on.silent {
    color: color-mix(in srgb, var(--on-fg) 55%, var(--on-bg));
  }
</style>
