<script lang="ts">
  import type { ControlGlyphName } from './ControlGlyph.svelte';
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceSlider from './DeviceSlider.svelte';

  /**
   * Guitar Control — the Guitar.adg amp rack's Macro 1 (Gain), as one
   * slider.
   *
   * On AUDIO tracks it is a full-height FX grid column again, at the far
   * left (2026-09-15, the twelve-column refinement). On MIDI it is not on
   * the grid: it is mounted standalone inside `PedalCentralView`, beside
   * the Saturator that came back the same way (ADR-431). The two views are
   * the same distortion family, and the Pedal view is where a hand already
   * goes for drive.
   *
   * The rack's other macros live in `PedalCentralView` too since
   * 2026-10-05 (GuitarCentralView is gone): a tap on the grid column opens
   * that view, and the view's own mount sets `disableCentralViewOnTap`.
   *
   * No layout entry any more, so `slotKey` resolves its own `guitar` slot,
   * the way `SquashControl` and `BassControl` do. `position`
   * is still accepted so a future grid mount needs no change here.
   */
  interface Props {
    device?: DeviceRecord | null;
    position?: import('$lib/config/fxGridLayout').PositionKey;
    /** Inside the Pedal view a tap has nowhere to go: it is already home. */
    disableCentralViewOnTap?: boolean;
    // Marks for what the control does (the central views pass them; the
    // grid tile draws none).
    icon?: ControlGlyphName;
  }

  let { device = null, position, disableCentralViewOnTap = false, icon }: Props = $props();

  // Macro 1 rests at 0 — Guitar.adg stores Manual=0 for it, so an untouched or
  // not-yet-loaded device reads the floor, matching what the central view shows
  // for macros 2-8. The slider draws the ordinary coloured fill (user,
  // 2026-09-15): it had borrowed GAIN's split handle line, which made two of
  // the grid's tiles read in a grammar the rest of them don't. Gain cannot do
  // otherwise — its cell IS the track's meter (`track` on the DeviceSlider), so
  // the fill is spoken for and the line is the only way left to show where the
  // fader sits. A plain 0..127 drive has its fill free.
  const PARAM_CONFIG = {
    drive: {
      index: 1,
      min: 0,
      max: 127,
      rest: 0,
      type: 'int' as const
    }
  };

  // Reactive view of armed/store state.
  let driveValue = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.drive.index)) ??
          PARAM_CONFIG.drive.rest
      : PARAM_CONFIG.drive.rest
  );
</script>

<BaseDeviceControl
  {...position ? { position } : { slotKey: 'guitar' as const }}
  {device}
  title="Guitar"
  {disableCentralViewOnTap}
  showMoveToTop={true}
  showMoveToEnd={true}
>
  {#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
    <DeviceSlider
      value={driveValue}
      title="Gtr"
      {icon}
      labelOrientation="horizontal"
      labelSize="small"
      {isGhost}
      {color}
      min={PARAM_CONFIG.drive.min}
      max={PARAM_CONFIG.drive.max}
      onTap={handleTap}
      onInteraction={(value) => {
        // Update central display immediately on interaction
        openView();

        if (isGhost || isLoading) {
          // Trigger load on first ghost interaction
          if (isGhost) {
            triggerLoad();
          }
          // Store as pending - will be applied when device loads
          storePendingParam(PARAM_CONFIG.drive.index, value);
        } else {
          // Device is active - send immediately (cache updates optimistically)
          sendParam(PARAM_CONFIG.drive.index, value);
        }
      }}
    />
  {/snippet}
</BaseDeviceControl>