<script lang="ts">
  /**
   * The Saturator's view (the `saturator` slot, the Drive tile). Its own
   * file since the FX chain overview took over from the grid (2026-10-26);
   * it was the `effects` part of the Pedal view, beside the Shifter and
   * Redux, which have views of their own now.
   *
   * Color Hi, Output and Mix, three value boxes side by side (ADR-477).
   * Indices match the tile's PARAM_CONFIG (8 / 10 / 11); 10 was confirmed
   * as Output against the running device (2026-08-22). Nothing is
   * remapped: what a fader shows is what the device stores. Drive (1) has
   * no fader: it is the tile's, which the chain cell carries.
   *
   * NO {#if device} gate - always renders, handles its own state.
   */

  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';

  const saturator = useFxGridSlot('saturator');

  let saturatorInk = $derived({
    primary: trackInk(saturator.color.primary, paintModeReactive()),
    secondary: saturator.color.secondary,
    accent: trackInk(saturator.color.accent, paintModeReactive())
  });

  // Index, label, and the value a fader rests at before the device answers.
  const SATURATOR_FADERS = [
    { index: 8, title: 'Color', fallback: 0.5, icon: 'tone' },
    { index: 10, title: 'Output', fallback: 1, icon: 'output' },
    { index: 11, title: 'Mix', fallback: 1, icon: 'mix' }
  ] as const;
</script>

<div class="saturator-layout" data-view="saturator">
  {#each SATURATOR_FADERS as fader (fader.index)}
    <div class="slider-col" class:slot-ghost={saturator.isGhost}>
      <DeviceSlider
        value={saturator.paramValue(fader.index) ?? fader.fallback}
        title={fader.title}
        icon={fader.icon}
        orientation="vertical"
        isGhost={saturator.isGhost}
        color={saturatorInk}
        readout={saturator.paramDisplay(fader.index)}
        min={0}
        max={1}
        onTap={() => saturator.loadIfGhost()}
        onInteraction={(v) => saturator.sendParam(fader.index, v)}
      />
    </div>
  {/each}
</div>

<style>
  .saturator-layout {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  .slider-col {
    min-width: 0;
    min-height: 0;
  }
</style>
