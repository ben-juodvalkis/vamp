<script lang="ts">
  /**
   * Drum Rack macro grid — the `macro-grid` mode of DrumRackCentralView:
   * one slider per mapped macro of the rack's own, in macro order, named
   * as Live names it (0-127).
   *
   * Mounted by `DrumRackCentralView` when the surface's `vm.members`
   * census says the rack's own macros are mapped (the kit's author has
   * already chosen its controls), or that its pads are plugin-hosted
   * (`AuPluginDevice` / `PluginDevice`), where the rack's macros are the
   * only handle there is. Which macros are mapped is Live's own
   * `RackDevice.macros_mapped`, never read off the names: a mapped macro
   * may keep its default "Macro N" name. Not a registry view (ADR-428,
   * Milestone 1b), so it deliberately drops the `*CentralView` suffix.
   */
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import { glyphForName } from '$lib/config/controlGlyphMap';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { familyScheme } from '$lib/config/devicePresets';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';

  interface Props {
    instrument?: InstrumentInfo | null;
    /** The mapped macros as 1-based parameter indices (`mappedMacroIndices`). */
    mapped?: readonly number[];
  }

  let { instrument, mapped = [] }: Props = $props();

  // Track reactive state
  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);

  // PR-4a-6a1: path-keyed device lookup (v3 tree, chain-order indexed).
  // Returns `undefined` on cold start — same "show ghost" posture as
  // the v2 .find() it replaces.
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);

  // Drum Rack color scheme — distortion family (the
  // drum-rack theme on the gap wheel, ADR-400; matches DrumRackCentralView).
  const drumRackKKColor = familyScheme('distortion');

  // Normalized twin through the calibrated ink layer (hue preserved).
  let drumRackKKInk = $derived(selectedTrackScheme() ?? {
    primary: trackInk(drumRackKKColor.primary, paintModeReactive()),
    secondary: drumRackKKColor.secondary,
    accent: trackInk(drumRackKKColor.accent, paintModeReactive())
  });

  // PR-3.5.4: parameter names derived from the v3 store; preset swaps
  // re-run automatically.
  let parameterNames = $derived(
    device ? selectedTrackStore.paramNamesForDevice(device) : []
  );

  // Helper to get parameter value - uses $derived internally through the store
  function getParamValue(paramIndex: number): number {
    return device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, paramIndex)) ?? 0 : 0;
  }

  // Helper to clean parameter names (strip leading number prefix like "103 ")
  function cleanParameterName(name: string): string {
    const match = name.match(/^\d+\s+(.+)$/);
    return match ? match[1] : name;
  }

  let usedMacros = $derived(mapped.filter((paramIndex) => paramIndex < parameterNames.length));

  // Single row with dynamic column count matching macro count
  let gridCols = $derived(usedMacros.length);

  // Handle parameter changes - just send to store, control component handles local state
  function handleParameterChange(paramIndex: number, value: number) {
    if (!device) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, paramIndex), value);
  }
</script>

<div class="h-full w-full flex flex-col">
  {#if instrument}
    <!-- One slider per mapped macro -->
    {#if usedMacros.length > 0}
      <div
        class="flex-1 min-h-0 grid gap-(--central-gap)"
        style="grid-template-columns: repeat({gridCols}, 1fr);"
      >
        {#each usedMacros as paramIndex (paramIndex)}
          <div class="flex flex-col min-h-0">
            <DeviceSlider
              value={getParamValue(paramIndex) / 127}
              title={cleanParameterName(parameterNames[paramIndex])}
              icon={glyphForName(cleanParameterName(parameterNames[paramIndex]))}
              orientation="vertical"
              labelOrientation="horizontal"
              color={drumRackKKInk}
              onInteraction={(value) => {
                handleParameterChange(paramIndex, Math.round(value * 127));
              }}
            />
          </div>
        {/each}
      </div>
    {:else}
      <!-- Nothing mapped, or the census has not said yet -->
      <div class="flex-1 flex items-center justify-center text-muted-foreground">
        <p class="text-sm">No mapped macros</p>
      </div>
    {/if}
  {:else}
    <DeviceEmptyState glyph="🥁" message="Load a drum rack" color={drumRackKKInk.primary} />
  {/if}
</div>
