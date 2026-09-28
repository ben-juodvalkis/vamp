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
  import { PITCH_COLOR, MOD_COLOR } from '$lib/config/devicePresets';
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
    <!-- Layout: Hammer XY + Fork XY | MIDI wheels — the seam divides the
         device from the wheels, which send MIDI (2026-09-13). -->
    <div class="h-full w-full p-(--central-inset) grid gap-(--central-gap)" style="grid-template-columns: 1fr 1fr auto auto;">
      <!-- Hammer XY: Stiffness (X) / Noise (Y) -->
      <DeviceXY
        xValue={hammerStiffness}
        yValue={hammerNoise}
        title="Hammer"
        onInteraction={handleHammerXYInteraction}
        color={electricInk}
      />

      <!-- Fork XY: Tine Color (X) / Tine Decay (Y) -->
      <DeviceXY
        xValue={forkTineColor}
        yValue={forkTineDecay}
        title="Fork"
        onInteraction={handleForkXYInteraction}
        color={electricInk}
      />

      <SectionDivider orientation="vertical" />
      <!-- MIDI Wheels (pitch + mod) -->
      <div class="flex gap-(--central-gap) min-h-0">
        <div class="w-24 h-full">
          <MidiWheel
            type="pitch"
            onInteraction={handlePitchChange}
            color={pitchInk}
          />
        </div>
        <div class="w-24 h-full">
          <MidiWheel
            type="modwheel"
            onInteraction={handleModChange}
            color={modInk}
          />
        </div>
      </div>
    </div>
  {:else}
    <!-- Default state when no Electric present -->
    <DeviceEmptyState glyph="~" message="Load Electric to access controls" color={electricInk.primary} />
  {/if}
</div>
