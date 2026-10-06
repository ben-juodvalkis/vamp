<script lang="ts">
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import { glyphForName } from '$lib/config/controlGlyphMap';
  import MidiWheel from '../../midi/MidiWheel.svelte';
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

  // PR-4a-6a6: path-keyed device lookup (v3 tree, chain-order indexed).
  // Returns `undefined` on cold start — same "show ghost" posture as
  // the v2 .find() it replaces.
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);

  // Komplete Kontrol color scheme (blue/cyan)
  const kompleteKontrolColor = {
    primary: '#00D4FF',
    secondary: 'rgba(0, 212, 255, 0.1)',
    accent: '#33DDFF'
  };

  // GRATICULE (§5.5): normalize the per-section palette through trackInk at injection.
  let trackScheme = $derived(selectedTrackScheme());
  let kompleteKontrolInk = $derived(trackScheme ?? {
    primary: trackInk(kompleteKontrolColor.primary, paintModeReactive()),
    secondary: kompleteKontrolColor.secondary,
    accent: trackInk(kompleteKontrolColor.accent, paintModeReactive())
  });

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

  // MIDI wheel handlers
  function handlePitchChange(value: number) {
    sendPitchWheel(value);
  }

  function handleModChange(value: number) {
    sendModWheel(value);
  }

  // MIDI wheel colors
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
</script>

<div class="h-full w-full flex flex-col" data-density="compact">
  {#if instrument}
    <!-- 8 sliders + 2 MIDI wheels in equal-width flex layout -->
    <div class="controls-panel">
      {#each SLIDER_PARAMS as paramIndex (paramIndex)}
        {@const name = parameterNames[paramIndex - 1] ? cleanParameterName(parameterNames[paramIndex - 1]) : `Param ${paramIndex}`}
        <div class="control-slot slider-slot">
          <DeviceSlider
            value={getParamValue(paramIndex)}
            labelOrientation="horizontal"
            title={name}
            icon={glyphForName(name)}
            color={kompleteKontrolInk}
            onInteraction={(value) => {
              if (!device) return;
              selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, paramIndex), value);
            }}
          />
        </div>
      {/each}

      <!-- MIDI Wheels as individual slider-width controls -->
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
  {:else}
    <!-- Default state when no Komplete Kontrol present -->
    <DeviceEmptyState glyph="🎹" message="Load Komplete Kontrol to access controls" color={kompleteKontrolInk.primary} />
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
</style>