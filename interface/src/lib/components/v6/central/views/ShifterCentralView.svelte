<script lang="ts">
  /**
   * The Shifter's view (Live's Shifter, the `shifter` slot). Its own file
   * since the FX chain overview took over from the grid (2026-10-26); it
   * was the first column of the Saturator tile's view.
   *
   * One fader on param 18 RM Coarse over 0..0.75 — measured off the
   * running device, 0 = 1.00 Hz, 0.25 = 10 Hz, 0.5 = 100 Hz,
   * 0.75 = 1.00 kHz. RM Coarse is heard only in Ring mode (32 Mode:
   * 0 Pitch, 1 Freq, 2 Ring), so a gesture that loads the Shifter also
   * sets Ring.
   *
   * NO {#if device} gate - always renders, handles its own state.
   */

  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';

  const shifter = useFxGridSlot('shifter');

  const SHIFTER_RM_COARSE = 18;
  const SHIFTER_RM_MAX = 0.75;
  const SHIFTER_MODE = 32;
  const SHIFTER_MODE_RING = 2;

  let shifterInk = $derived({
    primary: trackInk(shifter.color.primary, paintModeReactive()),
    secondary: shifter.color.secondary,
    accent: trackInk(shifter.color.accent, paintModeReactive())
  });

  // A ghost slot's first write loads the Shifter; Ring goes with it as a
  // pending write, so the fader is heard the moment the device lands.
  // RM Coarse starts at 0 (1 Hz) rather than Live's 0.75 (user, 2026-10-05):
  // a tap writes it, a drag writes its own value after.
  function armShifterLoad() {
    if (!shifter.isGhost) return;
    shifter.sendParam(SHIFTER_MODE, SHIFTER_MODE_RING);
    shifter.sendParam(SHIFTER_RM_COARSE, 0);
  }
</script>

<div class="shifter-layout" data-view="shifter">
  <div class="slider-col" class:slot-ghost={shifter.isGhost}>
    <DeviceSlider
      value={Math.min(shifter.paramValue(SHIFTER_RM_COARSE) ?? 0, SHIFTER_RM_MAX)}
      title="Shifter"
      icon="ringmod"
      orientation="vertical"
      isGhost={shifter.isGhost}
      color={shifterInk}
      readout={shifter.paramDisplay(SHIFTER_RM_COARSE)}
      min={0}
      max={SHIFTER_RM_MAX}
      onTap={() => armShifterLoad()}
      onInteraction={(v) => {
        armShifterLoad();
        shifter.sendParam(SHIFTER_RM_COARSE, v);
      }}
    />
  </div>
</div>

<style>
  .shifter-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  .slider-col {
    min-width: 0;
    min-height: 0;
  }
</style>
