<script lang="ts">
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceSlider from './DeviceSlider.svelte';

  interface Props {
    device: DeviceRecord | null;
    position: import('$lib/config/fxGridLayout').PositionKey;
  }

  let { device, position }: Props = $props();

  const PARAM_CONFIG = {
    chance: {
      index: 1,
      min: 0,
      max: 1,
      type: 'float' as const
    }
  };

  // Reactive view of armed/store state.
  let chanceValue = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.chance.index)) ?? 0
      : 0
  );
</script>

<BaseDeviceControl {position} {device} title="Variation" showMoveToTop={true} showMoveToEnd={true}>
  {#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
    <DeviceSlider
      value={chanceValue}
      title="Var"
      labelOrientation="horizontal"
      labelSize="small"
      {isGhost}
      {color}
      min={PARAM_CONFIG.chance.min}
      max={PARAM_CONFIG.chance.max}
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
          storePendingParam(PARAM_CONFIG.chance.index, value);
        } else {
          // Device is active - send immediately (cache updates optimistically)
          sendParam(PARAM_CONFIG.chance.index, value);
        }
      }}
    />
  {/snippet}
</BaseDeviceControl>
