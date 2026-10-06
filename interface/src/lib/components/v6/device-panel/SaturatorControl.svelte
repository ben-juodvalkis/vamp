<script lang="ts">
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceXY from './DeviceXY.svelte';

  interface Props {
    device: DeviceRecord | null;
    position?: import('$lib/config/fxGridLayout').PositionKey;
    /** Under a host that is already its view, a tap has nowhere to go. */
    disableCentralViewOnTap?: boolean;
  }

  let { device, position, disableCentralViewOnTap = false }: Props = $props();

  // Parameter configuration
  const PARAM_CONFIG = {
    drive: {
      index: 1,
      min: 0,
      max: 1,
      type: 'float' as const
    },
    hiAmount: {
      index: 8,  // Color Amount Hi
      min: 0,
      max: 1,
      type: 'float' as const
    },
    output: {
      index: 10,  // Output level
      min: 0.5,
      max: 1,
      type: 'float' as const
    },
    dryWet: {
      index: 11,  // Dry/Wet
      min: 0,
      max: 1,
      type: 'float' as const
    }
  };

  // Reactive view of armed/store state. Drive's stored range is
  // 0.5..1 (0dB..max); UI maps to 0..1.
  let driveValue = $derived.by(() => {
    if (!device) return 0;
    const raw = selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.drive.index)) ?? 0.5;
    return (raw - 0.5) / 0.5;
  });
  let bassHiBalance = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.hiAmount.index)) ?? 0.5
      : 0.5
  );
</script>

<!-- The fx5 grid tile again since 2026-10-05 (it was a column of
     PedalCentralView from 2026-09-10, ADR-431); the tile opens that view.
     `slotKey` stays for a standalone mount. -->
<BaseDeviceControl
  {...position ? { position } : { slotKey: 'saturator' as const }}
  {device}
  title="Saturator"
  {disableCentralViewOnTap}
  showMoveToTop={true}
  showMoveToEnd={true}
>
  {#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color })}
    <DeviceXY
      xValue={bassHiBalance}
      yValue={driveValue}
      title="Saturator"
      {isGhost}
      {color}
      onTap={handleTap}
      onInteraction={(x, y) => {
        // X axis controls treble (hi color) only — low end is left untouched.
        // x=0 (left) = no hi color (0), x=1 (right) = max hi color (1)
        const hiAmount = x;

        // Convert drive from 0-1 UI to 0.5-1 parameter (0dB to max)
        const driveParam = 0.5 + (y * 0.5);

        // Output: y=0 (bottom) → 1, y=1 (top) → 0.5
        const outputParam = 1 - (y * 0.5);

        // Dry/Wet: y=0 (bottom) → 0 (dry), y=1 (top) → 1 (wet)
        const dryWetParam = y;

        if (isGhost || isLoading) {
          // Trigger load on first ghost interaction
          if (isGhost) {
            triggerLoad();
          }
          // Store as pending - will be applied when device loads
          storePendingParam(PARAM_CONFIG.drive.index, driveParam);
          storePendingParam(PARAM_CONFIG.hiAmount.index, hiAmount);
          storePendingParam(PARAM_CONFIG.output.index, outputParam);
          storePendingParam(PARAM_CONFIG.dryWet.index, dryWetParam);
        } else {
          // Device is active - send immediately (cache updates optimistically)
          sendParam(PARAM_CONFIG.drive.index, driveParam);
          sendParam(PARAM_CONFIG.hiAmount.index, hiAmount);
          sendParam(PARAM_CONFIG.output.index, outputParam);
          sendParam(PARAM_CONFIG.dryWet.index, dryWetParam);
        }
      }}
    />
  {/snippet}
</BaseDeviceControl>