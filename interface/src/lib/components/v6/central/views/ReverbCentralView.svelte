<script lang="ts">
  /**
   * ReverbCentralView — the Hybrid Reverb, what the Reverb tile opens.
   *
   *   [types 2×5] | [the tail, an XY pad] | [the algorithm's own] [room · output]
   *
   * The left picker chooses which reverb: five convolution IRs, five
   * algorithms. Convolution draws its IR time pad. An algorithm (2026-10-02
   * redesign) draws:
   *
   * - The tail (`reverb/ReverbPortrait`): every band of the reverb ringing
   *   out, highs at the back, on a time axis from the dry hit. Dragging it is
   *   the Reverb tile's gesture — across is Decay (the tail ends under the
   *   handle), up is Dry/Wet — and every other control below bends the
   *   picture the way it bends the sound.
   * - The algorithm's own controls, signature first, and Freeze + Freeze In
   *   on the bottom row, always in the same place.
   * - What every algorithm shares: Size, Predelay (ms, or 16ths with Sync)
   *   and its Feedback, the algorithm's Delay, Stereo with Bass Mono, and
   *   Vintage.
   *
   * Two tabs on the picture, as Live's device has: the algorithm's (the
   * tail) and EQ (2026-10-02). The EQ tab draws the reverb's own EQ as a
   * curve with a handle per band (`reverb/ReverbEqEditor`), and the column
   * beside it trades the algorithm's controls for what the curve does not
   * hold: each end's Cut or Shelf with its Slope or Gain, the peaks' Q, the
   * EQ's On and Pre Algo. Freeze keeps its row on both tabs.
   *
   * Every control reads its value in Live's own format at rest, from the
   * curves in `hybridReverbParams.ts` (measured on the rig): the surface
   * sends Live's display strings only while a write is in flight.
   *
   * NO {#if device} gate — always renders, handles its own ghost state.
   */

  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { session } from '$lib/stores/session.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { familyScheme, CHARTREUSE_SCHEME } from '$lib/config/devicePresets';
  import { deviceInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import ReverbPortrait from './reverb/ReverbPortrait.svelte';
  import ReverbEqEditor from './reverb/ReverbEqEditor.svelte';
  import ReverbIrDisplay from './reverb/ReverbIrDisplay.svelte';
  import { useReverbIr } from './reverb/useReverbIr.svelte';
  import { xToTime, type TailInput } from './reverb/tailPortrait';
  import { eqBands, wetLevelDb, type EqBand, type EqBandKey } from './reverb/reverbEq';
  import {
    HYBRID,
    LIVE_DEFAULTS,
    ROUTING_ALGORITHM,
    ROUTING_CONVOLUTION,
    EQ_TYPE_LABELS,
    VINTAGE_MAX,
    algoDelaySeconds,
    algorithmFor,
    bassMult,
    bassXHz,
    controlPosition,
    controlRaw,
    decaySeconds,
    decayValue,
    eqGainDb,
    eqGainLabel,
    eqQ,
    eqQLabel,
    eqSlopeLabel,
    feedbackGain,
    hzLabel,
    percentLabel,
    predelaySeconds,
    prismMult,
    prismXOverHz,
    shimmerSemitones,
    sixteenthsLabel,
    tidesRateBeats,
    timeLabel,
    vintageLabel
  } from '$lib/components/v6/device-panel/hybridReverbParams';

  const fx = useFxGridSlot('reverb');

  // Per-algorithm identity colors, drawn from the family-ink gap wheel
  // (ADR-400) — algorithms are functionally distinct, so they keep distinct
  // hues, but every hue is a wheel ink (off the signal hues). The two groups
  // are mutually exclusive modes, so hues repeat freely across them.
  const REVERB_COLORS = {
    // Convolution types
    convolution: {
      0: familyScheme('distortion'),  // Short — burnt orange
      1: familyScheme('rackVoice'),   // Drum — rose
      2: CHARTREUSE_SCHEME,           // Spring — chartreuse
      3: familyScheme('pitchSeq'),    // Plate — violet
      4: familyScheme('timeSpace')    // Wood — teal
    },
    // Algorithmic types
    algorithmic: {
      0: familyScheme('filter'),      // Hall — azure
      1: familyScheme('timeSpace'),   // Quartz — teal
      2: familyScheme('modulation'),  // Shimmer — magenta
      3: CHARTREUSE_SCHEME,           // Tides — chartreuse
      4: familyScheme('dynamics')     // Prism — gold
    }
  };

  // GRATICULE (§2.4 / §5.5): normalize the per-type palette through deviceInk at
  // injection — a byte no-op in dark (the wheel inks are fixed points); light
  // mode derives its rendering here. secondary (the alpha wash) is untouched.
  let reverbInk = $derived({
    convolution: Object.fromEntries(
      Object.entries(REVERB_COLORS.convolution).map(([k, c]) => [
        k,
        { primary: deviceInk(c.primary, paintModeReactive()), secondary: c.secondary, accent: deviceInk(c.accent, paintModeReactive()) }
      ])
    ) as typeof REVERB_COLORS.convolution,
    algorithmic: Object.fromEntries(
      Object.entries(REVERB_COLORS.algorithmic).map(([k, c]) => [
        k,
        { primary: deviceInk(c.primary, paintModeReactive()), secondary: c.secondary, accent: deviceInk(c.accent, paintModeReactive()) }
      ])
    ) as typeof REVERB_COLORS.algorithmic
  });

  // Current color, derived from the normalized twin, tracking reverb mode/type.
  let currentColor = $derived.by(() => {
    if (reverbMode === ROUTING_CONVOLUTION) {
      // Convolution mode - find active type
      for (let i = 0; i < CONVOLUTION_TYPES.length; i++) {
        if (isConvolutionTypeActive(i)) {
          return reverbInk.convolution[i as keyof typeof reverbInk.convolution];
        }
      }
      return reverbInk.convolution[0];
    }
    // Algorithmic mode - use algorithmicType directly
    return reverbInk.algorithmic[algorithmicType as keyof typeof reverbInk.algorithmic] || reverbInk.algorithmic[0];
  });

  // Reverb Type Configurations
  const CONVOLUTION_TYPES = [
    { name: 'Short', ir_category: 0, ir_file: 0 },
    { name: 'Drum', ir_category: 3, ir_file: 7 },
    { name: 'Spring', ir_category: 6, ir_file: 0 },
    { name: 'Plate', ir_category: 5, ir_file: 0 },
    // Chambers_and_Large_Rooms #10 is "Large Wood Room" (measured 2026-10-02);
    // the button read "Church" until then.
    { name: 'Wood', ir_category: 2, ir_file: 10 }
  ];

  const ALGORITHMIC_TYPES = [
    { name: 'Hall', param6: 0 },
    { name: 'Quartz', param6: 1 },
    { name: 'Shimmer', param6: 2 },
    { name: 'Tides', param6: 3 },
    { name: 'Prism', param6: 4 }
  ];

  /** A parameter's raw value, or Live's default before the device answers. */
  function raw(index: number): number {
    return fx.paramValue(index) ?? LIVE_DEFAULTS[index] ?? 0;
  }
  const on = (index: number) => raw(index) >= 0.5;
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

  // All parameter/property values as $derived - always reactive to store changes
  let reverbMode = $derived(raw(HYBRID.routing));
  let algorithmicType = $derived(raw(HYBRID.algoType));
  let algorithm = $derived(algorithmFor(algorithmicType));
  let irCategoryIndex = $derived<number>(
    (fx.devicePath ? selectedTrackStore.propertyValue(fx.devicePath, 'ir_category_index') as number | undefined : undefined) ?? 0
  );
  let irFileIndex = $derived<number>(
    (fx.devicePath ? selectedTrackStore.propertyValue(fx.devicePath, 'ir_file_index') as number | undefined : undefined) ?? 0
  );
  let irAttackTime = $derived<number>(
    (fx.devicePath ? selectedTrackStore.propertyValue(fx.devicePath, 'ir_attack_time') as number | undefined : undefined) ?? 0.0
  );
  let irDecayTime = $derived<number>(
    (fx.devicePath ? selectedTrackStore.propertyValue(fx.devicePath, 'ir_decay_time') as number | undefined : undefined) ?? 0.02
  );
  let irSizeFactor = $derived<number>(
    (fx.devicePath ? selectedTrackStore.propertyValue(fx.devicePath, 'ir_size_factor') as number | undefined : undefined) ?? 1
  );
  // Unknown (a surface from before 2026-10-02 does not send it): shaping on,
  // Live's default.
  let irShaping = $derived<boolean>(
    ((fx.devicePath ? selectedTrackStore.propertyValue(fx.devicePath, 'ir_time_shaping_on') as number | undefined : undefined) ?? 1) !== 0
  );

  /** A JSON-string property (Live's IR name lists) as an array of names. */
  function nameList(name: string): string[] {
    const value = fx.devicePath ? selectedTrackStore.propertyValue(fx.devicePath, name) : undefined;
    if (Array.isArray(value)) return value as string[];
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  let irCategoryName = $derived(nameList('ir_category_list')[irCategoryIndex] ?? '');
  let irFileName = $derived(nameList('ir_file_list')[irFileIndex] ?? '');
  // The loaded IR's waveform, from Live's own file.
  const ir = useReverbIr(() => ({ category: irCategoryName, file: irFileName }));
  /** Where a finger on the IR pad is, before its release writes Attack and Decay. */
  let irPreview = $state<{ x: number; y: number } | null>(null);

  // Mount property subscriptions: refcount manager fires the
  // wire-level subscribe on first acquire, unsubscribe on last
  // release. The $effect runs once per devicePath value; teardown
  // calls release.
  $effect(() => {
    const path = fx.devicePath;
    if (!path) return;
    const releases = [
      selectedTrackStore.subscribeProperty(path, 'ir_category_index'),
      selectedTrackStore.subscribeProperty(path, 'ir_file_index'),
      selectedTrackStore.subscribeProperty(path, 'ir_attack_time'),
      selectedTrackStore.subscribeProperty(path, 'ir_decay_time'),
      selectedTrackStore.subscribeProperty(path, 'ir_size_factor'),
      selectedTrackStore.subscribeProperty(path, 'ir_time_shaping_on'),
      selectedTrackStore.subscribeProperty(path, 'ir_category_list'),
      selectedTrackStore.subscribeProperty(path, 'ir_file_list')
    ];
    return () => releases.forEach((fn) => fn());
  });

  // Helper functions to check if a specific type is active
  function isConvolutionTypeActive(index: number): boolean {
    return reverbMode === ROUTING_CONVOLUTION &&
           CONVOLUTION_TYPES[index] &&
           CONVOLUTION_TYPES[index].ir_category === irCategoryIndex &&
           CONVOLUTION_TYPES[index].ir_file === irFileIndex;
  }

  function isAlgorithmicTypeActive(index: number): boolean {
    return reverbMode === ROUTING_ALGORITHM &&
           ALGORITHMIC_TYPES[index] &&
           ALGORITHMIC_TYPES[index].param6 === algorithmicType;
  }

  // Reverb type switching: param mode + (for convolution) IR properties.
  // Param writes route through fx.sendParam, which handles the
  // ghost/loading/active state machine. IR property writes only land
  // when the device is active — properties can't be pending pre-load.
  function handleReverbTypeChange(typeIndex: number) {
    if (typeIndex < 5) {
      const type = CONVOLUTION_TYPES[typeIndex];
      fx.sendParam(HYBRID.routing, ROUTING_CONVOLUTION);
      if (fx.device && fx.devicePath) {
        selectedTrackStore.setPropertyValue(fx.devicePath, 'ir_category_index', type.ir_category);
        selectedTrackStore.setPropertyValue(fx.devicePath, 'ir_file_index', type.ir_file);
      }
    } else {
      const type = ALGORITHMIC_TYPES[typeIndex - 5];
      fx.sendParam(HYBRID.routing, ROUTING_ALGORITHM);
      fx.sendParam(HYBRID.algoType, type.param6);
    }
  }

  // Convert 0-1 slider value to IR attack time (0.0-3.0 seconds)
  function mapToIRAttackTime(sliderValue: number): number {
    const clamped = Math.max(0, Math.min(1, sliderValue));
    return clamped * 3.0; // Linear mapping: 0-1 -> 0.0-3.0
  }

  // Convert 0-1 slider value to IR decay time (0.02-20.0 seconds)
  function mapToIRDecayTime(sliderValue: number): number {
    const clamped = Math.max(0, Math.min(1, sliderValue));
    return 0.02 + clamped * (20.0 - 0.02); // Linear mapping: 0-1 -> 0.02-20.0
  }

  // Convert IR timing values back to 0-1 for display
  function irAttackTimeToSlider(attackTime: number): number {
    return Math.max(0, Math.min(1, attackTime / 3.0));
  }

  function irDecayTimeToSlider(decayTime: number): number {
    return Math.max(0, Math.min(1, (decayTime - 0.02) / (20.0 - 0.02)));
  }

  // ── The algorithm ─────────────────────────────────────────────────────

  let synced = $derived(on(HYBRID.predelaySync));
  /** A sixteenth at the song's tempo, seconds. */
  let sixteenth = $derived(15 / (session.tempo > 0 ? session.tempo : 120));
  let predelay = $derived(synced ? raw(HYBRID.predelay16th) * sixteenth : predelaySeconds(raw(HYBRID.predelay)));
  // Live keeps one Feedback per Predelay mode.
  let feedbackIndex = $derived(synced ? HYBRID.predelayFb16th : HYBRID.predelayFb);
  let algoDelay = $derived(algoDelaySeconds(raw(HYBRID.algoDelay)));
  let decay = $derived(decaySeconds(raw(HYBRID.decay)));
  let wet = $derived(clamp01(raw(HYBRID.dryWet)));
  let frozen = $derived(on(HYBRID.freeze));

  // The reverb's own EQ: its tab draws it, and the tail draws its gain per band.
  let eq = $derived(eqBands(raw));
  let eqOn = $derived(on(HYBRID.eqOn));
  let wetPath = $derived(wetLevelDb(eq, eqOn, clamp01(raw(HYBRID.sendGain))));

  let tail = $derived<TailInput>({
    algo: algorithm.key,
    decay,
    onset: predelay + algoDelay,
    echoSpacing: predelay,
    feedback: feedbackGain(raw(feedbackIndex)),
    size: raw(HYBRID.size),
    damping: raw(HYBRID.damping),
    diffusion: raw(HYBRID.diffusion),
    mod: raw(HYBRID.mod),
    shape: raw(HYBRID.hallShape),
    bassMult: bassMult(raw(HYBRID.hallBassMult)),
    bassX: bassXHz(raw(HYBRID.hallBassX)),
    lowDamp: raw(HYBRID.quartzLowDamp),
    distance: raw(HYBRID.quartzDistance),
    shimmer: raw(HYBRID.shimmer),
    pitch: shimmerSemitones(raw(HYBRID.shimmerPitch)),
    tide: raw(HYBRID.tide),
    tidePeriod: tidesRateBeats(raw(HYBRID.tidesRate)) * 4 * sixteenth,
    wave: raw(HYBRID.tidesWave),
    lowMult: prismMult(raw(HYBRID.prismLowMult)),
    highMult: prismMult(raw(HYBRID.prismHighMult)),
    xOver: prismXOverHz(raw(HYBRID.prismXOver)),
    freeze: frozen,
    wet,
    levelDb: wetPath,
    vintage: Math.round(raw(HYBRID.vintage))
  });

  let readouts = $derived([
    { name: 'Decay', value: frozen ? 'Frozen' : timeLabel(decay) },
    { name: 'Dry/Wet', value: percentLabel(wet * 100) }
  ]);

  let crossoverLabel = $derived(
    algorithm.key === 'darkHall'
      ? `Bass X ${hzLabel(tail.bassX)}`
      : algorithm.key === 'prism'
        ? `X-Over ${hzLabel(tail.xOver)}`
        : undefined
  );

  /** The tail pad: X is where the tail ends, so Decay is that time less the onset. */
  function moveTail(x: number, y: number) {
    fx.sendParam(HYBRID.decay, decayValue(xToTime(x) - tail.onset));
    fx.sendParam(HYBRID.dryWet, clamp01(y));
  }

  function toggle(index: number) {
    fx.sendParam(index, on(index) ? 0 : 1);
  }

  /** A shared-column slider: its 0..1 position, Live's label, and its write. */
  interface Row {
    key: string;
    name: string;
    position: number;
    label: string;
    write: (t: number) => void;
    chip?: { name: string; index: number };
    /** An EQ end's Cut / Shelf parameter: a chip naming the type. */
    type?: number;
  }

  let shared = $derived<Row[]>([
    {
      key: 'size',
      name: 'Size',
      position: raw(HYBRID.size),
      label: percentLabel(raw(HYBRID.size) * 100),
      write: (t) => fx.sendParam(HYBRID.size, clamp01(t))
    },
    synced
      ? {
          key: 'predelay',
          name: 'Predelay',
          position: raw(HYBRID.predelay16th) / 16,
          label: sixteenthsLabel(raw(HYBRID.predelay16th)),
          write: (t) => fx.sendParam(HYBRID.predelay16th, Math.round(clamp01(t) * 16)),
          chip: { name: 'Sync', index: HYBRID.predelaySync }
        }
      : {
          key: 'predelay',
          name: 'Predelay',
          position: raw(HYBRID.predelay),
          label: timeLabel(predelay),
          write: (t) => fx.sendParam(HYBRID.predelay, clamp01(t)),
          chip: { name: 'Sync', index: HYBRID.predelaySync }
        },
    {
      key: 'feedback',
      name: 'Feedback',
      position: raw(feedbackIndex),
      label: percentLabel(feedbackGain(raw(feedbackIndex)) * 100),
      write: (t) => fx.sendParam(feedbackIndex, clamp01(t))
    },
    {
      key: 'delay',
      name: 'Delay',
      position: raw(HYBRID.algoDelay),
      label: timeLabel(algoDelay),
      write: (t) => fx.sendParam(HYBRID.algoDelay, clamp01(t))
    },
    {
      key: 'stereo',
      name: 'Stereo',
      position: raw(HYBRID.width),
      label: percentLabel(raw(HYBRID.width) * 200),
      write: (t) => fx.sendParam(HYBRID.width, clamp01(t)),
      chip: { name: 'Mono', index: HYBRID.bassMono }
    },
    {
      key: 'vintage',
      name: 'Vintage',
      position: raw(HYBRID.vintage) / VINTAGE_MAX,
      label: vintageLabel(raw(HYBRID.vintage)),
      write: (t) => fx.sendParam(HYBRID.vintage, Math.round(clamp01(t) * VINTAGE_MAX))
    }
  ]);

  /** What the picture shows: the tail, or the reverb's EQ — Live's two tabs. */
  let panel = $state<'reverb' | 'eq'>('reverb');
  /** The EQ band last touched: lit on the curve, named in its readout. */
  let eqFocus = $state<EqBandKey>('lo');

  /**
   * The EQ tab's column: what the curve does not hold. An end in Cut has a
   * Slope and no Gain; in Shelf, a Gain and no Slope (Live manual) — the
   * row is whichever applies, beside the chip that switches the type.
   */
  let eqRows = $derived.by<Row[]>(() => {
    const end = (b: EqBand): Row =>
      b.kind === 'cut'
        ? {
            key: b.key,
            name: `${b.name} Slope`,
            position: b.slope / 9,
            label: eqSlopeLabel(b.slope),
            write: (t) => fx.sendParam(b.slopeIndex ?? 0, Math.round(clamp01(t) * 9)),
            type: b.typeIndex ?? undefined
          }
        : {
            key: b.key,
            name: `${b.name} Gain`,
            position: b.gain,
            label: eqGainLabel(eqGainDb(b.gain)),
            write: (t) => fx.sendParam(b.gainIndex, clamp01(t)),
            type: b.typeIndex ?? undefined
          };
    const peakQ = (b: EqBand): Row => ({
      key: b.key,
      name: `${b.name} Q`,
      position: b.q,
      label: eqQLabel(eqQ(b.q)),
      write: (t) => fx.sendParam(b.qIndex ?? 0, clamp01(t))
    });
    const [lo, peak1, peak2, hi] = eq;
    return [end(lo), peakQ(peak1), peakQ(peak2), end(hi)];
  });
</script>

<!-- A row's label: Live's name on the left, its value on the right. Drawn in
     both of the slider's label layers, so it flips on the fill. -->
{#snippet rowLabel(name: string, value: string)}
  <span class="row-label"><span class="row-name">{name}</span><span class="row-value">{value}</span></span>
{/snippet}

{#snippet typeChip(index: number)}
  <button
    class="physical-button reverb-chip"
    style="--btn-tint: {currentColor.primary};"
    title="Cut or Shelf"
    data-reverb-switch={index}
    onclick={() => toggle(index)}
  >
    {EQ_TYPE_LABELS[on(index) ? 1 : 0]}
  </button>
{/snippet}

{#snippet sliderRow(row: Row)}
  {#snippet label()}{@render rowLabel(row.name, row.label)}{/snippet}
  <div class="row" class:with-chip={row.chip || row.type !== undefined}>
    <DeviceSlider
      value={row.position}
      title="{row.name} {row.label}"
      {label}
      orientation="horizontal"
      labelOrientation="horizontal"
      labelSize="small"
      isGhost={fx.isGhost}
      color={currentColor}
      onTap={() => fx.loadIfGhost()}
      onInteraction={row.write}
    />
    {#if row.chip}{@render chip(row.chip.name, row.chip.index)}{/if}
    {#if row.type !== undefined}{@render typeChip(row.type)}{/if}
  </div>
{/snippet}

{#snippet chip(name: string, index: number, title?: string)}
  <button
    class="physical-button reverb-chip"
    class:active={on(index)}
    style="--btn-tint: {currentColor.primary};"
    aria-pressed={on(index)}
    title={title ?? name}
    data-reverb-switch={index}
    onclick={() => toggle(index)}
  >
    {name}
  </button>
{/snippet}

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="h-full w-full overflow-hidden relative">
  <div class="h-full w-full p-(--central-inset)">

    <!-- Reverb Controls -->
    <div class="grid grid-cols-[180px_auto_1fr] gap-(--central-gap) h-full min-h-0" class:slot-ghost={fx.isGhost} style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>

        <!-- Reverb Type Tabs -->
        <div class="flex flex-col gap-2 min-h-0">

          <!-- 2-column grid of reverb types -->
          <div class="grid grid-cols-2 gap-1.5 flex-1">

            <!-- Column 1: Convolution Types -->
            <div class="flex flex-col gap-1.5">
              {#each CONVOLUTION_TYPES as type, index}
                {@const typeColor = reverbInk.convolution[index as keyof typeof reverbInk.convolution]}
                <button
                  class="physical-button text-sm h-12 px-2 flex-1 font-semibold tracking-wide"
                  class:active={isConvolutionTypeActive(index)}
                  style="--btn-tint: {typeColor.primary};"
                  data-reverb-type={type.name}
                  onclick={() => handleReverbTypeChange(index)}
                >
                  {type.name}
                </button>
              {/each}
            </div>

            <!-- Column 2: Algorithmic Types -->
            <div class="flex flex-col gap-1.5">
              {#each ALGORITHMIC_TYPES as type, index}
                {@const typeColor = reverbInk.algorithmic[index as keyof typeof reverbInk.algorithmic]}
                <button
                  class="physical-button text-sm h-12 px-2 flex-1 font-semibold tracking-wide"
                  class:active={isAlgorithmicTypeActive(index)}
                  style="--btn-tint: {typeColor.primary};"
                  data-reverb-type={type.name}
                  onclick={() => handleReverbTypeChange(index + 5)}
                >
                  {type.name}
                </button>
              {/each}
            </div>
          </div>
        </div>

        <!-- The type picker chooses WHICH reverb; the sliders shape the one
             it chose. Two unlike halves that shared the grid's gap with
             nothing between them until the hairline landed (2026-09-13). -->
        <SectionDivider orientation="vertical" />

        {#if reverbMode === ROUTING_CONVOLUTION}
          <!-- Convolution mode: the loaded IR, its Attack (across) and Decay (up)
               on the pad. The writes still wait for the release — the picture
               follows the finger meanwhile. -->
          <div class="min-h-0" data-reverb-ir>
            <DeviceXY
              xValue={irAttackTimeToSlider(irAttackTime)}
              yValue={irDecayTimeToSlider(irDecayTime)}
              isGhost={fx.isGhost}
              color={currentColor}
              onInteraction={(x, y) => {
                irPreview = { x, y };
              }}
              onRelease={(x, y) => {
                irPreview = null;
                if (fx.devicePath) {
                  const attackTime = mapToIRAttackTime(x);
                  const decayTime = mapToIRDecayTime(y);
                  selectedTrackStore.setPropertyValue(fx.devicePath, 'ir_attack_time', attackTime);
                  selectedTrackStore.setPropertyValue(fx.devicePath, 'ir_decay_time', decayTime);
                }
              }}
            >
              {#snippet background()}
                <ReverbIrDisplay
                  wave={ir.wave}
                  status={ir.status}
                  category={irCategoryName}
                  file={irFileName}
                  attack={irPreview ? mapToIRAttackTime(irPreview.x) : irAttackTime}
                  decay={irPreview ? mapToIRDecayTime(irPreview.y) : irDecayTime}
                  size={irSizeFactor}
                  shaping={irShaping}
                  color={currentColor}
                  isGhost={fx.isGhost}
                />
              {/snippet}
            </DeviceXY>
          </div>
        {:else}
          <div class="algo-layout" data-reverb-algorithm={algorithm.key}>
            <div class="picture" data-reverb-panel={panel}>
              {#if panel === 'eq'}
                <ReverbEqEditor
                  bands={eq}
                  on={eqOn}
                  color={currentColor}
                  isGhost={fx.isGhost}
                  selected={eqFocus}
                  onSelect={(key) => (eqFocus = key)}
                  onWrite={(index, value) => fx.sendParam(index, value)}
                />
              {:else}
                <ReverbPortrait
                  input={tail}
                  {readouts}
                  {crossoverLabel}
                  color={currentColor}
                  isGhost={fx.isGhost}
                  onMove={moveTail}
                  onTap={() => fx.loadIfGhost()}
                />
              {/if}
              <!-- Live's two tabs; the first wears the algorithm's name. -->
              <div class="picture-tabs" role="tablist" aria-label="Reverb picture">
                <button
                  role="tab"
                  class="physical-button picture-tab"
                  class:active={panel === 'reverb'}
                  aria-selected={panel === 'reverb'}
                  style="--btn-tint: {currentColor.primary};"
                  data-reverb-tab="reverb"
                  onclick={() => (panel = 'reverb')}
                >
                  {algorithm.name}
                </button>
                <button
                  role="tab"
                  class="physical-button picture-tab"
                  class:active={panel === 'eq'}
                  aria-selected={panel === 'eq'}
                  style="--btn-tint: {currentColor.primary};"
                  data-reverb-tab="eq"
                  onclick={() => (panel = 'eq')}
                >
                  EQ
                </button>
                {#if panel === 'reverb'}
                  <span class="picture-blurb">{algorithm.blurb}</span>
                {/if}
              </div>
            </div>

            <SectionDivider orientation="vertical" />

            <!-- The algorithm's own controls, or the EQ's; Freeze on the bottom row. -->
            <div class="algo-col" data-reverb-own>
              {#if panel === 'eq'}
                {#each eqRows as row (row.key)}
                  {@render sliderRow(row)}
                {/each}
                <div class="row chips pair-row">
                  {@render chip('On', HYBRID.eqOn, 'EQ On')}
                  {@render chip('Pre Algo', HYBRID.eqPreAlgo, 'Pre Algo: the EQ before the algorithm, not after both engines')}
                </div>
              {:else}
              {#each algorithm.controls as control (control.index)}
                {#snippet ownLabel()}{@render rowLabel(control.name, control.label(raw(control.index)))}{/snippet}
                <div class="row">
                  <DeviceSlider
                    value={controlPosition(control, raw(control.index))}
                    title="{control.name} {control.label(raw(control.index))}"
                    label={ownLabel}
                    orientation="horizontal"
                    labelOrientation="horizontal"
                    labelSize="small"
                    isGhost={fx.isGhost}
                    color={currentColor}
                    onTap={() => fx.loadIfGhost()}
                    onInteraction={(t) => fx.sendParam(control.index, controlRaw(control, t))}
                  />
                </div>
              {/each}
              {/if}
              <div class="row chips freeze-row">
                {@render chip('Freeze', HYBRID.freeze)}
                {@render chip('In', HYBRID.freezeIn, 'Freeze In: new input still feeds the frozen tail')}
              </div>
            </div>

            <!-- What every algorithm shares. -->
            <div class="algo-col" data-reverb-shared>
              {#each shared as row (row.key)}
                {@render sliderRow(row)}
              {/each}
            </div>
          </div>
        {/if}

    </div>

  </div>
</div>

<style>
  /* The tail takes what the two columns leave. Six rows a column, the
     algorithm's own five (Prism's three) over Freeze, so a row sits level
     with its neighbour across the seam. */
  .algo-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 196px 196px;
    gap: var(--central-gap);
    height: 100%;
    min-height: 0;
    min-width: 0;
  }

  .algo-col {
    display: grid;
    grid-template-rows: repeat(6, minmax(0, 1fr));
    gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
  }

  .row {
    min-height: 0;
    min-width: 0;
  }
  .row.with-chip {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 48px;
    gap: var(--spacing-sm);
  }
  .pair-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--spacing-sm);
  }
  .freeze-row {
    grid-row: 6;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 56px;
    gap: var(--spacing-sm);
  }

  .row-label {
    position: absolute;
    inset: 0 0.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.375rem;
    font-size: 0.8125rem;
    text-transform: none;
    letter-spacing: 0;
    white-space: nowrap;
  }
  .row-name {
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-value {
    font-weight: var(--font-weight-medium);
    font-variant-numeric: tabular-nums;
  }

  /* The picture's frame: the tail or the EQ, Live's two tabs over its corner. */
  .picture {
    position: relative;
    height: 100%;
    min-width: 0;
    min-height: 0;
    container-type: inline-size;
  }
  .picture-tabs {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .picture-tab {
    min-height: 0;
    height: 2rem;
    padding: 0 0.625rem;
    font-size: 0.8125rem;
    white-space: nowrap;
  }
  .picture-blurb {
    margin-left: 0.375rem;
    font-size: 0.75rem;
    color: var(--muted-foreground);
    white-space: nowrap;
    pointer-events: none;
  }
  /* Narrow — a drum pad's pane — the blurb gives way to the readouts. */
  @container (max-width: 330px) {
    .picture-blurb {
      display: none;
    }
  }

  .reverb-chip {
    min-height: 0;
    min-width: 0;
    height: 100%;
    padding: 0 0.25rem;
    font-size: 0.875rem;
  }

  /* ---- Live skin (flat grammar): the reverb-type tabs are Live's plain
     radio buttons — regular/medium weight, no tracking (app.css already
     gives .physical-button its flat control field and ChosenDefault ON
     fill; the per-type --btn-tint steps aside for it, which is what the
     cookbook asks). The IR TIME pad and the algorithmic sliders are
     DeviceXY / DeviceSlider (already flat) inside bare flex wrappers — no
     frame / shadow / wash re-added here. The panel ghost dim keeps the
     shared .slot-ghost / --opacity-ghost ramp (an app-wide idiom, not
     touched here). Graticule is untouched — every rule sits under
     [data-grammar="flat"]. */
  :global([data-grammar="flat"]) .physical-button {
    font-weight: var(--font-weight-medium);
    letter-spacing: 0;
  }
  /* One ink for the algorithm: a lit switch wears its colour rather than
     the house --phosphor, as the Echo view's Sync does. */
  :global([data-grammar="flat"]) .reverb-chip.active,
  :global([data-grammar="flat"]) .picture-tab.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }
  :global([data-grammar="flat"]) .reverb-chip:not(.active),
  :global([data-grammar="flat"]) .picture-tab:not(.active) {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
</style>
