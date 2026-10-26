<script lang="ts">
  import { controlFor, resolveParam, type ParamRef, type SliderControl } from './deviceControls';
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { slotRegistry } from '$lib/stores/v6/slotRegistry.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { v3Store } from '$lib/stores/v3/normalized.svelte';
  import { meterStore } from '$lib/stores/v3/meters.svelte';
  import { TRACK_DEFAULTS } from '$lib/components/v6/tracks/TrackStrip/utils/trackConstants';
  import { rgbToHex } from '$lib/utils/formatters/trackFormatters';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceSlider from './DeviceSlider.svelte';

  interface Props {
    device: DeviceRecord | null;
    position: import('$lib/config/fxGridLayout').PositionKey;
  }

  let { device, position }: Props = $props();

  // The `utility` control (`deviceControls`): Gain on 0..1, drawn over the track's meter.
  const UTILITY = controlFor('utility') as SliderControl;
  const get = (ref: ParamRef) =>
    device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, resolveParam(ref))) : undefined;

  // Reactive view of armed/store state.
  let widthValue = $derived(UTILITY.read(get));

  // ===== TRACK METER =====
  // ROW 6.5 (2026-04-21): DeviceSlider's optional meter display now reads
  // directly from the v3 meter store + normalized track record. The legacy
  // `useMaxTrackObserver` CustomEvent bus retired with the T-record volume
  // migration; this component's MutableTrackState mirror is gone.
  interface MeterTrack {
    meterLevel: number;
    mute: boolean;
  }

  let selectedTrackIndex = $derived(session.selectedTrackIndex);

  const trackRecord = $derived(
    selectedTrackIndex >= 0
      ? v3Store.tracks.get(`tracks/${selectedTrackIndex}`)
      : undefined
  );
  const meterRecord = $derived(
    selectedTrackIndex >= 0
      ? meterStore.get(`tracks/${selectedTrackIndex}`)
      : undefined
  );

  const track: MeterTrack | null = $derived.by(() => {
    if (selectedTrackIndex < 0) return null;
    return {
      meterLevel: meterRecord?.left ?? 0,
      mute: trackRecord?.mute ?? TRACK_DEFAULTS.mute
    };
  });

  const trackColor = $derived(
    selectedTrackIndex >= 0 ? rgbToHex(trackRecord?.color ?? TRACK_DEFAULTS.color) : undefined
  );
</script>

<BaseDeviceControl {position} {device} title="Utility" showMoveToTop={true} showMoveToEnd={true}>
  {#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color, openView })}
    <!-- `color` is the chokepoint scheme: the focused track's ink for this
         trackTint device (ADR-400), grey utility family when no track. -->
    <DeviceSlider
      value={widthValue}
      title="Gain"
      labelOrientation="horizontal"
      labelSize="small"
      {isGhost}
      {color}
      min={0}
      max={1}
      track={selectedTrackIndex >= 0 ? track : null}
      trackIndex={selectedTrackIndex}
      meterColor={trackColor}
      onTap={() => {
        // Update central display (follows standard pattern)
        openView();
        handleTap();
      }}
      onInteraction={(value) => {
        // Update central display
        openView();

        if (isGhost || isLoading) {
          // Trigger load on first ghost interaction
          if (isGhost) {
            triggerLoad();
          }
          // Store as pending - will be applied when device loads
          for (const [ref, v] of UTILITY.write(value, get)) storePendingParam(resolveParam(ref), v);
        } else {
          // Device is active - send immediately (cache updates optimistically)
          for (const [ref, v] of UTILITY.write(value, get)) sendParam(resolveParam(ref), v);
        }
      }}
    />
  {/snippet}
</BaseDeviceControl>