<script lang="ts">
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  // Track reactive state
  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);

  // PR-3.5.2a: path-keyed device lookup (v3 tree, chain-order indexed).
  // Returns `undefined` on cold start — same "show ghost" posture as
  // the v2 .find() it replaces.
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);

  // Electric color scheme (amber/orange - matches electric piano aesthetic)
  const electricColor = {
    primary: '#f59e0b',
    secondary: 'rgba(245, 158, 11, 0.1)',
    accent: '#fbbf24'
  };

  // GRATICULE (§5.5): normalize the per-section palette through trackInk at injection.
  let trackScheme = $derived(selectedTrackScheme());
  let electricInk = $derived(trackScheme ?? {
    primary: trackInk(electricColor.primary, paintModeReactive()),
    secondary: electricColor.secondary,
    accent: trackInk(electricColor.accent, paintModeReactive())
  });

  // All parameter values as $derived - always reactive to store changes (ADR-149)
  // Hammer: Parameter 8 (Stiffness X), Parameter 16 (Noise Y)
  let hammerStiffness = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 8)) ?? 0.5 : 0.5);
  let hammerNoise = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 16)) ?? 0.5 : 0.5);
  // Fork: Parameter 20 (Tine Color X), Parameter 24 (Tine Decay Y)
  let forkTineColor = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 20)) ?? 0.5 : 0.5);
  let forkTineDecay = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 24)) ?? 0.5 : 0.5);

  // XY interaction handlers - just send to store, control component handles local state
  function handleHammerXYInteraction(x: number, y: number) {
    if (!device) return;
    const stiffnessPath = selectedTrackStore.paramPath(device, 8);
    const noisePath = selectedTrackStore.paramPath(device, 16);
    selectedTrackStore.setParamValue(stiffnessPath, x);  // Stiffness
    selectedTrackStore.setParamValue(noisePath, y); // Noise
  }

  function handleForkXYInteraction(x: number, y: number) {
    if (!device) return;
    const tineColorPath = selectedTrackStore.paramPath(device, 20);
    const tineDecayPath = selectedTrackStore.paramPath(device, 24);
    selectedTrackStore.setParamValue(tineColorPath, x); // Tine Color
    selectedTrackStore.setParamValue(tineDecayPath, y); // Tine Decay
  }
</script>

<div class="h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <!-- Layout: Hammer XY + Fork XY. The wheels left for the MidiWheels
         device's chain cell (user, 2026-10-26). -->
    <div class="h-full w-full p-(--central-inset) grid gap-(--central-gap)" style="grid-template-columns: 1fr 1fr;">
      <!-- Hammer XY: Stiffness (X) / Noise (Y), the swap pill lying across
           the top of its column, top-left as in every instrument view. -->
      <div class="min-w-0 min-h-0 flex flex-col gap-(--central-gap)">
        <HostedSwapPill />
        <div class="flex-1 min-h-0">
          <DeviceXY
            xValue={hammerStiffness}
            yValue={hammerNoise}
            title="Hammer"
            icon="hammer"
            onInteraction={handleHammerXYInteraction}
            color={electricInk}
          />
        </div>
      </div>

      <!-- Fork XY: Tine Color (X) / Tine Decay (Y) -->
      <DeviceXY
        xValue={forkTineColor}
        yValue={forkTineDecay}
        title="Fork"
        icon="tune"
        onInteraction={handleForkXYInteraction}
        color={electricInk}
      />
    </div>
  {:else}
    <!-- Default state when no Electric present -->
    <DeviceEmptyState glyph="~" message="Load Electric to access controls" color={electricInk.primary} />
  {/if}
</div>
