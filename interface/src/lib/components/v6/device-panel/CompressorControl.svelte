<script lang="ts">
  import type { ControlGlyphName } from './ControlGlyph.svelte';
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceSlider from './DeviceSlider.svelte';

  interface Props {
    device: DeviceRecord | null;
    // Marks for what the control does (the central view passes them).
    icon?: ControlGlyphName;
  }

  let { device, icon }: Props = $props();

  // Parameter configuration from device-configs.json
  // Compressor2 only has threshold defined
  const PARAM_CONFIG = {
    threshold: {
      index: 1,
      min: 0,
      max: 1,
      type: 'float' as const
    }
  };

  // Reactive view of armed/store state. The store is the single source
  // of truth for visual position; the FX-grid new-device hook seeds
  // pre-load gestures and the arm in setParamValue suppresses lossy
  // round-trip echoes during a drag.
  let thresholdValue = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.threshold.index)) ?? 1
      : 1
  );
</script>

<BaseDeviceControl slotKey="compressor" {device} title="Compressor" disableCentralViewOnTap={true} showMoveToTop={true} showMoveToEnd={true}>
  {#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color })}
    <DeviceSlider
      value={thresholdValue}
      title="Comp"
      {icon}
      labelOrientation="horizontal"
      labelSize="small"
      {isGhost}
      {color}
      min={PARAM_CONFIG.threshold.min}
      max={PARAM_CONFIG.threshold.max}
      onTap={handleTap}
      onInteraction={(value) => {
        if (isGhost || isLoading) {
          // Trigger load on first ghost interaction
          if (isGhost) {
            triggerLoad();
          }
          // Store as pending - will be applied when device loads
          storePendingParam(PARAM_CONFIG.threshold.index, value);
        } else {
          // Device is active - send immediately and update cache optimistically
          sendParam(PARAM_CONFIG.threshold.index, value);
        }
      }}
    />
  {/snippet}
</BaseDeviceControl>
