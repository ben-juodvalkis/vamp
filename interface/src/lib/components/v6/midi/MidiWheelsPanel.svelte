<script lang="ts">
  import { sendPitchWheel, sendModWheel } from '$lib/api/midiWheels';
  import MidiWheel from './MidiWheel.svelte';
  import { PITCH_COLOR, MOD_COLOR, type DeviceColorScheme } from '$lib/config/devicePresets';
  import { deviceInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';

  // Both wheels follow the focused track's ink (ADR-402), distinguished by
  // their PITCH/MOD labels + behaviour. The ink-calibrated PITCH/MOD family
  // palettes remain the cold-start fallback (no-op in dark — the family hexes
  // are ink fixed points; light mode derives its rendering here).
  const inked = (c: DeviceColorScheme): DeviceColorScheme => ({
    primary: deviceInk(c.primary, paintModeReactive()),
    secondary: c.secondary,
    accent: deviceInk(c.accent, paintModeReactive())
  });
  const pitchColor = $derived(selectedTrackScheme() ?? inked(PITCH_COLOR));
  const modColor = $derived(selectedTrackScheme() ?? inked(MOD_COLOR));

  // Handle pitch bend value (0-16383)
  function handlePitchChange(value: number) {
    sendPitchWheel(value);
  }

  // Handle mod wheel value (0-127)
  function handleModChange(value: number) {
    sendModWheel(value);
  }
</script>

<div class="midi-wheels-panel">
  <div class="wheels-container">
    <MidiWheel
      type="pitch"
      onInteraction={handlePitchChange}
      color={pitchColor}
      height="100%"
      width="100%"
    />

    <MidiWheel
      type="modwheel"
      onInteraction={handleModChange}
      color={modColor}
      height="100%"
      width="100%"
    />
  </div>
</div>

<style>
  .midi-wheels-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
  }

  .wheels-container {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    min-height: 0;
  }
</style>