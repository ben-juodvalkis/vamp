<script lang="ts">
  /**
   * ReverbCentralView - Slot-Aware Version
   *
   * Self-contained central view that queries its own slot state.
   * Renders immediately with ghost/loading/active states.
   * Supports both Convolution and Algorithmic reverb modes.
   *
   * NO {#if device} gate - always renders, handles its own state.
   * NO props required - queries selectedTrackStore directly.
   */

  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { familyScheme, CHARTREUSE_SCHEME } from '$lib/config/devicePresets';
  import { deviceInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import { toRaw, toPosition, LIVE_DEFAULTS } from '$lib/components/v6/device-panel/hybridReverbParams';

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
      4: familyScheme('timeSpace')    // Church — teal
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
    if (reverbMode === 3) {
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
    { name: 'Church', ir_category: 2, ir_file: 10 }
  ];

  const ALGORITHMIC_TYPES = [
    { name: 'Hall', param6: 0 },
    { name: 'Quartz', param6: 1 },
    { name: 'Shimmer', param6: 2 },
    { name: 'Tides', param6: 3 },
    { name: 'Prism', param6: 4 }
  ];

  // Parameter configurations for each algorithmic type
  const ALGORITHMIC_PARAMS = {
    0: [ // Hall
      { index: 11, name: 'Size' },
      { index: 12, name: 'Damping' },
      { index: 14, name: 'Mod' },
      { index: 15, name: 'Shape' },
      { index: 16, name: 'Bass' }
    ],
    1: [ // Quartz
      { index: 11, name: 'Size' },
      { index: 12, name: 'Damping' },
      { index: 14, name: 'Mod' },
      { index: 13, name: 'Diffusion' },
      { index: 25, name: 'Distance' }
    ],
    2: [ // Shimmer
      { index: 11, name: 'Size' },
      { index: 12, name: 'Damping' },
      { index: 14, name: 'Mod' },
      { index: 13, name: 'Diffusion' },
      { index: 19, name: 'Pitch' },
      { index: 18, name: 'Shimmer' }
    ],
    3: [ // Tides
      { index: 11, name: 'Size' },
      { index: 12, name: 'Damping' },
      { index: 20, name: 'Tide' },
      { index: 21, name: 'Rate' },
      { index: 22, name: 'Wave' },
      { index: 23, name: 'Phase' }
    ],
    4: [ // Prism
      { index: 11, name: 'Size' },
      { index: 27, name: 'Low' },
      { index: 26, name: 'High' }
    ]
  };

  // All parameter/property values as $derived - always reactive to store changes
  let reverbMode = $derived(fx.paramValue(48) ?? 2);
  let algorithmicType = $derived(fx.paramValue(6) ?? 0);
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
      selectedTrackStore.subscribeProperty(path, 'ir_decay_time')
    ];
    return () => releases.forEach((fn) => fn());
  });

  // Parameter value cache as $derived (algorithmic params, snapshot per render)
  let parameterValues = $derived.by(() => {
    const newValues = new Map<number, number>();
    Object.values(ALGORITHMIC_PARAMS).flat().forEach(param => {
      const raw = fx.paramValue(param.index) ?? LIVE_DEFAULTS[param.index] ?? 0.5;
      newValues.set(param.index, toPosition(param.index, raw));
    });
    return newValues;
  });

  // Helper functions to check if a specific type is active
  function isConvolutionTypeActive(index: number): boolean {
    return reverbMode === 3 && 
           CONVOLUTION_TYPES[index] && 
           CONVOLUTION_TYPES[index].ir_category === irCategoryIndex && 
           CONVOLUTION_TYPES[index].ir_file === irFileIndex;
  }

  function isAlgorithmicTypeActive(index: number): boolean {
    return reverbMode === 2 && 
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
      fx.sendParam(48, 3);
      if (fx.device && fx.devicePath) {
        selectedTrackStore.setPropertyValue(fx.devicePath, 'ir_category_index', type.ir_category);
        selectedTrackStore.setPropertyValue(fx.devicePath, 'ir_file_index', type.ir_file);
      }
    } else {
      const type = ALGORITHMIC_TYPES[typeIndex - 5];
      fx.sendParam(48, 2);
      fx.sendParam(6, type.param6);
    }
  }

  // Get current algorithmic parameters to display
  let currentAlgorithmicParams = $derived(
    reverbMode === 2 ? ALGORITHMIC_PARAMS[algorithmicType as keyof typeof ALGORITHMIC_PARAMS] || [] : []
  );

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

  // The slider is 0..1; Ti Rate takes a 0..29 step, so it goes through toRaw.
  function handleParameterChange(paramIndex: number, value: number) {
    fx.sendParam(paramIndex, toRaw(paramIndex, value));
  }

  // Build a slider title that appends Live's GUI-formatted value
  // (per ADR-352) when available. Returns the bare name when the
  // surface hasn't sent a display fire for this param yet — happens
  // only during active interaction. Algorithmic params have natural
  // units (Size: ratio, Damping: %, Mod: Hz, Rate: 1/4 etc.) so the
  // appended string substantially clarifies the slider during drag.
  // IR Attack/Decay are properties, not params, and don't ride the
  // param/display address — they intentionally stay as the bare XY
  // pad until property-display lands as a separate piece of work.
  function sliderTitle(paramIndex: number, baseName: string): string {
    const display = fx.paramDisplay(paramIndex);
    return display ? `${baseName} · ${display}` : baseName;
  }
</script>

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

        <!-- Reverb Parameter Section -->
        <div class="flex flex-col gap-(--central-gap) min-h-0">

          <!-- Dynamic parameter controls -->
          {#if reverbMode === 3}
            <!-- Convolution mode - IR timing XY control -->
            <div class="flex-1 min-h-0">
              <DeviceXY
                xValue={irAttackTimeToSlider(irAttackTime)}
                yValue={irDecayTimeToSlider(irDecayTime)}
                title="IR Time"
                isGhost={fx.isGhost}
                color={currentColor}
                onInteraction={(x, y) => {
                  // Do nothing during drag - just for DeviceXY compatibility
                }}
                onRelease={(x, y) => {
                  if (fx.devicePath) {
                    const attackTime = mapToIRAttackTime(x);
                    const decayTime = mapToIRDecayTime(y);
                    selectedTrackStore.setPropertyValue(fx.devicePath, 'ir_attack_time', attackTime);
                    selectedTrackStore.setPropertyValue(fx.devicePath, 'ir_decay_time', decayTime);
                  }
                }}
              />
            </div>
          {:else}
            <!-- Algorithmic mode - show parameter sliders in one row -->
            <div class="flex-1 min-h-0 flex gap-(--central-gap)">
              {#each currentAlgorithmicParams as param}
                <div class="flex-1 min-w-0">
                  <DeviceSlider
                    value={parameterValues.get(param.index) ?? 0.5}
                    title={sliderTitle(param.index, param.name)}
                    orientation="vertical"
                    labelOrientation="horizontal"
                    color={currentColor}
                    onInteraction={(value) => handleParameterChange(param.index, value)}
                  />
                </div>
              {/each}
            </div>
          {/if}

        </div>

    </div>

  </div>
</div>

<style>
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
</style>