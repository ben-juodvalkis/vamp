<script lang="ts">
  /**
   * ReverbCentralView — the Hybrid Reverb, what the Reverb tile opens.
   *
   *   [types 2×5] | [tabs over: the engine's own | what every engine shares]
   *
   * The left picker chooses which reverb: five convolution IRs, five
   * algorithms. Every control is a value box (ADR-477), two rows a group:
   *
   * - The engine's own: an algorithm's controls, signature first, with
   *   Freeze + Freeze In in the bottom-right cell, always in the same place;
   *   or the IR's Attack, Decay and Size, full height.
   * - What every algorithm shares: Decay and Dry/Wet (the Reverb tile's two
   *   axes), Size, Predelay (ms, or 16ths with Sync) and its Feedback, the
   *   algorithm's Delay, Stereo with Bass Mono, and Vintage; an IR keeps
   *   Predelay, Feedback, Stereo, Vintage and Dry/Wet.
   *
   * The picture of the reverb — an algorithm's tail (`reverb/ReverbPortrait`,
   * every band ringing out from the dry hit) or the IR's waveform — is drawn
   * on the Reverb tile, behind its pad, since ADR-477; until then it was a
   * pad of its own here, the tile's two axes a second time.
   *
   * Two tabs over the controls, as Live's device has: the algorithm's (or
   * IR) and EQ (2026-10-02). The EQ tab draws the reverb's own EQ as a curve
   * with a handle per band (`reverb/ReverbEqEditor`), and the group beside
   * it trades the engine's controls for what the curve does not hold: each
   * end's Cut or Shelf with its Slope or Gain, the peaks' Q, the EQ's On and
   * Pre Algo. Freeze keeps its cell on both tabs.
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
  import ControlGlyph from '../../device-panel/ControlGlyph.svelte';
  import type { ControlGlyphName } from '$lib/config/controlGlyphMap';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { familyScheme, CHARTREUSE_SCHEME } from '$lib/config/devicePresets';
  import { deviceInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import ReverbEqEditor from './reverb/ReverbEqEditor.svelte';
  import { useReverbIr } from './reverb/useReverbIr.svelte';
  import {
    IR_ATTACK_MAX,
    attackAtPosition,
    attackPosition,
    categoryLabel,
    decayAt,
    decayY,
    irLabel
  } from './reverb/irDisplay';
  import { eqBands, type EqBand, type EqBandKey } from './reverb/reverbEq';
  import {
    HYBRID,
    LIVE_DEFAULTS,
    ROUTING_ALGORITHM,
    ROUTING_CONVOLUTION,
    EQ_TYPE_LABELS,
    VINTAGE_MAX,
    irSizeFactor,
    irSizePosition,
    algoDelaySeconds,
    algorithmFor,
    controlPosition,
    controlRaw,
    decaySeconds,
    eqGainDb,
    eqGainLabel,
    eqQ,
    eqQLabel,
    eqSlopeLabel,
    feedbackGain,
    percentLabel,
    predelaySeconds,
    sixteenthsLabel,
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
  let irSizeValue = $derived<number>(
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
  /**
   * Attack and Decay while a finger moves their boxes, before the release
   * writes them.
   */
  let irAttackPreview = $state<number | null>(null);
  let irDecayPreview = $state<number | null>(null);
  let irAttackShown = $derived(irAttackPreview ?? irAttackTime);
  let irDecayShown = $derived(irDecayPreview ?? irDecayTime);
  /** The IR's name and category, beside the tabs. */
  let irTitle = $derived(
    irFileName && irFileName !== '<empty>'
      ? `${irLabel(irFileName).name} · ${categoryLabel(irCategoryName)}`
      : categoryLabel(irCategoryName)
  );
  /**
   * The Size slider's position while it is dragged. Attack, Decay and Size
   * are written on release only: Live recalculates the IR on every change,
   * and a stream of them hangs it.
   */
  let irSizePreview = $state<number | null>(null);
  /** Size as its box shows it: the finger's while it drags. */
  let irSizeShown = $derived(irSizePreview !== null ? irSizeFactor(irSizePreview) : irSizeValue);
  /** The IR's axis, held at its span from before a Size drag until the release. */
  let irAxisHeld = $state<number | null>(null);
  /**
   * The seconds the IR's Attack and Decay boxes span: the IR as Size
   * stretches it (Live's 3 s Attack rail until the file is read), fitted
   * (`reverb/irDisplay.ts`) so a short IR does not leave most of a box doing
   * nothing.
   */
  let irAxis = $derived(irAxisHeld ?? (ir.wave && ir.wave.seconds > 0 ? ir.wave.seconds * irSizeShown : IR_ATTACK_MAX));

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

  // The reverb's own EQ, which its tab draws.
  let eq = $derived(eqBands(raw));
  let eqOn = $derived(on(HYBRID.eqOn));
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
    /**
     * Set for a value Live should get once, on release (the IR's): `write`
     * then only previews while the finger moves, and this writes.
     */
    commit?: (t: number) => void;
    chip?: { name: string; index: number };
    /** An EQ end's Cut / Shelf parameter: a chip naming the type. */
    type?: number;
  }

  // The tile's two axes lead: the picture of the tail is the tile's now
  // (ADR-477), so they are boxes here.
  let shared = $derived<Row[]>([
    {
      key: 'decay',
      name: 'Decay',
      position: raw(HYBRID.decay),
      label: frozen ? 'Frozen' : timeLabel(decay),
      write: (t) => fx.sendParam(HYBRID.decay, clamp01(t))
    },
    {
      key: 'drywet',
      name: 'Dry/Wet',
      position: wet,
      label: percentLabel(wet * 100),
      write: (t) => fx.sendParam(HYBRID.dryWet, clamp01(t))
    },
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

  let isConvolution = $derived(reverbMode === ROUTING_CONVOLUTION);

  /**
   * Convolution's shared group: what the device has besides its engines —
   * the algorithm's own Decay, Size and Delay do nothing to an IR — with
   * Dry/Wet last.
   */
  let convolutionShared = $derived<Row[]>([
    ...shared.filter((r) => !['decay', 'drywet', 'size', 'delay'].includes(r.key)),
    ...shared.filter((r) => r.key === 'drywet')
  ]);


  function writeIr(name: string, value: number) {
    if (fx.devicePath) selectedTrackStore.setPropertyValue(fx.devicePath, name, value);
  }

  /** Convolution's own column: the IR's Attack, Decay and Size, fitted to it, written on release. */
  let irRows = $derived<Row[]>([
    {
      key: 'ir-attack',
      name: 'Attack',
      position: attackPosition(irAttackShown, irAxis),
      label: timeLabel(irAttackShown),
      write: (t) => (irAttackPreview = attackAtPosition(t, irAxis)),
      commit: (t) => {
        irAttackPreview = null;
        writeIr('ir_attack_time', attackAtPosition(t, irAxis));
      }
    },
    {
      key: 'ir-decay',
      name: 'Decay',
      position: decayY(irDecayShown, irAxis),
      label: timeLabel(irDecayShown),
      write: (t) => (irDecayPreview = decayAt(t, irAxis)),
      commit: (t) => {
        irDecayPreview = null;
        writeIr('ir_decay_time', decayAt(t, irAxis));
      }
    },
    {
      key: 'ir-size',
      name: 'Size',
      position: irSizePreview ?? irSizePosition(irSizeValue),
      label: percentLabel(irSizeShown * 100),
      write: (t) => {
        if (irSizePreview === null && ir.wave) irAxisHeld = ir.wave.seconds * irSizeValue;
        irSizePreview = t;
      },
      commit: (t) => {
        irSizePreview = null;
        irAxisHeld = null;
        writeIr('ir_size_factor', irSizeFactor(t));
      }
    }
  ]);

  /** What the picture shows: the tail, or the reverb's EQ — Live's two tabs. */
  let panel = $state<'reverb' | 'eq'>('reverb');

  let sharedRows = $derived(isConvolution ? convolutionShared : shared);
  // Two rows of boxes, so a column per two.
  let sharedCols = $derived(Math.ceil(sharedRows.length / 2));
  // The EQ keeps its curve; an algorithm's tail and an IR's waveform are the
  // Reverb tile's (ADR-477), so the controls take the width.
  let hasPicture = $derived(panel === 'eq');
  /** A box group `n` columns of ~60px boxes wide, as the panel was. */
  const groupWidth = (n: number) => `calc(${n} * 60px + ${n - 1} * var(--spacing-sm))`;
  let layoutColumns = $derived(
    hasPicture
      ? `minmax(0, 1fr) auto ${groupWidth(3)} auto ${groupWidth(sharedCols)}`
      : `minmax(0, 3fr) auto minmax(0, ${sharedCols}fr)`
  );
  /** The EQ band last touched: lit on the curve, named in its readout. */
  let eqFocus = $state<EqBandKey>('lo');

  /**
   * The EQ tab's column: what the curve does not hold. An end in Cut has a
   * Slope and no Gain; in Shelf, a Gain and no Slope (Live manual) — the
   * row is whichever applies, beside the chip that switches the type.
   */
  /** A row's glyph, by the name the row wears (shared, IR, EQ and the algorithms' own). */
  const ROW_GLYPHS: Record<string, ControlGlyphName> = {
    Size: 'size',
    // Predelay draws none: beside its Sync chip the glyph would cut the name.
    Feedback: 'feedback',
    Delay: 'delay',
    Stereo: 'width',
    Vintage: 'vintage',
    'Dry/Wet': 'mix',
    Attack: 'attack',
    Decay: 'decay',
    'Lo Slope': 'highpass',
    'Hi Slope': 'cutoff',
    'Lo Gain': 'low',
    'Hi Gain': 'high',
    'Peak 1 Q': 'q',
    'Peak 2 Q': 'q',
    Shape: 'shape',
    'Bass Mult': 'low',
    'Bass X': 'crossover',
    Damping: 'cutoff',
    Mod: 'lfo',
    Distance: 'size',
    Diffusion: 'diffusion',
    'Lo Damp': 'low',
    Shimmer: 'shimmer',
    Pitch: 'transpose',
    Tide: 'waves',
    Rate: 'rate',
    Wave: 'shape',
    Phase: 'phase',
    'Low Mult': 'low',
    'High Mult': 'high',
    'X-Over': 'crossover'
  };

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

<!-- A box's label: its glyph, Live's name and, under it, its value. Drawn in
     both of the slider's label layers, so it flips on the fill. -->
{#snippet boxLabel(name: string, value: string)}
  {@const glyph = ROW_GLYPHS[name]}
  <span class="box-label">{#if glyph}<span class="box-glyph"><ControlGlyph name={glyph} /></span>{/if}<span class="box-name">{name}</span><span class="box-value">{value}</span></span>
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

<!-- One value box, its switch (Sync, Mono, Cut / Shelf) under it. -->
{#snippet sliderBox(row: Row)}
  {#snippet label()}{@render boxLabel(row.name, row.label)}{/snippet}
  <div class="cell">
    <div class="box">
      <DeviceSlider
        value={row.position}
        title="{row.name} {row.label}"
        {label}
        orientation="vertical"
        labelOrientation="horizontal"
        labelSize="small"
        isGhost={fx.isGhost}
        color={currentColor}
        onTap={() => fx.loadIfGhost()}
        onInteraction={row.write}
        onRelease={row.commit}
      />
    </div>
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

          <!-- The ten reverb types, one pick-one tab: convolution down the
               left column, algorithmic down the right. -->
          <div class="type-tab device-segmented seg-grid grid grid-cols-2 grid-rows-5 grid-flow-col flex-1 min-h-0">
            {#each CONVOLUTION_TYPES as type, index}
              {@const typeColor = reverbInk.convolution[index as keyof typeof reverbInk.convolution]}
              <button
                class="device-segment text-sm min-h-0 px-2 font-semibold tracking-wide"
                class:active={isConvolutionTypeActive(index)}
                style="--btn-tint: {typeColor.primary};"
                data-reverb-type={type.name}
                onclick={() => handleReverbTypeChange(index)}
              >
                {type.name}
              </button>
            {/each}
            {#each ALGORITHMIC_TYPES as type, index}
              {@const typeColor = reverbInk.algorithmic[index as keyof typeof reverbInk.algorithmic]}
              <button
                class="device-segment text-sm min-h-0 px-2 font-semibold tracking-wide"
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

        <!-- The type picker chooses WHICH reverb; the sliders shape the one
             it chose. Two unlike halves that shared the grid's gap with
             nothing between them until the hairline landed (2026-09-13). -->
        <SectionDivider orientation="vertical" />

        <div
          class="algo-layout"
          style="grid-template-columns: {layoutColumns};"
          data-reverb-panel={panel}
          data-reverb-algorithm={isConvolution ? 'convolution' : algorithm.key}
        >
          <!-- Live's two tabs, the first wearing the algorithm's name or "IR", over
               the controls (on the tail's corner until ADR-477). -->
          <div class="picture-tabs" role="tablist" aria-label="Reverb picture">
            <div class="device-segmented seg-grid flex">
            <button
              role="tab"
              class="device-segment picture-tab"
              class:active={panel === 'reverb'}
              aria-selected={panel === 'reverb'}
              style="--btn-tint: {currentColor.primary};"
              data-reverb-tab="reverb"
              onclick={() => (panel = 'reverb')}
            >
              {isConvolution ? 'IR' : algorithm.name}
            </button>
            <button
              role="tab"
              class="device-segment picture-tab"
              class:active={panel === 'eq'}
              aria-selected={panel === 'eq'}
              style="--btn-tint: {currentColor.primary};"
              data-reverb-tab="eq"
              onclick={() => (panel = 'eq')}
            >
              EQ
            </button>
            </div>
            {#if panel === 'reverb'}
              <span class="picture-blurb">{isConvolution ? irTitle : algorithm.blurb}</span>
            {/if}
          </div>

          {#if hasPicture}
            <!-- The EQ's curve. An algorithm's tail and an IR's waveform are
                 drawn on the Reverb tile now (ADR-477). -->
            <div class="picture">
              <ReverbEqEditor
                bands={eq}
                on={eqOn}
                color={currentColor}
                isGhost={fx.isGhost}
                selected={eqFocus}
                onSelect={(key) => (eqFocus = key)}
                onWrite={(index, value) => fx.sendParam(index, value)}
              />
            </div>

            <SectionDivider orientation="vertical" />
          {/if}

          <!-- The engine's own controls, or the EQ's, as value boxes down two
               rows (ADR-477); an algorithm's Freeze in the bottom-right cell. -->
          <div class="box-group" class:one-row={panel !== 'eq' && isConvolution} data-reverb-own>
            {#if panel === 'eq'}
              {#each eqRows as row (row.key)}
                {@render sliderBox(row)}
              {/each}
              <div class="cell chips pair-cell">
                {@render chip('On', HYBRID.eqOn, 'EQ On')}
                {@render chip('Pre Algo', HYBRID.eqPreAlgo, 'Pre Algo: the EQ before the algorithm, not after both engines')}
              </div>
            {:else if isConvolution}
              {#each irRows as row (row.key)}
                {@render sliderBox(row)}
              {/each}
            {:else}
              {#each algorithm.controls as control (control.index)}
                {#snippet ownLabel()}{@render boxLabel(control.name, control.label(raw(control.index)))}{/snippet}
                <div class="cell">
                  <div class="box">
                    <DeviceSlider
                      value={controlPosition(control, raw(control.index))}
                      title="{control.name} {control.label(raw(control.index))}"
                      label={ownLabel}
                      orientation="vertical"
                      labelOrientation="horizontal"
                      labelSize="small"
                      isGhost={fx.isGhost}
                      color={currentColor}
                      onTap={() => fx.loadIfGhost()}
                      onInteraction={(t) => fx.sendParam(control.index, controlRaw(control, t))}
                    />
                  </div>
                </div>
              {/each}
            {/if}
            {#if !isConvolution}
              <div class="cell chips freeze-cell">
                {@render chip('Freeze', HYBRID.freeze)}
                {@render chip('In', HYBRID.freezeIn, 'Freeze In: new input still feeds the frozen tail')}
              </div>
            {/if}
          </div>

          <SectionDivider orientation="vertical" />

          <!-- What the device has besides its engines. -->
          <div class="box-group" style="grid-template-columns: repeat({sharedCols}, minmax(0, 1fr));" data-reverb-shared>
            {#each sharedRows as row (row.key)}
              {@render sliderBox(row)}
            {/each}
          </div>
        </div>

    </div>

  </div>
</div>

<style>
  /* The tabs over two groups of value boxes, two rows each, filled column
     by column (ADR-477; two columns of six horizontal rows until then): the
     engine's own (an algorithm's five, Prism's three, the EQ's four and its
     On / Pre Algo) with Freeze bottom right, or the IR's three full height;
     then, past a seam, what every engine shares, Decay and Dry/Wet first.
     The columns are set inline (`layoutColumns`): the groups share the width,
     or, on the EQ tab, keep 60px boxes and leave the rest to the curve. */
  .algo-layout {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--spacing-sm) var(--central-gap);
    height: 100%;
    min-height: 0;
    min-width: 0;
    container-type: inline-size;
  }

  .box-group {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
    grid-auto-flow: column;
    gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
  }
  /* The IR's three (Attack, Decay, Size) stand full height, side by side. */
  .box-group.one-row {
    grid-template-rows: minmax(0, 1fr);
  }

  /* A box, and its switch under it when it has one. */
  .cell {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
  }
  .box {
    flex: 1 1 0;
    display: flex;
    min-height: 0;
    min-width: 0;
  }
  .cell > .reverb-chip {
    flex: 0 0 2.25rem;
  }
  .chips > .reverb-chip {
    flex: 1 1 0;
  }

  .pair-cell {
    grid-column: 3;
    grid-row: 1;
  }
  .freeze-cell {
    grid-column: 3;
    grid-row: 2;
  }

  /* Sized for a box about 60px wide: "Feedback" and "Diffusion" fit on one
     line, a two-word name wraps between its words, never inside one. */
  .box-label {
    position: absolute;
    inset: 0.25rem 0.125rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.125rem;
    font-size: 0.6875rem;
    line-height: 1.15;
    text-align: center;
    text-transform: none;
    letter-spacing: 0;
  }
  .box-name {
    font-weight: 400;
  }
  /* The box's glyph, over its name, in the label's ink so it flips on the fill too. */
  .box-glyph {
    display: block;
    width: 1.25rem;
    height: 1.25rem;
    margin-bottom: 0.125rem;
  }
  .box-value {
    font-weight: var(--font-weight-medium);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* The EQ's curve. */
  .picture {
    position: relative;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .picture-tabs {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
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
  /* Narrow — a drum pad's pane — the blurb gives way. */
  @container (max-width: 420px) {
    .picture-blurb {
      display: none;
    }
  }

  .reverb-chip {
    min-height: 0;
    min-width: 0;
    padding: 0 0.125rem;
    font-size: 0.8125rem;
    white-space: nowrap;
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
  :global([data-grammar="flat"]) .physical-button,
  :global([data-grammar="flat"]) .type-tab .device-segment,
  :global([data-grammar="flat"]) .picture-tab {
    font-weight: var(--font-weight-medium);
    letter-spacing: 0;
  }
  /* The type tab lights its choice in the house --phosphor, the per-type
     ink stepping aside as it did on the buttons it replaced. */
  :global([data-grammar="flat"]) .type-tab .device-segment.active {
    background: var(--phosphor);
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
