<script lang="ts">
  /**
   * Instrument Rack Central View
   *
   * One value box per named macro, two rows of them (ADR-477), after the
   * swap pill's column (2026-09-16). The wheels that stood under the pill
   * left for the MidiWheels device's chain cell (user, 2026-10-26).
   */
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import { glyphForName } from '$lib/config/controlGlyphMap';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { getControlColor } from '$lib/config/devicePresets';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import { buildMacroLayout, pairXYPrefixedMacros } from '$lib/utils/macroLayoutUtils';

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

  const controlLayout = $derived(buildMacroLayout(parameterNames, 1, MACRO_COUNT));
  // Macros whose first word is "XY" pair up into pads (the rack's own
  // convention, named in Live): "XY Cutoff" + "XY Res" → a Cutoff/Res pad.
  const layoutItems = $derived(pairXYPrefixedMacros(controlLayout));

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

  // Get normalized value (0-1) for a macro index
  function getNormalizedValue(macroIndex: number): number {
    return macroValues[macroIndex - 1] / MACRO_MAX;
  }

</script>

<div class="h-full w-full flex flex-col" data-density="compact">
  {#if instrument}
    <div class="flex-1 min-h-0 flex gap-(--central-gap) p-(--central-inset)">
      <div class="controls-panel">
        <!-- The swap pill lies across the top, over the macros. It led the
             row over the wheels (user's layout, 2026-09-16) until they left
             for the MidiWheels device's chain cell (user, 2026-10-26).
             Drawn whatever the rack's macros are, so it stays put while a
             rack loads or names none. -->
        <div class="pill-group">
          <HostedSwapPill />
        </div>

        <!-- One value box per named macro, two rows filled column by
             column (ADR-477): neighbours pair top over bottom, and an XY
             pad, which stands in for two macros, takes a 2 x 2 block. -->
        {#if controlLayout.length > 0}
          <div class="macro-grid">
          {#each layoutItems as item, i}
            {#if item.kind === 'xy'}
              <div class="control-slot xy-slot">
                <DeviceXY
                  xValue={getNormalizedValue(item.x.macroIndex)}
                  yValue={getNormalizedValue(item.y.macroIndex)}
                  title={item.title}
                  color={ctlInk(i)}
                  onInteraction={(x, y) => {
                    handleSliderChange(item.x.macroIndex, x);
                    handleSliderChange(item.y.macroIndex, y);
                  }}
                />
              </div>
            {:else}
              <div class="control-slot">
                <DeviceSlider
                  value={getNormalizedValue(item.control.macroIndex)}
                  title={item.control.name}
                  icon={glyphForName(item.control.name)}
                  orientation="vertical"
                  color={ctlInk(i)}
                  readout={device ? selectedTrackStore.paramDisplay(selectedTrackStore.paramPath(device, item.control.macroIndex)) : undefined}
                  onInteraction={(val) => handleSliderChange(item.control.macroIndex, val)}
                />
              </div>
            {/if}
          {/each}
          </div>
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
    flex-direction: column;
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

  /* Two rows, filled column by column, every column one share. */
  .macro-grid {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: repeat(2, minmax(0, 1fr));
    grid-auto-flow: column dense;
    grid-auto-columns: minmax(0, 1fr);
    gap: var(--central-gap);
  }

  /* An XY pad stands in for two macros, so it takes a 2 x 2 block. */
  .xy-slot {
    grid-column: span 2;
    grid-row: span 2;
  }

  /* The pill's column: wide enough for the pill to name the preset
     between its two 44px halves (at 10rem it read "Auro…"). */
  .pill-group {
    flex: 0 0 auto;
    min-width: 0;
  }

</style>
