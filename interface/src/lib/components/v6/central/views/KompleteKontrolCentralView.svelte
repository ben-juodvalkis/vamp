<script lang="ts">
  /**
   * Komplete Kontrol Central View: the plug-in's eight parameters (Live's
   * indices 1-8) as knobs, two rows of four, each as large as its cell
   * holds with its name beside it (`KnobGrid`, ADR-509), in the selected
   * track's ink (ADR-544; a cyan of its own was the cold-start fallback
   * until then). The swap pill keeps CentralDisplay's column down the
   * left. The wheels left for the MidiWheels device's chain cell (user,
   * 2026-10-26).
   */
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import KnobGrid from '../../device-panel/KnobGrid.svelte';
  import { glyphForName } from '$lib/config/controlGlyphMap';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { selectedAmountScheme } from '$lib/utils/selectedTrackInk';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  // Track reactive state

  // PR-4a-6a6: path-keyed device lookup (v3 tree, chain-order indexed).
  // Returns `undefined` on cold start — same "show ghost" posture as
  // the v2 .find() it replaces.
  let device = $derived(selectedTrackStore.instrumentDevice(instrument));

  // One ink (ADR-544): the selected track's.
  let kompleteKontrolInk = $derived(selectedAmountScheme());

  // All parameter values as $derived - always reactive to store changes
  let param1Value = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 1)) ?? 0.5 : 0.5);
  let param2Value = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 2)) ?? 0.5 : 0.5);
  let param3Value = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 3)) ?? 0.5 : 0.5);
  let param4Value = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 4)) ?? 0.5 : 0.5);
  let param5Value = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 5)) ?? 0.5 : 0.5);
  let param6Value = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 6)) ?? 0.5 : 0.5);
  let param7Value = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 7)) ?? 0.5 : 0.5);
  let param8Value = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 8)) ?? 0.5 : 0.5);

  // PR-3.5.4: parameter names derived from the v3 store (sync); preset
  // swaps re-run automatically.
  let parameterNames = $derived(
    device ? selectedTrackStore.paramNamesForDevice(device) : []
  );

  // Helper to clean parameter names (strip leading number prefix)
  function cleanParameterName(name: string): string {
    const match = name.match(/^\d+\s+(.+)$/);
    return match ? match[1] : name;
  }

  // Helper to get parameter value by index
  function getParamValue(index: number): number {
    switch (index) {
      case 1: return param1Value;
      case 2: return param2Value;
      case 3: return param3Value;
      case 4: return param4Value;
      case 5: return param5Value;
      case 6: return param6Value;
      case 7: return param7Value;
      case 8: return param8Value;
      default: return 0.5;
    }
  }

  // Komplete Kontrol has 8 macro parameters (indices 1-8)
  const SLIDER_PARAMS = [1, 2, 3, 4, 5, 6, 7, 8];
</script>

<div class="h-full w-full flex flex-col" data-density="compact">
  {#if instrument}
    <div class="controls-panel">
      <!-- The plug-in's eight parameters as knobs, as Live draws a rack's
           macros: the grid that gives each the most room (ADR-509). -->
      <KnobGrid count={SLIDER_PARAMS.length}>
      {#snippet item(i, size)}
        {@const paramIndex = SLIDER_PARAMS[i]}
        <!-- Live's parameter list has Device On at 0, so a knob's name is at its own index (an off-by-one named the first knob "Device On", 2026-11-08). -->
        {@const name = parameterNames[paramIndex] ? cleanParameterName(parameterNames[paramIndex]) : `Param ${paramIndex}`}
          <DeviceSlider
            value={getParamValue(paramIndex)}
            title={name}
            face="knob"
            knobSize={size}
            icon={glyphForName(name)}
            color={kompleteKontrolInk}
            readout={device ? selectedTrackStore.paramDisplay(selectedTrackStore.paramPath(device, paramIndex)) : undefined}
            onInteraction={(value) => {
              if (!device) return;
              selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, paramIndex), value);
            }}
          />
      {/snippet}
      </KnobGrid>
    </div>
  {:else}
    <!-- Default state when no Komplete Kontrol present -->
    <DeviceEmptyState message="Load Komplete Kontrol to access controls" color={kompleteKontrolInk.primary} />
  {/if}
</div>

<style>
  .controls-panel {
    flex: 1;
    display: flex;
    flex-direction: row;
    gap: var(--central-gap);
    padding: var(--central-inset);
    min-height: 0;
    overflow: hidden;
  }

</style>