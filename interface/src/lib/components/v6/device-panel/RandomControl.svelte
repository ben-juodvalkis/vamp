<script lang="ts">
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceSlider from './DeviceSlider.svelte';

  // Props accepted from FXGrid (device/position unused - RandomControl queries slot internally)
  interface Props {
    device?: DeviceRecord | null;
    position?: import('$lib/config/fxGridLayout').PositionKey;
  }

  let { device: _device, position: _position }: Props = $props();

  const PARAM_CONFIG = {
    amount: {
      index: 1,
      min: 0,
      max: 1,
      type: 'float' as const
    }
  };
</script>

<BaseDeviceControl slotKey="random" title="Random" showMoveToTop={true} showMoveToEnd={true}>
  {#snippet children({ device, sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
    {@const amountValue = device
      ? (selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.amount.index)) ?? 0)
      : 0}
    <DeviceSlider
      value={amountValue}
      title="Rand Oct"
      labelOrientation="horizontal"
      labelSize="small"
      {isGhost}
      {color}
      min={PARAM_CONFIG.amount.min}
      max={PARAM_CONFIG.amount.max}
      onTap={() => {
        openView();
      }}
      onInteraction={(value) => {
        openView();

        if (isGhost || isLoading) {
          if (isGhost) {
            triggerLoad();
          }
          storePendingParam(PARAM_CONFIG.amount.index, value);
        } else {
          sendParam(PARAM_CONFIG.amount.index, value);
        }
      }}
    />
  {/snippet}
</BaseDeviceControl>