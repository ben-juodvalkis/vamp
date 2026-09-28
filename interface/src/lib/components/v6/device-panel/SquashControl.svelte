<script lang="ts">
  /**
   * SquashControl — one slider over the Glue Compressor's threshold + makeup,
   * a full-height FX grid column beside Gain since 2026-09-15 (it rode the
   * top half of the Gain column from 2026-09-10, ADR-431 addendum). It used to be a lane
   * of the Gain / Utility view and, for a week, the foot of the Drum Buss
   * rail; both of those doorways are gone and this tile is the one. It has
   * no layout entry: `slotKey` resolves its own `squash` slot.
   *
   * Indices and rails are measured off the .adv artifact (gzipped XML), not
   * the device docs: the preset's element order IS the LOM parameter order
   * with Device On at 0, and every param carries its own MidiControllerRange.
   *   1 = Threshold, rail  0 dB → -40 dB
   *   3 = Makeup,    rail  0 dB → +20 dB
   * (data/device-configs/GlueCompressor.json disagrees — it lists doc-order
   * indices with no Device On. The artifact wins.)
   *
   * One finger drives both: harder squash means a lower threshold AND the
   * makeup gain that pays the level back, so the slider is a normalized
   * 0..1 "amount" and the two params are derived from it. Read back off the
   * threshold (the param that always moves) so the slider still tracks the
   * device when Live changes it from elsewhere.
   */

  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceSlider from './DeviceSlider.svelte';

  interface Props {
    device: DeviceRecord | null;
    position?: import('$lib/config/fxGridLayout').PositionKey;
  }

  let { device, position }: Props = $props();

  const SQUASH_THRESHOLD_PARAM = 1;
  const SQUASH_THRESHOLD_AT_FULL = -40;
  const SQUASH_MAKEUP_PARAM = 3;
  const SQUASH_MAKEUP_AT_FULL = 20;

  let squashAmount = $derived.by(() => {
    if (!device) return 0;
    const threshold = selectedTrackStore.paramValueArmed(
      selectedTrackStore.paramPath(device, SQUASH_THRESHOLD_PARAM)
    );
    if (threshold === undefined) return 0;
    return Math.min(1, Math.max(0, threshold / SQUASH_THRESHOLD_AT_FULL));
  });
</script>

<BaseDeviceControl
  {...position ? { position } : { slotKey: 'squash' as const }}
  {device}
  title="Squash"
  showMoveToTop={true}
  showMoveToEnd={true}
>
  {#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
    <DeviceSlider
      value={squashAmount}
      title="Squash"
      orientation="vertical"
      min={0}
      max={1}
      {isGhost}
      {color}
      onTap={handleTap}
      onInteraction={(amount) => {
        // The view follows the gesture; a no-op once it is up.
        openView();
        const threshold = amount * SQUASH_THRESHOLD_AT_FULL;
        const makeup = amount * SQUASH_MAKEUP_AT_FULL;
        if (isGhost || isLoading) {
          if (isGhost) triggerLoad();
          storePendingParam(SQUASH_THRESHOLD_PARAM, threshold);
          storePendingParam(SQUASH_MAKEUP_PARAM, makeup);
        } else {
          sendParam(SQUASH_THRESHOLD_PARAM, threshold);
          sendParam(SQUASH_MAKEUP_PARAM, makeup);
        }
      }}
    />
  {/snippet}
</BaseDeviceControl>
