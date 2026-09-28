<script lang="ts">
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import MidiWheel from '../../midi/MidiWheel.svelte';
  import { send } from '$lib/api/simpleClient';
  import { sendPitchWheel, sendModWheel } from '$lib/api/midiWheels';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { PITCH_COLOR, MOD_COLOR, familyScheme } from '$lib/config/devicePresets';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';

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

  // MIDI wheel colors (shared across central views)
  let pitchInk = $derived(trackScheme ?? {
    primary: trackInk(PITCH_COLOR.primary, paintModeReactive()),
    secondary: PITCH_COLOR.secondary,
    accent: trackInk(PITCH_COLOR.accent, paintModeReactive())
  });
  let modInk = $derived(trackScheme ?? {
    primary: trackInk(MOD_COLOR.primary, paintModeReactive()),
    secondary: MOD_COLOR.secondary,
    accent: trackInk(MOD_COLOR.accent, paintModeReactive())
  });

  // MIDI wheel handlers
  function handlePitchChange(value: number) {
    sendPitchWheel(value);
  }

  function handleModChange(value: number) {
    sendModWheel(value);
  }

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
    <!-- Two resonator XY pads side by side, hidden when off -->
    <div class="h-full w-full p-(--central-inset) flex items-center justify-center gap-(--central-gap)">
      {#if res1On}
        <div class="flex-1 h-full">
          <DeviceXY
            xValue={res1DecayValue}
            yValue={res1MaterialValue}
            title="Res 1"
            onInteraction={handleRes1Interaction}
            color={collisionInk}
          />
        </div>
      {/if}
      {#if res2On}
        <div class="flex-1 h-full">
          <DeviceXY
            xValue={res2DecayValue}
            yValue={res2MaterialValue}
            title="Res 2"
            onInteraction={handleRes2Interaction}
            color={collisionInk}
          />
        </div>
      {/if}
      {#if !res1On && !res2On}
        <div class="flex-1 text-center text-muted-foreground">
          <p>No resonators active</p>
        </div>
      {/if}
      <!-- The wheels send MIDI, not Collision parameters: a seam divides them
           from the device, as in every instrument view (2026-09-13). -->
      <SectionDivider orientation="vertical" />
      <!-- MIDI wheels -->
      <div class="h-full w-24 flex-none">
        <MidiWheel
          type="pitch"
          onInteraction={handlePitchChange}
          color={pitchInk}
        />
      </div>
      <div class="h-full w-24 flex-none">
        <MidiWheel
          type="modwheel"
          onInteraction={handleModChange}
          color={modInk}
        />
      </div>
    </div>
  {:else}
    <!-- Default state when no Collision present -->
    <DeviceEmptyState glyph="~" message="Load Collision to access resonator controls" color={collisionInk.primary} />
  {/if}
</div>
