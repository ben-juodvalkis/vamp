<script lang="ts">
  /**
   * Drum Rack macro grid — the plugin-pad mode of DrumRackCentralView.
   *
   * Displays used drum rack macros in a dynamic grid (range: 0-127)
   * Checks all 16 macros but only shows ones with meaningful names
   * (hides "Macro X", ".", "-" named parameters)
   *
   * Mounted by `DrumRackCentralView` when the surface's `vm.members`
   * census reports plugin-hosted pads (`AuPluginDevice` / `PluginDevice`
   * — the Komplete Kontrol kits): those pads have no virtual-macro
   * bindings, so the rack's own macros are the only handle on them.
   * Not a registry view (ADR-428, Milestone 1b): it used to be
   * `DrumRackKompleteKontrolCentralView`, chosen by macro *names*
   * (anything but FX1/FX2 on macros 1–2), which sent every Simpler and
   * Sampler kit here too — and on an unmapped kit these sliders move
   * nothing.
   *
   * Use case: Drum racks with Komplete Kontrol instruments mapped to macros 1-16
   *
   * Transitional: Komplete Kontrol is being removed from the rig (user's
   * decision, 2026-09-07). When that migration lands this mode has no
   * kit left to serve and can be deleted together with the
   * `komplete-kontrol` instrument type.
   */
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { familyScheme } from '$lib/config/devicePresets';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  // Track reactive state
  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);

  // PR-4a-6a1: path-keyed device lookup (v3 tree, chain-order indexed).
  // Returns `undefined` on cold start — same "show ghost" posture as
  // the v2 .find() it replaces.
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);

  // Drum Rack + Komplete Kontrol color scheme — distortion family (the
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

  // Check if a macro is actually used (has a meaningful name)
  function isMacroUsed(name: string | undefined, paramIndex: number): boolean {
    if (!name || name === '.' || name === '-') return false;
    // Check for default "Macro X" names
    if (/^Macro \d+$/.test(name)) return false;
    return true;
  }

  // 16 macro parameters (indices 1-16) - we check all 16 but only show used ones
  const ALL_MACRO_PARAMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

  // Filter to only macros that are actually used
  let usedMacros = $derived(
    ALL_MACRO_PARAMS.filter(paramIndex =>
      isMacroUsed(parameterNames[paramIndex], paramIndex)
    )
  );

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
    <!-- Macros grid (only shows used macros, dynamic rows based on count) -->
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
              orientation="vertical"
              color={drumRackKKInk}
              onInteraction={(value) => {
                handleParameterChange(paramIndex, Math.round(value * 127));
              }}
            />
          </div>
        {/each}
      </div>
    {:else}
      <!-- No used macros yet (loading or none configured) -->
      <div class="flex-1 flex items-center justify-center text-muted-foreground">
        <p class="text-sm">Loading macros...</p>
      </div>
    {/if}
  {:else}
    <!-- Default state when no Komplete Kontrol drum rack present -->
    <DeviceEmptyState glyph="🥁🎹" message="Load a drum rack with mapped Komplete Kontrol macros" color={drumRackKKInk.primary} />
  {/if}
</div>
