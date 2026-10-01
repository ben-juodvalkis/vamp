<script lang="ts">
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceXY from './DeviceXY.svelte';
  import {
    AUTO_PAN,
    syncRateLabel,
    frequencyLabel,
    tileSyncStep,
    tileFrequency,
    tileXForSyncRate,
    tileXForFrequency,
    tileAmount,
    tileYFor
  } from './autoPanParams';

  // The Tremolo slot is Auto Pan Legacy (2026-10-01). X is rate — four
  // synced steps or free up to 10 Hz, whichever LFO Type is on — and Y is
  // amount folded about the middle, the lower half inverted.

  interface Props {
    device: DeviceRecord | null;
    position: import('$lib/config/fxGridLayout').PositionKey;
  }

  let { device, position }: Props = $props();

  function read(index: number): number | undefined {
    return device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, index)) : undefined;
  }

  let isSynced = $derived((read(AUTO_PAN.lfoType) ?? 1) >= 0.5);
  let syncRate = $derived(read(AUTO_PAN.syncRate) ?? 6);
  let frequency = $derived(read(AUTO_PAN.frequency) ?? 0.5);
  let inverted = $derived((read(AUTO_PAN.invert) ?? 0) >= 0.5);

  let xValue = $derived(isSynced ? tileXForSyncRate(syncRate) : tileXForFrequency(frequency));
  let yValue = $derived(device ? tileYFor(read(AUTO_PAN.amount) ?? 0, inverted) : 0.5);
  let rateLabel = $derived(isSynced ? syncRateLabel(syncRate) : frequencyLabel(frequency));
</script>

<BaseDeviceControl {position} {device} title="Auto Pan" showMoveToTop={true} showMoveToEnd={true}>
  {#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
    <DeviceXY
      {xValue}
      {yValue}
      title="Auto Pan"
      {rateLabel}
      {isGhost}
      {color}
      onTap={handleTap}
      onInteraction={(x, y) => {
        openView();

        // X writes both rates, so flipping Sync keeps the hand's place.
        const { amount, invert } = tileAmount(y);
        const writes: [number, number][] = [
          [AUTO_PAN.syncRate, tileSyncStep(x)],
          [AUTO_PAN.frequency, tileFrequency(x)],
          [AUTO_PAN.amount, amount]
        ];
        // Invert only on its edge — a drag crosses many frames in one half.
        if (isGhost || isLoading || (invert === 1) !== inverted) writes.push([AUTO_PAN.invert, invert]);

        if (isGhost || isLoading) {
          if (isGhost) triggerLoad();
          for (const [i, v] of writes) storePendingParam(i, v);
        } else {
          for (const [i, v] of writes) sendParam(i, v);
        }
      }}
    />
  {/snippet}
</BaseDeviceControl>
