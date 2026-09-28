<script lang="ts">
  /**
   * OTT Control — the whole fx1 column on the MASTER track.
   *
   * Third arm of the fx1 special-case, alongside the instrument slider
   * (MIDI tracks) and `ClipPitchControl` (audio tracks). Master has no
   * instrument — `instrumentDisplayCoordinator` clears
   * `currentInstrumentStore` on `trackIndex === -1` — so the instrument
   * slider rendered as an inert ghost there, and Rand Oct below it is a
   * MIDI-effect control with no MIDI to touch.
   *
   * This replaced `MasterRackControl` on 2026-09-11 (user's call). That
   * control drove the first *named* macro of an Audio Effect Rack called
   * `Mastering`, which is no longer how this rig masters; the device
   * master actually carries is a Multiband Dynamics, and the one knob
   * worth a full-height column on it is Amount.
   *
   * One parameter, measured off the `.adv` artifact rather than the
   * device docs — the preset's element order IS LOM order with Device On
   * at 0:
   *   6 = GlobalAmount, rail 0..1
   * The device has a nested `<SideChain>` container, the thing that makes
   * `Compressor2`'s indices drift, but it sits at child 60 — after every
   * flat parameter — so nothing at or below 6 moves.
   *
   * Unlike the control it replaced this goes through the FX-grid slot,
   * so the column is live on a master that has no Multiband Dynamics
   * yet: the first drag loads one (ADR-167 — a tile loads on its first
   * drag frame, never on a tap). The preset is the user's own saved default
   * (`Defaults/Audio Effects/Multiband Dynamics.adv`, mirrored into the
   * app's Effect Patches folder so `install-device-defaults` has one
   * source of truth), which is the whole reason a load is worth
   * offering — an unloaded Multiband Dynamics would be no use.
   *
   * Master-only by construction: it has no `fxGridLayout` entry and is
   * mounted by `FXGrid` behind `isMasterTrack`, so no other track can
   * reach it.
   *
   * A tap opens nothing. `ott` has no `device` view in the registry, and
   * the router resolves an unregistered type to the placeholder — which
   * on master would swap `SystemCentralView` out from under the Sections
   * card for a tile whose whole point is to stay on that view (found in
   * the 2026-09-12 review; the same defect a830a7a fixed for `random`).
   */

  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceSlider from './DeviceSlider.svelte';

  const AMOUNT_PARAM = 6;
  const AMOUNT_MIN = 0;
  const AMOUNT_MAX = 1;
</script>

<BaseDeviceControl slotKey="ott" title="OTT" disableCentralViewOnTap={true}>
  {#snippet children({ device, sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color })}
    <!-- Read through the armed reader, never a local $state shadow: it
         holds the UI's value across the write→echo round trip. -->
    {@const amount =
      device === null
        ? AMOUNT_MIN
        : selectedTrackStore.paramValueArmed(
            selectedTrackStore.paramPath(device, AMOUNT_PARAM)
          ) ?? AMOUNT_MIN}
    <DeviceSlider
      value={amount}
      title="OTT"
      orientation="vertical"
      min={AMOUNT_MIN}
      max={AMOUNT_MAX}
      {isGhost}
      {color}
      onTap={handleTap}
      onInteraction={(value) => {
        if (isGhost || isLoading) {
          if (isGhost) triggerLoad();
          storePendingParam(AMOUNT_PARAM, value);
        } else {
          sendParam(AMOUNT_PARAM, value);
        }
      }}
    />
  {/snippet}
</BaseDeviceControl>
