<script lang="ts">
  import DeviceSlider from '../../../device-panel/DeviceSlider.svelte';
  import { press } from '$lib/actions';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';

  /**
   * PadMixerColumn — the held pads' own mixer strip (2026-09-29, user's
   * request: "a small chain mute and volume control" to the right of the
   * pads when one or more are selected). Drawn only while a pad is scoped.
   *
   * Dumb, like the rows: the scoped pad's values in, a write out. The
   * scope rule is `useDrumVm`'s — the volume moves the scoped pad to the
   * slider and every other held pad by the same delta; the mute lands the
   * scoped pad's opposite on every held pad, so a mixed selection comes
   * out all muted or all open. `volume` / `muted` are `undefined` until the
   * pad row is read, `null` when the pad has no chain.
   */

  interface Props {
    volume: number | null | undefined;
    muted: number | null | undefined;
    color: DeviceColorScheme;
    onVolume: (value: number) => void;
    onMute: (muted: number) => void;
  }

  let { volume, muted, color, onVolume, onMute }: Props = $props();

  let isMuted = $derived(typeof muted === 'number' && muted >= 0.5);
  let volumeGhost = $derived(volume === null);
  let muteGhost = $derived(muted === null);
</script>

<div class="pad-mixer" data-pad-muted={isMuted ? 'true' : undefined}>
  <button
    type="button"
    class="pad-mute physical-button"
    class:active={isMuted}
    class:pad-mute-none={muteGhost}
    style="--btn-tint: {color.primary};"
    aria-label="Mute pad"
    aria-pressed={isMuted}
    aria-disabled={muteGhost}
    use:press={{
      onPress: () => {
        if (!muteGhost) onMute(isMuted ? 0 : 1);
      },
      stopPropagation: true,
      touchAction: 'none'
    }}
  >M</button>
  <div class="pad-volume">
    <DeviceSlider
      value={volume ?? 0.85}
      labelOrientation="horizontal"
      title="Vol"
      icon="gain"
      {color}
      isGhost={volumeGhost}
      onInteraction={(value) => {
        if (!volumeGhost) onVolume(value);
      }}
    />
  </div>
</div>

<style>
  .pad-mixer {
    flex: 0 0 var(--pad-mixer-w, 44px);
    width: var(--pad-mixer-w, 44px);
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    min-height: 0;
  }
  .pad-mute {
    flex: 0 0 var(--height-touch, 44px);
    min-height: var(--height-touch, 44px);
    font-weight: var(--font-weight-medium);
  }
  .pad-mute-none {
    opacity: 0.35;
  }
  .pad-volume {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  /* A muted pad's level still moves, but reads as parked. */
  [data-pad-muted] .pad-volume {
    opacity: 0.5;
  }
</style>
