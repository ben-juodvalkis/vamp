<script lang="ts">
  /**
   * Instrument Rack Central View
   *
   * Dynamic layout based on parameter naming:
   * - Macros with shared first word (e.g., "Filter Cut" + "Filter Res") → XY pad
   * - Unpaired macros → individual sliders
   * - MIDI wheels lead the row, under the swap pill (2026-09-16)
   */
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import MidiWheel from '../../midi/MidiWheel.svelte';
  import { send } from '$lib/api/simpleClient';
  import { sendPitchWheel, sendModWheel } from '$lib/api/midiWheels';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { PITCH_COLOR, MOD_COLOR, getControlColor } from '$lib/config/devicePresets';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import { macroGroupTitle } from '$lib/utils/macroLayoutUtils';

  // Import constants
  import constants from '$config/constants.json';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  // Track reactive state
  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);

  // PR-4a-6a5: path-keyed device lookup (v3 tree, chain-order indexed).
  // Returns `undefined` on cold start — same "show ghost" posture as
  // the v2 .find() it replaces.
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);

  // Types for dynamic layout
  type SliderControl = {
    type: 'slider';
    macroIndex: number; // 1-based
    name: string;
  };

  type XYControl = {
    type: 'xy';
    xMacroIndex: number; // 1-based
    yMacroIndex: number; // 1-based
    title: string; // The shared first word
    xName: string; // Full name for X axis
    yName: string; // Full name for Y axis
  };

  type ControlLayout = (SliderControl | XYControl)[];

  // Device configuration constants (use audioEffectRack config - same macro structure)
  const MACRO_COUNT = constants.devices.audioEffectRack?.macroCount ?? 16;
  const MACRO_MAX = constants.devices.audioEffectRack?.macroRange?.max ?? 127;

  // Per-control macro palette, normalized through the calibrated ink layer.
  const ctlInk = (i: number) => {
    const c = getControlColor(i);
    return { primary: trackInk(c.primary, paintModeReactive()), secondary: c.secondary, accent: trackInk(c.accent, paintModeReactive()) };
  };

  // Instrument-rack base ink (purple control-color 0) for the empty-state glyph.
  let trackScheme = $derived(selectedTrackScheme());
  let rackInk = $derived(trackScheme ?? ctlInk(0));

  // Parameter state - single array for all macros
  let macroValues = $state(Array(MACRO_COUNT).fill(0));

  // PR-3.5.4: derived from the v3 store; preset swaps re-run automatically.
  let parameterNames = $derived(
    device ? selectedTrackStore.paramNamesForDevice(device) : []
  );

  // Helper to clean parameter names (strip leading number prefix like "103 ")
  function cleanParameterName(name: string): string {
    const match = name.match(/^\d+\s+(.+)$/);
    return match ? match[1] : name;
  }

  // Extract the first word from a parameter name (for grouping)
  function getFirstWord(name: string): string {
    const cleaned = cleanParameterName(name);
    const firstWord = cleaned.split(/\s+/)[0];
    return firstWord.toLowerCase();
  }

  // Check if a macro name is "empty" (should be skipped)
  function isEmptyMacroName(name: string | undefined | null): boolean {
    if (!name) return true;
    if (name === '.' || name === '-') return true;
    if (/^Macro\s*\d+$/i.test(cleanParameterName(name))) return true;
    return false;
  }

  // Build dynamic layout based on parameter names
  // Sequential pairs with matching first word become XY pads, others become sliders
  function buildLayout(names: string[]): ControlLayout {
    const layout: ControlLayout = [];
    const processed = new Set<number>();

    // Iterate through macros in order, looking for sequential pairs
    for (let idx = 1; idx <= MACRO_COUNT; idx++) {
      if (processed.has(idx)) continue;

      const name = names[idx];
      if (isEmptyMacroName(name)) continue;

      const firstWord = getFirstWord(name);
      const nextIdx = idx + 1;
      const nextName = names[nextIdx];

      // Check if next macro has matching first word (sequential pair)
      if (
        nextIdx <= MACRO_COUNT &&
        !isEmptyMacroName(nextName) &&
        getFirstWord(nextName) === firstWord
      ) {
        // Create XY pad from sequential pair
        layout.push({
          type: 'xy',
          xMacroIndex: idx,
          yMacroIndex: nextIdx,
          title: macroGroupTitle(name),
          xName: cleanParameterName(name),
          yName: cleanParameterName(nextName)
        });
        processed.add(idx);
        processed.add(nextIdx);
      } else {
        // Single macro - becomes slider
        layout.push({
          type: 'slider',
          macroIndex: idx,
          name: cleanParameterName(name)
        });
        processed.add(idx);
      }
    }

    return layout;
  }

  // Derived layout based on current parameter names
  const controlLayout = $derived(buildLayout(parameterNames));

  // Update all macro values in single effect
  $effect(() => {
    if (device) {
      // Read all macro parameter values (1-MACRO_COUNT) from cache
      macroValues = Array.from({ length: MACRO_COUNT }, (_, i) =>
        selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, i + 1)) ?? 0
      );
    } else {
      // No device - reset all values
      macroValues = Array(MACRO_COUNT).fill(0);
    }
  });

  // Parameter change handler for sliders (normalized 0-1 input, converts to 0-127)
  function handleSliderChange(paramIndex: number, normalizedValue: number) {
    if (device) {
      selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, paramIndex), normalizedValue * MACRO_MAX);
    }
  }

  // XY interaction handler (generic for any macro pair)
  function handleXYInteraction(xMacroIndex: number, yMacroIndex: number, x: number, y: number) {
    if (!device) return;
    // XY component uses 0-1 range, convert to 0-127
    const xPath = selectedTrackStore.paramPath(device, xMacroIndex);
    const yPath = selectedTrackStore.paramPath(device, yMacroIndex);
    selectedTrackStore.setParamValue(xPath, x * MACRO_MAX);
    selectedTrackStore.setParamValue(yPath, y * MACRO_MAX);
  }

  // Get normalized value (0-1) for a macro index
  function getNormalizedValue(macroIndex: number): number {
    return macroValues[macroIndex - 1] / MACRO_MAX;
  }

  // MIDI wheel handlers
  function handlePitchChange(value: number) {
    sendPitchWheel(value);
  }

  function handleModChange(value: number) {
    sendModWheel(value);
  }

  // MIDI wheel colors (shared palettes, normalized through the ink layer).
  let pitchInk = $derived(trackScheme ?? { primary: trackInk(PITCH_COLOR.primary, paintModeReactive()), secondary: PITCH_COLOR.secondary, accent: trackInk(PITCH_COLOR.accent, paintModeReactive()) });
  let modInk = $derived(trackScheme ?? { primary: trackInk(MOD_COLOR.primary, paintModeReactive()), secondary: MOD_COLOR.secondary, accent: trackInk(MOD_COLOR.accent, paintModeReactive()) });

