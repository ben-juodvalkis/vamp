<script lang="ts">
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import ToneCurvePad from './ToneCurvePad.svelte';

  interface Props {
    device: DeviceRecord | null;
    position: import('$lib/config/fxGridLayout').PositionKey;
  }

  let { device, position }: Props = $props();

  // Parameter configuration from device-configs.json
  const PARAM_CONFIG = {
    lowGain: {
      index: 2,
      min: 0,
      max: 1,
      type: 'float' as const
    },
    highGain: {
      index: 5,
      min: 0,
      max: 1,
      type: 'float' as const
    },
    midGain: {
      index: 3,
      min: 0,
      max: 1,
      type: 'float' as const
    },
    midFreq: {
      index: 4,
      min: 0,
      max: 1,
      type: 'float' as const
    }
  };

  // Reactive view of armed/store state. Drag handlers route through
  // sendParam/storePendingParam below; the arm in setParamValue keeps
  // the visual consistent during the round-trip.
  let lowGainValue = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.lowGain.index)) ?? 0.5
      : 0.5
  );
  let highGainValue = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.highGain.index)) ?? 0.5
      : 0.5
  );
  let midGainValue = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.midGain.index)) ?? 0.5
      : 0.5
  );
  let midFreqValue = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.midFreq.index)) ?? 0.53
      : 0.625
  );

</script>


<BaseDeviceControl {position} {device} title="EQ" showMoveToTop={true} showMoveToEnd={true}>
  {#snippet children({ sendParam, storePendingParam, triggerLoad, isGhost, isLoading, color, openView })}
    <!-- The pad is shared with the Pedal view's tone stack. Tap only
         previews the central view — it does NOT load the device (ADR-167);
         the first intentional drag does. -->
    {@const write = (index: number, value: number) => {
      if (isGhost || isLoading) {
        if (isGhost && !isLoading) triggerLoad();
        storePendingParam(index, value);
      } else if (device) {
        sendParam(index, value);
      }
    }}
    <ToneCurvePad
      title="EQ"
      ariaLabel="EQ — open the EQ view"
      low={lowGainValue}
      mid={midGainValue}
      midFreq={midFreqValue}
      high={highGainValue}
      {isGhost}
      {color}
      onTap={openView}
      onLow={(v) => write(PARAM_CONFIG.lowGain.index, v)}
      onHigh={(v) => write(PARAM_CONFIG.highGain.index, v)}
      onMid={(x, y) => {
        write(PARAM_CONFIG.midFreq.index, x);
        write(PARAM_CONFIG.midGain.index, y);
      }}
    />
  {/snippet}
</BaseDeviceControl>
