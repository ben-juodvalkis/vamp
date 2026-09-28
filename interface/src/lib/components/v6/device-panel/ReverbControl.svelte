<script lang="ts">
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceXY from './DeviceXY.svelte';

  interface Props {
    device: DeviceRecord | null;
    position: import('$lib/config/fxGridLayout').PositionKey;
  }

  let { device, position }: Props = $props();

  let devicePath = $derived((device as any)?.devicePath);

  const PARAM_CONFIG = {
    decayTime: {
      index: 10,
      min: 0,
      max: 1,
      type: 'float' as const
    },
    dryWet: {
      index: 53,
      min: 0,
      max: 1,
      type: 'float' as const
    }
  };

  // Reactive view of armed/store state.
  let decayTimeValue = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.decayTime.index)) ?? 0.5
      : 0.5
  );
  let dryWetValue = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.dryWet.index)) ?? 0
      : 0
  );

  // Convert 0-1 slider value to IR size factor range (0.2 to 5, with 1.0 at halfway)
  function mapToIRSizeFactor(sliderValue: number): number {
    // Clamp input to 0-1 range
    const clamped = Math.max(0, Math.min(1, sliderValue));
    
    if (clamped <= 0.5) {
      // Map 0-0.5 slider to 0.2-1.0 IR size factor
      return 0.2 + (clamped * 2) * (1.0 - 0.2);
    } else {
      // Map 0.5-1.0 slider to 1.0-5.0 IR size factor  
      return 1.0 + ((clamped - 0.5) * 2) * (5.0 - 1.0);
    }
  }
</script>

<BaseDeviceControl {position} {device} title="Reverb" showMoveToTop={true} showMoveToEnd={true}>
  {#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
    <DeviceXY
      xValue={decayTimeValue}
      yValue={dryWetValue}
      title="Reverb"
      {isGhost}
      {color}
      onTap={handleTap}
      onInteraction={(x, y) => {
        // Update central display immediately on interaction
        openView();

        if (isGhost || isLoading) {
          // Trigger load on first ghost interaction
          if (isGhost) {
            triggerLoad();
          }
          // Store as pending - will be applied when device loads
          storePendingParam(PARAM_CONFIG.decayTime.index, x);
          storePendingParam(PARAM_CONFIG.dryWet.index, y);
        } else {
          // Device is active - send immediately during drag (cache updates optimistically)
          sendParam(PARAM_CONFIG.decayTime.index, x);
          sendParam(PARAM_CONFIG.dryWet.index, y);
        }
      }}
      onRelease={(x, y) => {
        if (devicePath && !isGhost && !isLoading) {
          const irSizeFactorValue = mapToIRSizeFactor(x);
          selectedTrackStore.setPropertyValue(devicePath, 'ir_size_factor', irSizeFactorValue);
        }
      }}
    />
  {/snippet}
</BaseDeviceControl>
