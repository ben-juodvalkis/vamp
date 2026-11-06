<script lang="ts">
  /**
   * A column of value boxes (ADR-477) on one effect's parameters, top to
   * bottom, for the effect views built on Live's own panels (2026-11-06:
   * Auto Pan-Tremolo, EQ Eight, Delay, Limiter, Phaser, Chorus). Each box
   * is a parameter by LOM index in its own range, its readout Live's label;
   * a ghost draws `rest`, and its first write loads the device.
   */
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import type { FxGridSlotHandle } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';

  export interface ParamBox {
    index: number;
    title: string;
    /** Live's value on a fresh insert, what a ghost shows. */
    rest: number;
    min?: number;
    max?: number;
    /** The neutral value the fill grows from (a ±% or ±dB parameter's 0). */
    center?: number;
  }

  interface Props {
    fx: FxGridSlotHandle;
    ink: DeviceColorScheme;
    boxes: readonly ParamBox[];
  }

  let { fx, ink, boxes }: Props = $props();
</script>

<div class="param-column" class:slot-ghost={fx.isGhost}>
  {#each boxes as box (box.index)}
    <DeviceSlider
      value={fx.paramValue(box.index) ?? box.rest}
      title={box.title}
      orientation="vertical"
      min={box.min ?? 0}
      max={box.max ?? 1}
      centerValue={box.center}
      isGhost={fx.isGhost}
      color={ink}
      readout={fx.paramDisplay(box.index)}
      onInteraction={(v) => fx.sendParam(box.index, v)}
    />
  {/each}
</div>

<style>
  .param-column {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    min-width: 0;
    min-height: 0;
  }

  .param-column > :global(*) {
    flex: 1 1 0;
    min-height: 0;
  }
</style>