</script>

<div class="h-full w-full flex flex-col" data-density="compact">
  {#if instrument}
    <div class="flex-1 min-h-0 flex gap-(--central-gap) p-(--central-inset)">
      <div class="controls-panel">
        <!-- The MIDI wheels lead the row with the swap pill lying across them
             (user's layout, 2026-09-16) — they were the last thing in it.
             Drawn whatever the rack's macros are, so the pill and the wheels
             stay put while a rack loads or names none. -->
        <div class="wheels-group">
          <HostedSwapPill />
          <div class="wheels-row">
            <div class="control-slot slider-slot">
              <MidiWheel
                type="pitch"
                onInteraction={handlePitchChange}
                color={pitchInk}
              />
            </div>
            <div class="control-slot slider-slot">
              <MidiWheel
                type="modwheel"
                onInteraction={handleModChange}
                color={modInk}
              />
            </div>
          </div>
        </div>

        <!-- The wheels send MIDI; the macros are the rack. Without a seam the
             two sat the same gap apart as two macros do (2026-09-13). -->
        <SectionDivider orientation="vertical" />

        <!-- Dynamic controls (XY pads and sliders based on macro naming) -->
        {#if controlLayout.length > 0}
          {#each controlLayout as control, i}
            {#if control.type === 'xy'}
              <div class="control-slot xy-slot">
                <DeviceXY
                  xValue={getNormalizedValue(control.xMacroIndex)}
                  yValue={getNormalizedValue(control.yMacroIndex)}
                  title={control.title}
                  titleClass="text-2xl font-bold"
                  onInteraction={(x, y) => handleXYInteraction(control.xMacroIndex, control.yMacroIndex, x, y)}
                  color={ctlInk(i)}
                />
              </div>
            {:else}
              <div class="control-slot slider-slot">
                <DeviceSlider
                  value={getNormalizedValue(control.macroIndex)}
                  title={control.name}
                  orientation="vertical"
                  color={ctlInk(i)}
                  onInteraction={(val) => handleSliderChange(control.macroIndex, val)}
                />
              </div>
            {/if}
          {/each}
        {:else}
          <!-- No used macros yet (loading or none configured) -->
          <div class="flex-1 flex items-center justify-center text-muted-foreground">
            <p class="text-sm">Loading macros...</p>
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <!-- Default state when no Instrument Rack present -->
    <DeviceEmptyState glyph="🎹" message="Load an Instrument Rack to access controls" color={rackInk.primary} />
  {/if}
</div>

<style>
  .controls-panel {
    flex: 1;
    display: flex;
    flex-direction: row;
    gap: var(--central-gap);
    min-height: 0;
    overflow: hidden;
  }

  .control-slot {
    display: flex;
    min-height: 0;
    min-width: 0;
    height: 100%;
    flex-shrink: 1;
  }

  .slider-slot {
    flex: 1 1 0;
    min-width: 40px;
  }

  .xy-slot {
    flex: 2 1 0;
    aspect-ratio: 1;
  }

  /* The wheels and the pill over them: exactly two slider shares, so a wheel
     stays as wide as a macro slider — the basis is the one gap between the
     two wheels, which a plain `flex: 2 1 0` would have taken out of their
     share. */
  .wheels-group {
    flex: 2 1 var(--central-gap);
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    min-width: 0;
    min-height: 0;
  }
  .wheels-row {
    flex: 1 1 0;
    display: flex;
    gap: var(--central-gap);
    min-height: 0;
  }

</style>
