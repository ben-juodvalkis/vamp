<script lang="ts">
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { session } from '$lib/stores/session.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceXY from './DeviceXY.svelte';
  import ReverbPortrait from '../central/views/reverb/ReverbPortrait.svelte';
  import ReverbIrDisplay from '../central/views/reverb/ReverbIrDisplay.svelte';
  import { reverbTail, decayAtTailX } from '../central/views/reverb/reverbTail';
  import { useReverbIrPicture } from '../central/views/reverb/useReverbIrPicture.svelte';
  import { HYBRID, LIVE_DEFAULTS, ROUTING_CONVOLUTION } from './hybridReverbParams';
  import { controlFor, resolveParam, type ParamRef, type XyControl } from './deviceControls';

  interface Props {
    device: DeviceRecord | null;
    position: import('$lib/config/fxGridLayout').PositionKey;
  }

  let { device, position }: Props = $props();

  let devicePath = $derived((device as any)?.devicePath);

  // The `reverb` control (`deviceControls`): Decay across, Dry/Wet up. The
  // portrait below places the same Decay on the tail's time axis.
  const REVERB = controlFor('reverb') as XyControl;
  const get = (ref: ParamRef) =>
    device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, resolveParam(ref))) : undefined;

  // Reactive view of armed/store state.
  let at = $derived(REVERB.read(get));
  let decayTimeValue = $derived(at.x);
  let dryWetValue = $derived(at.y);

  /** A parameter's raw value, or Live's default before the device answers. */
  function raw(index: number): number {
    return (device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, index)) : undefined) ?? LIVE_DEFAULTS[index] ?? 0;
  }

  // What the reverb sounds like, drawn behind the pad once there is one
  // (ADR-477; the Reverb view's own pictures until then): an algorithm's
  // tail, whose X is where the tail ends, so the handle rides its decay mark;
  // an IR's waveform, under the pad's own axes. An empty slot keeps the
  // plain pad.
  let runsIr = $derived(!!device && raw(HYBRID.routing) === ROUTING_CONVOLUTION);
  let tail = $derived(device && !runsIr ? reverbTail(raw, session.tempo) : null);
  const irPicture = useReverbIrPicture(() => devicePath, () => runsIr);

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
    {#if tail && !isGhost && !isLoading}
      {@const onset = tail.input.onset}
      <ReverbPortrait
        input={tail.input}
        crossoverLabel={tail.crossoverLabel}
        compact
        title="Reverb"
        {color}
        onTap={handleTap}
        onMove={(x, y) => {
          openView();
          for (const [ref, value] of REVERB.write(decayAtTailX(x, onset), y, get)) sendParam(resolveParam(ref), value);
        }}
        onRelease={(x) => {
          if (devicePath) {
            selectedTrackStore.setPropertyValue(devicePath, 'ir_size_factor', mapToIRSizeFactor(decayAtTailX(x, onset)));
          }
        }}
      />
    {:else}
    {#snippet irBackground()}
      <ReverbIrDisplay
        wave={irPicture.wave}
        status={irPicture.status}
        category={irPicture.category}
        attack={irPicture.attack}
        decay={irPicture.decay}
        size={irPicture.size}
        shaping={irPicture.shaping}
        {color}
        compact
      />
    {/snippet}
    <DeviceXY
      xValue={decayTimeValue}
      yValue={dryWetValue}
      title="Reverb"
      {isGhost}
      {color}
      background={runsIr && !isGhost && !isLoading ? irBackground : undefined}
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
          for (const [ref, value] of REVERB.write(x, y, get)) storePendingParam(resolveParam(ref), value);
        } else {
          // Device is active - send immediately during drag (cache updates optimistically)
          for (const [ref, value] of REVERB.write(x, y, get)) sendParam(resolveParam(ref), value);
        }
      }}
      onRelease={(x, y) => {
        if (devicePath && !isGhost && !isLoading) {
          const irSizeFactorValue = mapToIRSizeFactor(x);
          selectedTrackStore.setPropertyValue(devicePath, 'ir_size_factor', irSizeFactorValue);
        }
      }}
    />
    {/if}
  {/snippet}
</BaseDeviceControl>
