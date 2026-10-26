<script lang="ts">
  /**
   * The pitch and mod wheels, Pitch over Mod in one column (ADR-477). Each
   * is half the column's height and as fine as a full-height wheel, since a
   * wheel sweeps over the value-box travel at least. Side by side, two
   * full-height wheels cost every instrument view a second column for no
   * more precision. The host sets the column's width; the gap is the view's.
   */
  import { sendPitchWheel, sendModWheel } from '$lib/api/midiWheels';
  import MidiWheel from './MidiWheel.svelte';
  import { PITCH_COLOR, MOD_COLOR, type DeviceColorScheme } from '$lib/config/devicePresets';
  import { deviceInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';

  interface Props {
    /** The view's own inks; unset, the focused track's (ADR-402). */
    pitchColor?: DeviceColorScheme;
    modColor?: DeviceColorScheme;
    /** Pitch beside Mod instead of over it — a short host, the chain overview's two-row cell. */
    sideBySide?: boolean;
  }

  let { pitchColor, modColor, sideBySide = false }: Props = $props();

  // Both wheels follow the focused track's ink (ADR-402), distinguished by
  // their PITCH/MOD labels + behaviour. The ink-calibrated PITCH/MOD family
  // palettes remain the cold-start fallback (no-op in dark — the family hexes
  // are ink fixed points; light mode derives its rendering here).
  const inked = (c: DeviceColorScheme): DeviceColorScheme => ({
    primary: deviceInk(c.primary, paintModeReactive()),
    secondary: c.secondary,
    accent: deviceInk(c.accent, paintModeReactive())
  });
  const pitchInk = $derived(pitchColor ?? selectedTrackScheme() ?? inked(PITCH_COLOR));
  const modInk = $derived(modColor ?? selectedTrackScheme() ?? inked(MOD_COLOR));
</script>

<div class="midi-wheels-panel" class:side-by-side={sideBySide}>
  <div class="wheel-cell">
    <MidiWheel type="pitch" onInteraction={sendPitchWheel} color={pitchInk} />
  </div>
  <div class="wheel-cell">
    <MidiWheel type="modwheel" onInteraction={sendModWheel} color={modInk} />
  </div>
</div>

<style>
  .midi-wheels-panel {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    height: 100%;
    width: 100%;
    min-height: 0;
  }

  .midi-wheels-panel.side-by-side {
    flex-direction: row;
  }

  .wheel-cell {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
  }
</style>
