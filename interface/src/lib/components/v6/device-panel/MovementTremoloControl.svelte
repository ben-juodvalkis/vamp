<script lang="ts">
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceXY from './DeviceXY.svelte';
  import { DIVISION_LABELS } from '$lib/utils/movementWaveform';

  // Param indices for the native Tremolo plugin (AuPluginDevice:Tremolo).
  // Runtime LOM order; all plugin params report normalized 0..1 value/min/max.
  const PARAM = { rate: 1, sync: 2, shape: 3, division: 4, shapeModDiv: 5, amount: 6, randRange: 7, randRate: 8, shapeModDepth: 9 } as const;

  // rate param uses a JUCE log skew of 0.3 over 0.1..20 Hz.
  // norm x -> Hz: 0.1 + 19.9 * x^(1/0.3)
  const RATE_MIN_HZ = 0.1;
  const RATE_MAX_HZ = 20;
  const RATE_SKEW = 0.3;
  const normToHz = (x: number) => RATE_MIN_HZ + (RATE_MAX_HZ - RATE_MIN_HZ) * Math.pow(x, 1 / RATE_SKEW);

  interface Props {
    device: DeviceRecord | null;
    position: import('$lib/config/fxGridLayout').PositionKey;
  }

  let { device, position }: Props = $props();

  let syncMode = $derived(
    device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM.sync)) ?? 0 : 0
  );
  let isSynced = $derived(syncMode > 0.5);

  // X axis: normalized rate when free, normalized division when synced — both 0..1 already.
  let rateValue = $derived.by(() => {
    if (!device) return 0.5;
    const idx = isSynced ? PARAM.division : PARAM.rate;
    return selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, idx)) ?? 0.5;
  });

  // Y axis: normalized amount, 0..1 already.
  let amountValue = $derived(
    device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM.amount)) ?? 0.5 : 0.5
  );

  let currentRateLabel = $derived.by(() => {
    if (isSynced) {
      const division = Math.round(1 + rateValue * 15);
      return DIVISION_LABELS[division] ?? `${division}`;
    } else {
      return `${normToHz(rateValue).toFixed(1)} Hz`;
    }
  });
</script>

<BaseDeviceControl {position} {device} title="Tremolo" showMoveToTop={true} showMoveToEnd={true}>
  {#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
    <DeviceXY
      xValue={rateValue}
      yValue={amountValue}
      title="Tremolo"
      rateLabel={currentRateLabel}
      {isGhost}
      {color}
      onTap={handleTap}
      onInteraction={(x, y) => {
        openView();

        // Plugin params are normalized 0..1: X drives both rate and division
        // (active one depends on Sync), Y drives amount directly.
        if (isGhost || isLoading) {
          if (isGhost) triggerLoad();
          storePendingParam(PARAM.amount, y);
          storePendingParam(PARAM.rate, x);
          storePendingParam(PARAM.division, x);
        } else {
          sendParam(PARAM.amount, y);
          sendParam(PARAM.rate, x);
          sendParam(PARAM.division, x);
        }
      }}
    />
  {/snippet}
</BaseDeviceControl>
