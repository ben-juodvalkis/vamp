<script lang="ts">
  import type { ControlGlyphName } from './ControlGlyph.svelte';
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceXY from './DeviceXY.svelte';

  interface Props {
    device: DeviceRecord | null;
    // Marks for what the control does (the central view passes them).
    icon?: ControlGlyphName;
  }

  let { device, icon }: Props = $props();

  // Parameter configuration for Gate
  const PARAM_CONFIG = {
    release: {
      index: 4,
      min: 0,
      max: 1,
      type: 'float' as const
    },
    threshold: {
      index: 1,
      min: 0,
      max: 1,
      type: 'float' as const
    }
  };

  // Reactive view of armed/store state.
  let releaseValue = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.release.index)) ?? 0.5
      : 0.5
  );
  let thresholdValue = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.threshold.index)) ?? 0
      : 0
  );
</script>

<BaseDeviceControl slotKey="gate" {device} title="Gate" disableCentralViewOnTap={true} showMoveToTop={true} showMoveToEnd={true}>
  {#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color })}
    <DeviceXY
      xValue={releaseValue}
      yValue={thresholdValue}
      title="Gate"
      {icon}
      {isGhost}
      {color}
      showCurve={false}
      onTap={handleTap}
      onInteraction={(x, y) => {
        if (isGhost || isLoading) {
          // Trigger load on first ghost interaction
          if (isGhost) {
            triggerLoad();
          }
          // Store as pending - will be applied when device loads
          storePendingParam(PARAM_CONFIG.release.index, x);
          storePendingParam(PARAM_CONFIG.threshold.index, y);
        } else {
          // Device is active - send immediately
          sendParam(PARAM_CONFIG.release.index, x);
          sendParam(PARAM_CONFIG.threshold.index, y);
        }
      }}
    />
  {/snippet}
</BaseDeviceControl>
