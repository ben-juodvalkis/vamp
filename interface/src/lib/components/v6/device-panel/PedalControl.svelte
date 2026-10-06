<script lang="ts">
  import type { Component } from 'svelte';
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceXY from './DeviceXY.svelte';

  interface Props {
    device: DeviceRecord | null;
    position?: import('$lib/config/fxGridLayout').PositionKey;
    /** Inside the Pedal view a tap has nowhere to go: it is already home. */
    disableCentralViewOnTap?: boolean;
    // Marks for what the control does (the central views pass them; the
    // grid tile draws none).
    icon?: Component<any>;
    xIcon?: Component<any>;
    yIcon?: Component<any>;
  }

  let { device, position, disableCentralViewOnTap = false, icon, xIcon, yIcon }: Props = $props();

  const PARAM_CONFIG = {
    type: {
      index: 1,
      min: 0,
      max: 2,
      type: 'int' as const
      // 0 = Drive, 1 = Distort, 2 = Fuzz (controlled in central view)
    },
    mid: {
      index: 6,
      min: -1,
      max: 1,
      type: 'float' as const
    },
    gain: {
      index: 2,
      min: 0,
      max: 1,
      type: 'float' as const
    },
    dryWet: {
      index: 9,
      min: 0,
      max: 1,
      type: 'float' as const
    }
  };

  // Reactive view of armed/store state. Mid is bipolar (-1..+1) but
  // displayed as 0..1 with 0.5 as the center.
  let midValue = $derived.by(() => {
    if (!device) return 0.5;
    const raw = selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.mid.index)) ?? 0;
    return (raw - PARAM_CONFIG.mid.min) / (PARAM_CONFIG.mid.max - PARAM_CONFIG.mid.min);
  });
  let gainDryWetValue = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.gain.index)) ?? 0
      : 0
  );
</script>

<!-- A column of PedalCentralView since 2026-10-05, when it traded places
     with the Saturator's grid tile. The view mounts it with `slotKey`;
     `position` stays for any grid host. -->
<BaseDeviceControl
  {...position ? { position } : { slotKey: 'pedal' as const }}
  {device}
  title="Pedal"
  {disableCentralViewOnTap}
  showMoveToTop={true}
  showMoveToEnd={true}
>
  {#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
    <DeviceXY
      xValue={midValue}
      yValue={gainDryWetValue}
      title="Pedal"
      {icon}
      {xIcon}
      {yIcon}
      {isGhost}
      {color}
      onTap={handleTap}
      onInteraction={(x, y) => {
        // Update central display immediately on interaction
        openView();

        // Denormalize mid from 0/1 to -1/+1
        const actualMid = x * (PARAM_CONFIG.mid.max - PARAM_CONFIG.mid.min) + PARAM_CONFIG.mid.min;

        if (isGhost || isLoading) {
          // Trigger load on first ghost interaction
          if (isGhost) {
            triggerLoad();
          }
          // Store as pending - will be applied when device loads
          storePendingParam(PARAM_CONFIG.mid.index, actualMid);
          storePendingParam(PARAM_CONFIG.gain.index, y);
          storePendingParam(PARAM_CONFIG.dryWet.index, y);
        } else {
          // Device is active - send immediately (cache updates optimistically)
          sendParam(PARAM_CONFIG.mid.index, actualMid);
          sendParam(PARAM_CONFIG.gain.index, y);
          sendParam(PARAM_CONFIG.dryWet.index, y);
        }
      }}
    />
  {/snippet}
</BaseDeviceControl>