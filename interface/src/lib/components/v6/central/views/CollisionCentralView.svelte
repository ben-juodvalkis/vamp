<script lang="ts">
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { familyScheme } from '$lib/config/devicePresets';
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

  // Collision color scheme — distortion family (the view's old orange on
  // the gap wheel, ADR-400; physical-modeling aesthetic preserved).
  const collisionColor = familyScheme('distortion');

  // GRATICULE (§5.5): normalize the per-section palette through trackInk at injection.
  let trackScheme = $derived(selectedTrackScheme());
  let collisionInk = $derived(trackScheme ?? {
    primary: trackInk(collisionColor.primary, paintModeReactive()),
    secondary: collisionColor.secondary,
    accent: trackInk(collisionColor.accent, paintModeReactive())
  });

  // Resonator on/off state (param 32: Res1, param 65: Res2)
  let res1On = $derived(device ? (selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 32)) ?? 1) > 0.5 : true);
  let res2On = $derived(device ? (selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 65)) ?? 0) > 0.5 : false);

  // Parameter values as $derived - always reactive to store changes (ADR-149)
  // Resonator 1: Param 41 (Decay/X), Param 45 (Material/Y)
  let res1DecayValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 41)) ?? 0.5 : 0.5);
  let res1MaterialValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 45)) ?? 0.5 : 0.5);
  // Resonator 2: Param 78 (Decay/X), Param 74 (Material/Y)
  let res2DecayValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 78)) ?? 0.5 : 0.5);
  let res2MaterialValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 74)) ?? 0.5 : 0.5);

  // XY interaction handlers
  function handleRes1Interaction(x: number, y: number) {
    if (!device) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 41), x); // Decay
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 45), y); // Material
  }

  function handleRes2Interaction(x: number, y: number) {
    if (!device) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 78), x); // Decay
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 74), y); // Material
  }
</script>

<div class="h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <!-- Two resonator XY pads side by side, hidden when off; the swap pill
         lies across the top of the first one shown, top-left as in every
         instrument view. The wheels left for the MidiWheels device's
         chain cell (user, 2026-10-26). -->
    <div class="h-full w-full p-(--central-inset) flex items-center justify-center gap-(--central-gap)">
      {#if res1On}
        <div class="flex-1 h-full min-w-0 flex flex-col gap-(--central-gap)">
          <HostedSwapPill />
          <div class="flex-1 min-h-0">
            <DeviceXY
              xValue={res1DecayValue}
              yValue={res1MaterialValue}
              title="Res 1"
              icon="resonator"
              onInteraction={handleRes1Interaction}
              color={collisionInk}
            />
          </div>
        </div>
      {/if}
      {#if res2On}
        <div class="flex-1 h-full min-w-0 flex flex-col gap-(--central-gap)">
          {#if !res1On}<HostedSwapPill />{/if}
          <div class="flex-1 min-h-0">
            <DeviceXY
              xValue={res2DecayValue}
              yValue={res2MaterialValue}
              title="Res 2"
              icon="resonator"
              onInteraction={handleRes2Interaction}
              color={collisionInk}
            />
          </div>
        </div>
      {/if}
      {#if !res1On && !res2On}
        <div class="flex-1 h-full flex flex-col gap-(--central-gap) text-center text-muted-foreground">
          <HostedSwapPill />
          <p class="flex-1 flex items-center justify-center">No resonators active</p>
        </div>
      {/if}
    </div>
  {:else}
    <!-- Default state when no Collision present -->
    <DeviceEmptyState glyph="~" message="Load Collision to access resonator controls" color={collisionInk.primary} />
  {/if}
</div>
