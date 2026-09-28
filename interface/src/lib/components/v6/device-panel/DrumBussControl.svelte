<script lang="ts">
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceXY from './DeviceXY.svelte';

  /**
   * DrumBussControl — the Drum Buss as an FX-grid tile (2026-09-10).
   *
   * One pad: transients across (−1..1 stored, drawn 0..1), dry/wet up —
   * the same two parameters the Drum XY had on the instrument-view rail
   * (ADR-424), which this tile replaces. It took the Saturator's tile;
   * the Saturator went back into the Pedal view. Tapping opens
   * DrumBussCentralView (Boom XY + the Comp switch). `position` is what
   * the FX grid hands it, `slotKey` the fallback for a standalone host.
   */

  interface Props {
    device: DeviceRecord | null;
    position?: import('$lib/config/fxGridLayout').PositionKey;
  }

  let { device, position }: Props = $props();

  // Indices measured off the running Drum Buss (the rail carried the same).
  const PARAM_CONFIG = {
    transients: { index: 6, min: -1, max: 1 },
    dryWet: { index: 13, min: 0, max: 1 }
  };

  let transients = $derived.by(() => {
    if (!device) return 0.5;
    const raw = selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.transients.index)) ?? 0;
    return (raw - PARAM_CONFIG.transients.min) / (PARAM_CONFIG.transients.max - PARAM_CONFIG.transients.min);
  });
  let dryWet = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.dryWet.index)) ?? 0
      : 0
  );
</script>

<BaseDeviceControl
  {...position ? { position } : { slotKey: 'drum' as const }}
  {device}
  title="Drum"
  showMoveToTop={true}
  showMoveToEnd={true}
>
  {#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
    <DeviceXY
      xValue={transients}
      yValue={dryWet}
      title="Drum"
      {isGhost}
      {color}
      showCurve={false}
      onTap={handleTap}
      onInteraction={(x, y) => {
        // The view follows the gesture; a no-op once it is up.
        openView();
        const actualTransients = x * (PARAM_CONFIG.transients.max - PARAM_CONFIG.transients.min) + PARAM_CONFIG.transients.min;
        if (isGhost || isLoading) {
          if (isGhost) triggerLoad();
          storePendingParam(PARAM_CONFIG.transients.index, actualTransients);
          storePendingParam(PARAM_CONFIG.dryWet.index, y);
        } else {
          sendParam(PARAM_CONFIG.transients.index, actualTransients);
          sendParam(PARAM_CONFIG.dryWet.index, y);
        }
      }}
    />
  {/snippet}
</BaseDeviceControl>
