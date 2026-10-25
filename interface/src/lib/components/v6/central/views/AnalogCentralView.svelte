<script lang="ts">
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import MidiWheelsPanel from '../../midi/MidiWheelsPanel.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { PITCH_COLOR, MOD_COLOR, familyScheme } from '$lib/config/devicePresets';
  import { SECTION_SWITCH_ON_ABOVE } from '$lib/services/drumVirtualMacros';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import EnvelopeGroup from './EnvelopeGroup.svelte';
  import { analogFilterCurve, FILTER_FREQ_RANGE } from '$lib/utils/instrumentFilterCurves';
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
    driveAmount,
    driveIsAsym,
    driveForAmount,
    driveToggleAsym,
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
  let filterOn = $derived(raw(p.filterOn, 1) >= 0.5);
  let filterCurve = $derived(analogFilterCurve(filterType));

  function handleFilterXY(x: number, y: number) {
    writeNorm(p.freq, x);
    writeNorm(p.res, y);
  }

  // ---- envelopes: Amp over Filter, both in view (ADR-477). The first box
  // of each is the stage that envelope drives — the amp's level, the
  // filter's env amount.

  let envelopes = $derived([
    {
      title: 'Amp Envelope',
      stages: [
        { index: p.ampLevel, title: 'Lvl', icon: 'gain' as const, atRest: 0.87, bipolar: false },
        { index: p.aegAttack, title: 'A', icon: 'attack' as const, atRest: 0, bipolar: false },
        { index: p.aegDecay, title: 'D', icon: 'decay' as const, atRest: 0.6, bipolar: false },
        { index: p.aegSustain, title: 'S', icon: 'sustain' as const, atRest: 0, bipolar: false },
        { index: p.aegRelease, title: 'R', icon: 'release' as const, atRest: 0.6, bipolar: false }
      ]
    },
    {
      title: 'Filter Envelope',
      stages: [
        { index: p.envAmount, title: 'Amt', icon: 'depth' as const, atRest: 0.5, bipolar: true },
        { index: p.fegAttack, title: 'A', icon: 'attack' as const, atRest: 0, bipolar: false },
        { index: p.fegDecay, title: 'D', icon: 'decay' as const, atRest: 0.6, bipolar: false },
        { index: p.fegSustain, title: 'S', icon: 'sustain' as const, atRest: 0, bipolar: false },
        { index: p.fegRelease, title: 'R', icon: 'release' as const, atRest: 0.6, bipolar: false }
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

<div class="analog-root h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <div class="h-full w-full flex min-h-0 p-(--central-inset)" style="gap: var(--central-gap);">

      <!-- THE VOICE CARD. Analog is two synths, Osc → Filter → Amp twice,
           so the switch in its first cell flips the whole half — this
           card, the filter and the envelope together — and the colour
           says which half is up. Rows: shapes (the switch, four shapes,
           the routing chip), octave, Sub/Sync, level. -->
      <div class="voice-card flex-[2] min-w-[196px] min-h-0 flex flex-col gap-(--central-gap)">
        <HostedSwapPill />
        <div class="osc-body flex-1 min-h-0" style={oscOn ? '' : 'opacity: var(--opacity-ghost);'}>
          <div class="osc-badge-cell">
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
          <!-- The four shapes, one pick-one tab, two by two beside the
               switch and the routing chip. -->
          <div class="device-segmented seg-grid shape-tab" style="--btn-tint: {voiceInk.primary};">
          {#each ANALOG_SHAPES as label, value}
            <button
              class="device-segment wave-button"
              class:active={shape === value}
              title={label}
              aria-label="Osc {voice} shape {label}"
              aria-pressed={shape === value}
              onclick={() => writeOsc(p.shape, value)}
            >
              {@render shapeGlyph(label)}
            </button>
          {/each}
          </div>
          <!-- Where this oscillator goes: Filter 1, Filter 2 or both — its
               Balance, which is what makes Analog's two halves cross. -->
          <button
            class="physical-button route-button"
            style:grid-column="1"
            style:grid-row="2"
            style="--btn-tint: {voiceInk.primary};"
            title="Osc {voice} Balance"
            aria-label="Osc {voice} to {route}"
            onclick={() => write(p.balance, nextRouteBalance(raw(p.balance, 1)))}
          >
            <span class="route-arrow">→</span>{route}
          </button>

          <div class="device-segmented octave-row" style="--btn-tint: {voiceInk.primary}; grid-template-columns: repeat({ANALOG_OCTAVES.length}, 1fr);">
            {#each ANALOG_OCTAVES as n}
              <button
                class="device-segment octave-step"
                class:active={octave === n}
                aria-label="Osc {voice} octave {octaveLabel(n)}"
                aria-pressed={octave === n}
                onclick={() => writeOsc(p.octave, n)}
              >{octaveLabel(n)}</button>
            {/each}
          </div>

          <!-- Sub or Sync, and how much. Pulse width joins the row only on
               Rect, the one shape it shapes. -->
          <div class="osc-row">
            <div class="device-segmented mode-row" style="--btn-tint: {voiceInk.primary};">
              {#each ['Sub', 'Sync'] as label, value}
                <button
                  class="device-segment mode-step"
                  class:active={oscMode === value}
                  aria-label="Osc {voice} {label}"
                  aria-pressed={oscMode === value}
                  onclick={() => writeOsc(p.mode, value)}
                >{label}</button>
              {/each}
            </div>
            <div class="flex-1 min-w-0">
              <DeviceSlider
                value={norm(p.subSync, 0)}
                title={oscMode === 1 ? 'Sync' : 'Sub'}
                icon={oscMode === 1 ? 'oscillator' : 'boom'}
                orientation="horizontal"
                labelSize="small"
                isGhost={!oscOn}
                color={voiceInk}
                readout={display(p.subSync)}
                onInteraction={(v) => writeOsc(p.subSync, v)}
              />
            </div>
            {#if shape === ANALOG_RECT}
              <div class="flex-1 min-w-0">
                <DeviceSlider
                  value={norm(p.pw, 0.5)}
                  title="PW"
                  icon="shape"
                  orientation="horizontal"
                  labelSize="small"
                  isGhost={!oscOn}
                  color={voiceInk}
                  readout={display(p.pw)}
                  onInteraction={(v) => writeOsc(p.pw, v)}
                />
              </div>
            {/if}
          </div>

          <div class="osc-row">
            <DeviceSlider
              value={norm(p.level, 0.81)}
              title="Level"
              icon="gain"
              orientation="horizontal"
              labelSize="small"
              isGhost={!oscOn}
              color={voiceInk}
              readout={display(p.level)}
              onInteraction={(v) => writeOsc(p.level, v)}
            />
          </div>
        </div>
      </div>

      <!-- Noise is the one source both halves share, so it stands outside
           the voice card in its own red. Its switch is its level, Drift's
           rule: up turns it on, the floor turns it off, from a finger only.
           Glide shares the column as a box under it (ADR-477): it had a
           full-height column of its own, which the filter has now. -->
      <div class="noise-col flex-none min-h-0 flex flex-col gap-(--central-gap)">
        <div class="flex-1 min-h-0 flex flex-col gap-2">
          <div class="flex-1 min-h-0">
            <DeviceSlider
              value={noiseLevel}
              title="Noise"
              icon="noise"
              orientation="vertical"
              labelSize="small"
              isGhost={!noiseOn}
              color={noiseInk}
              readout={display(ANALOG_NOISE_LEVEL)}
              onInteraction={(v) => {
                writeNorm(ANALOG_NOISE_LEVEL, v);
                writeSwitch(ANALOG_NOISE_ON, v > SECTION_SWITCH_ON_ABOVE, noiseOn);
              }}
            />
          </div>
          <button
            class="physical-button route-button route-chip flex-none"
            style="--btn-tint: {noiseInk.primary};"
            title="Noise Balance"
            aria-label="Noise to {noiseRoute}"
            onclick={() => write(ANALOG_NOISE_BALANCE, nextRouteBalance(raw(ANALOG_NOISE_BALANCE, 0.5)))}
          >
            <span class="route-arrow">→</span>{noiseRoute}
          </button>
        </div>

        <!-- Glide, its switch its level like Noise's. -->
        <div class="flex-1 min-h-0">
          <DeviceSlider
            value={glideOn ? glideTime : 0}
            title="Glide"
            icon="glide"
            orientation="vertical"
            labelSize="small"
            isGhost={!glideOn}
            color={analogInk}
            readout={display(ANALOG_GLIDE_TIME)}
            onInteraction={(v) => {
              writeSwitch(ANALOG_GLIDE_ON, v > SECTION_SWITCH_ON_ABOVE, glideOn);
              if (v > SECTION_SWITCH_ON_ABOVE) writeNorm(ANALOG_GLIDE_TIME, v);
            }}
          />
        </div>
      </div>

      <SectionDivider orientation="vertical" ink={voiceInk.primary} />

      <!-- The voice's filter: cutoff across, resonance up, then its type
           (five families; a second tap on the lit one flips its slope) and
           its drive (amount, and Asym lit for Live's asymmetric three). -->
      <div class="filter-col flex-[3] min-w-0 min-h-0 flex flex-col" style="gap: var(--central-gap);">
        <div class="flex-1 min-h-0 relative">
          <DeviceXY
            xValue={norm(p.freq, 1)}
            yValue={norm(p.res, 0)}
            title="Filter {voice}"
            showCurve={filterOn}
            curveType={filterCurve.curveType}
            curveOrder={filterCurve.order}
            curveFreqRange={FILTER_FREQ_RANGE.analog}
            onInteraction={handleFilterXY}
            color={voiceInk}
          />
          {#if voice === 2}
            <!-- F2 Slave: Filter 2's cutoff follows Filter 1's. A switch,
                 not a caption, so it can be turned off from here. -->
            <button
              class="physical-button slave-chip"
              class:active={f2Slave}
              style="--btn-tint: {voiceInk.primary};"
              aria-pressed={f2Slave}
              onclick={() => write(ANALOG_F2_SLAVE, f2Slave ? 0 : 1)}
            >Follows F1</button>
          {/if}
        </div>
        <div class="device-segmented strip-row flex-none" style="--btn-tint: {voiceInk.primary}; grid-template-columns: repeat({ANALOG_FILTER_FAMILIES.length}, 1fr);">
          {#each ANALOG_FILTER_FAMILIES as family, i}
            <button
              class="device-segment strip-step"
              class:active={filterFamily === i}
              title={ANALOG_FILTER_TYPES[filterFamily === i ? filterType : i * 2 + (filterType % 2)]}
              aria-label="Filter {voice} {ANALOG_FILTER_TYPES[filterFamily === i ? filterType : i * 2 + (filterType % 2)]}"
              aria-pressed={filterFamily === i}
              onclick={() => write(p.filterType, filterTypeForFamily(filterType, i))}
            >
              <span>{family.label}</span>
              {#if filterFamily === i}<span class="strip-sub">{family.slopes[filterType % 2]}</span>{/if}
            </button>
          {/each}
        </div>
        <div class="device-segmented strip-row flex-none" style="--btn-tint: {voiceInk.primary}; grid-template-columns: repeat(5, 1fr);">
          {#each [0, 1, 2, 3] as amount}
            <button
              class="device-segment strip-step"
              class:active={driveAmount(drive) === amount}
              title={ANALOG_DRIVES[driveForAmount(drive, amount)]}
              aria-label="Filter {voice} drive {ANALOG_DRIVES[driveForAmount(drive, amount)]}"
              aria-pressed={driveAmount(drive) === amount}
              onclick={() => write(p.drive, driveForAmount(drive, amount))}
            >{amount === 0 ? 'Off' : amount}</button>
          {/each}
          <button
            class="device-segment strip-step"
            class:active={driveIsAsym(drive)}
            title="Asymmetric drive"
            aria-label="Filter {voice} asymmetric drive"
            aria-pressed={driveIsAsym(drive)}
            onclick={() => write(p.drive, driveToggleAsym(drive))}
          >Asym</button>
        </div>
      </div>

      <!-- The voice's two envelopes, Amp over Filter, as value boxes
           (ADR-477). Both are in view, so there is no Amp/Filter switch:
           each box is half a fader's height and as fine, since a box sweeps
           its range over the same finger travel whatever its size. A seam
           between them; the one after them is the voicing column's. -->
      <div class="env-col flex-none min-h-0 flex gap-(--central-gap)">
        <SectionDivider orientation="vertical" ink={voiceInk.primary} />
        <div class="flex-1 min-w-0 min-h-0 flex flex-col gap-(--central-gap)">
          {#each envelopes as envelope, i (envelope.title)}
            {#if i > 0}<SectionDivider orientation="horizontal" ink={voiceInk.primary} />{/if}
            <EnvelopeGroup ink={voiceInk.primary} title={envelope.title} edges="none">
              {#each envelope.stages as stage (stage.index)}
                <div class="env-slider min-h-0 h-full">
                  <DeviceSlider
                    value={stage.bipolar ? raw(stage.index, 0) : norm(stage.index, stage.atRest)}
                    title={stage.title}
                    icon={stage.icon}
                    orientation="vertical"
                    labelSize="small"
                    color={voiceInk}
                    min={stage.bipolar ? -1 : 0}
                    max={1}
                    centerOrigin={stage.bipolar}
                    centerValue={stage.bipolar ? 0 : undefined}
                    readout={display(stage.index)}
                    onInteraction={(v) => (stage.bipolar ? write(stage.index, Math.max(-1, Math.min(1, v))) : writeNorm(stage.index, v))}
                  />
                </div>
              {/each}
            </EnvelopeGroup>
          {/each}
        </div>
      </div>

      <SectionDivider orientation="vertical" ink={analogInk.primary} />

      <!-- Mono / Poly and the two voicing switches over the wheels, Pitch
           over Mod (ADR-477). Vibrato is a switch here because its depth
           rides the mod wheel under it. -->
      <div class="voicing-col flex-none flex flex-col gap-(--central-gap) min-h-0">
        <div class="grid grid-cols-2 gap-1 flex-none">
          <!-- Mono or Poly is one choice, a two-cell tab across the row;
               Uni and Vib under it are switches of their own. -->
          <div class="col-span-2 device-segmented seg-grid grid grid-cols-2" style="--btn-tint: {analogInk.primary};">
            <button class="device-segment mode-button px-1 text-center" class:active={isMono} aria-pressed={isMono} onclick={() => setMono(true)}>Mono</button>
            <button class="device-segment mode-button px-1 text-center" class:active={!isMono} aria-pressed={!isMono} onclick={() => setMono(false)}>Poly</button>
          </div>
          <button class="physical-button mode-button px-1 text-center" class:active={unisonOn} style="--btn-tint: {analogInk.primary};" aria-pressed={unisonOn} onclick={() => write(ANALOG_UNISON_ON, unisonOn ? 0 : 1)}>Uni</button>
          <button class="physical-button mode-button px-1 text-center" class:active={vibOn} style="--btn-tint: {analogInk.primary};" aria-pressed={vibOn} onclick={() => write(ANALOG_VIB_ON, vibOn ? 0 : 1)}>Vib</button>
        </div>
        <div class="flex-1 min-h-0">
          <MidiWheelsPanel pitchColor={pitchInk} modColor={modInk} />
        </div>
      </div>
    </div>
  {:else}
    <DeviceEmptyState glyph="~" message="Load Analog to access its controls" color={analogInk.primary} />
  {/if}
</div>

<style>
  .analog-root {
    --analog-slider-w: 56px;
    --analog-env-w: var(--height-touch);
  }

  /* Shapes two rows (the badge over the route chip, then the shapes' 2 x 2
     tab across two columns), then three bands: octave, Sub/Sync, Level.
     One grid, so every row is one height. */
  .osc-body {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-rows: repeat(5, minmax(0, 1fr));
    gap: var(--spacing-sm);
  }
  .octave-row,
  .osc-row {
    grid-column: 1 / -1;
  }
  .osc-row {
    display: flex;
    gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
  }
  .shape-tab {
    grid-column: 2 / span 2;
    grid-row: 1 / span 2;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
    min-height: 0;
    min-width: 0;
  }
  .wave-button,
  .route-button {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    min-height: 0;
    min-width: 0;
  }
  .route-button {
    font-size: 0.75rem;
    font-weight: 600;
    gap: 2px;
    white-space: nowrap;
  }
  .route-arrow {
    opacity: 0.7;
  }
  .route-chip {
    height: var(--height-touch);
  }
  .wave-glyph {
    width: 100%;
    height: 100%;
    max-height: 22px;
  }

  .octave-row,
  .mode-row,
  .strip-row {
    display: grid;
  }
  .mode-row {
    grid-template-columns: repeat(2, 1fr);
  }
  .mode-row {
    flex: 0 0 auto;
    width: 6rem;
  }
  .octave-row .device-segment + .device-segment,
  .mode-row .device-segment + .device-segment,
  .strip-row .device-segment + .device-segment {
    border-top: 0;
    border-left: 1px solid var(--line-faint);
  }
  .device-segment.active,
  .device-segment.active + .device-segment {
    border-left-color: transparent;
  }
  .strip-row {
    height: var(--height-touch);
  }
  .octave-step,
  .mode-step,
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
    font-variant-numeric: tabular-nums;
  }
  .strip-sub {
    font-size: 0.625rem;
    font-weight: 500;
    opacity: 0.85;
  }

  .slave-chip {
    position: absolute;
    right: 6px;
    bottom: 6px;
    padding: 2px 8px;
    min-height: 0;
    font-size: 0.6875rem;
    font-weight: 600;
  }

  .noise-col {
    width: var(--analog-slider-w);
  }
  /* Two slider widths: the switches' 2 x 2 over the stacked wheels. */
  .voicing-col {
    width: calc(2 * var(--analog-slider-w) + var(--central-gap));
  }
  /* Five stages and their four gaps, plus the leading seam and the gap
     after it; the seam that closes the pair is the voicing column's. */
  .env-col {
    width: calc(5 * var(--analog-env-w) + 5 * var(--central-gap) + 1px);
  }
  .env-slider {
    flex: 0 0 var(--analog-env-w);
    width: var(--analog-env-w);
  }

  /* Smaller iPads (ADR-476). Every column but the filter's is fixed or
     floored, so the filter took the whole shortfall. The voicing column comes
     down to two 44px touch floors (Noise keeps 56px: its route chip,
     "→F1+F2", needs it), and the voice card and the filter share what is left from their
     12.9-inch widths, 196 and 249px: an 11-inch draws both at those, a
     10.2-inch gives up ~20% of each, and the voice card stops at 152px. After
     the rules it overrides, which it matches in specificity. */
  @media (max-width: 1365.98px) {
    .voicing-col {
      width: calc(2 * var(--height-touch) + var(--central-gap));
    }
    .voice-card {
      flex: 0 1 196px;
      min-width: 152px;
    }
    .filter-col {
      flex: 1 1 249px;
    }
  }
  .mode-button {
    min-height: var(--height-touch);
    font-size: 0.8125rem;
  }

  /* The Voice 1/2 switch: Drift's OSC badge, a circle in the grid's first cell. */
  .osc-badge-cell {
    container-type: size;
    display: grid;
    place-items: center;
    min-width: 0;
    min-height: 0;
  }
  .osc-badge {
    width: 100cqmin;
    height: 100cqmin;
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

  /* ---- Flat grammar. The segmented rows' dividers, and the voice colour
     re-asserted against the house pair: here the colour IS the meaning
     (which half you are holding), as on Drift's source cards. */
  :global([data-grammar="flat"]) .analog-root .device-segmented:not(.seg-grid) .device-segment + .device-segment {
    border-top: 0;
    border-left: 1px solid var(--line-strong);
  }
  :global([data-grammar="flat"]) .analog-root .device-segment.active,
  :global([data-grammar="flat"]) .analog-root .device-segment.active + .device-segment {
    border-left-color: transparent;
  }
  :global([data-grammar="flat"]) .analog-root .device-segment {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
  :global([data-grammar="flat"]) .analog-root .device-segment:hover:not(.active) {
    color: var(--btn-tint);
    background: color-mix(in srgb, var(--btn-tint) 12%, transparent);
  }
  :global([data-grammar="flat"]) .analog-root .device-segment.active {
    background: var(--btn-tint);
    color: var(--flat-on-fg);
  }
  :global([data-grammar="flat"]) .analog-root .shape-tab .device-segment:not(.active),
  :global([data-grammar="flat"]) .analog-root .voice-card .physical-button,
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
