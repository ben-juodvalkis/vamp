<script lang="ts">
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceXY from './DeviceXY.svelte';
  import type { CurveType } from './FilterCurve.svelte';

  interface Props {
    device: DeviceRecord | null;
    position: import('$lib/config/fxGridLayout').PositionKey;
  }

  let { device, position }: Props = $props();

  // Filter type mapping (param 4: 0-9)
  const FILTER_TYPE_CURVES: CurveType[] = [
    'lowpass',   // 0: Low-pass
    'highpass',  // 1: High-pass
    'bandpass',  // 2: Band-pass
    'notch',     // 3: Notch
    'lowpass',   // 4: Morph (use lowpass visual)
    'lowpass',   // 5: DJ (use lowpass visual)
    'bandpass',  // 6: Vowel (bandpass-like)
    'peak',      // 7: Comb
    'lowpass',   // 8: Resampling (lowpass-like)
    'lowpass'    // 9: SV (State Variable, lowpass-like)
  ];

  // Single source of truth: paramValueArmed reads the UI-armed value
  // during a drag's round-trip window, falling back to the v3 store
  // (which carries pre-load speculative seeds + post-load surface
  // values). No component-local $state shadow, no untrack() — the
  // store is authoritative and reactive. Pre-load gestures land in
  // the store via the FX-grid new-device hook (paramArming.svelte);
  // mid-drag echoes are suppressed by the arm in setParamValue.
  let cutoffValue = $derived(
    device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 1)) ?? 1 : 1
  );
  let resonanceValue = $derived(
    device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 2)) ?? 0 : 0
  );
  let filterType = $derived(
    device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 4)) ?? 0 : 0
  );
  let curveType = $derived(FILTER_TYPE_CURVES[Math.round(filterType)] || 'lowpass');
</script>

<BaseDeviceControl {position} {device} title="AutoFilter" showMoveToTop={true}>
  {#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
    <DeviceXY
      xValue={cutoffValue}
      yValue={resonanceValue}
      title="Filter"
      {isGhost}
      {color}
      showCurve={curveType !== 'none'}
      {curveType}
      onTap={handleTap}
      onInteraction={(x, y) => {
        // Always update central display immediately on interaction
        openView();

        if (isGhost || isLoading) {
          // Trigger load on first ghost interaction
          if (isGhost) {
            triggerLoad();
          }
          // Store as pending - will be applied when device loads
          storePendingParam(1, x); // Cutoff
          storePendingParam(2, y); // Resonance
        } else {
          // Device is active - send to Ableton
          sendParam(1, x); // Cutoff - parameter 1
          sendParam(2, y); // Resonance - parameter 2
        }
      }}
    />
  {/snippet}
</BaseDeviceControl>