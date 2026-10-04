<script lang="ts">
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceSlider from './DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { useBassChainPosition } from '$lib/components/v6/central/useBassChainPosition.svelte';

  /**
   * Bass Control — the bottom half of the fx1 column on AUDIO tracks.
   *
   * The column is split on audio the way it is on MIDI (2026-09-14, user's
   * call): `ClipPitchControl` on top where the instrument slider sits,
   * this where Rand Oct does. Audio used to get a single full-height pitch
   * slider because the MIDI pair had nothing to drive there; the bottom
   * half is worth a control again because the Bass has the opposite
   * problem — it is the one device on the grid that is *only* useful on
   * audio (`fxGridStore.loadDevice` renames the track "Bass" on an audio
   * track and leaves a MIDI track's name alone).
   *
   * The device is the `bass` slot — the `Bass Amp.adg` rack — whose other
   * face is the Bass panel in `GuitarCentralView` (the same fader). Param 1
   * is the rack's one visible macro, the mix, rail 0..127, resting at 0 so
   * the tile reads empty until it is reached for. The tile names the DEVICE
   * the way every other tile does (Gtr, Drum, Squash).
   *
   * It has no `fxGridLayout` entry — `slotKey` resolves its own slot, like
   * `SquashControl` and `OttControl` — and `FXGrid` mounts it behind
   * `isAudioTrack`, so no other track reaches it.
   *
   * A tap opens `GuitarCentralView`, which the registry aliases to `bass`
   * for exactly this reason: an unregistered type resolves to the
   * placeholder view (the defect a830a7a fixed for `random` and the
   * 2026-09-12 review caught on `ott`).
   */

  // Accepted for API symmetry with the other tiles; the slot is the
  // canonical source, as in RandomControl.
  interface Props {
    device?: DeviceRecord | null;
    position?: import('$lib/config/fxGridLayout').PositionKey;
  }

  let { device: _device, position: _position }: Props = $props();

  const MIX_PARAM = 1;
  const MIX_MIN = 0;
  const MIX_MAX = 127;
  /**
   * The floor, like every other fill tile on this grid (user, 2026-09-15).
   * It shipped at the top — what the Bass preset itself stores — which as an
   * ordinary coloured fill painted the whole cell solid orange at rest: a
   * lit state rather than a value at the top of its rail. Resting at 0
   * instead keeps the fill honest, and the tile reads empty until the
   * mix is reached for. Note this is only the cold read; once the
   * slot has a device the slider shows whatever Live actually has.
   */
  const MIX_REST = 0;

  const bass = useFxGridSlot('bass');
  const chain = useBassChainPosition(bass, 'BassControl');

  let mixValue = $derived(bass.paramValue(MIX_PARAM) ?? MIX_REST);
</script>

<BaseDeviceControl slotKey="bass" title="Bass" showMoveToTop={true} showMoveToEnd={true}>
  {#snippet children({ handleTap, isGhost, color, openView })}
    <DeviceSlider
      value={mixValue}
      title="Bass"
      labelOrientation="horizontal"
      labelSize="small"
      {isGhost}
      {color}
      min={MIX_MIN}
      max={MIX_MAX}
      onTap={handleTap}
      onInteraction={(value) => {
        // The view follows the gesture; a no-op once it is up.
        openView();
        // Arm BEFORE the write: `sendParam` is what triggers the load off a
        // ghost slot, and `arm` reads the ghost state to decide. A tap does
        // not arm — it loads nothing (ADR-167: a tile loads on its first
        // drag frame), so a latch set there would never be spent.
        chain.arm();
        bass.sendParam(MIX_PARAM, value);
      }}
    />
  {/snippet}
</BaseDeviceControl>
