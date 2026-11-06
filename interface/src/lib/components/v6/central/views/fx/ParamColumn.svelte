<script lang="ts">
  /**
   * A column of value boxes (ADR-477), or knobs (ADR-509), on one effect's parameters, top to
   * bottom, for the effect views built on Live's own panels (2026-11-06:
   * Auto Pan-Tremolo, EQ Eight, Delay, Limiter, Phaser, Chorus). Each box
   * is a parameter by LOM index in its own range, its readout Live's label;
   * a ghost draws `rest`, and its first write loads the device.
   */
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import KnobGrid from '$lib/components/v6/device-panel/KnobGrid.svelte';
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
    /**
     * Knobs (ADR-509) for a column of tone and motion, in the grid that
     * gives each the most room; boxes, the default, for a column of levels.
     */
    face?: 'slider' | 'knob';
  }

  let { fx, ink, boxes, face = 'slider' }: Props = $props();
</script>

{#snippet control(box: ParamBox)}
  <DeviceSlider
    value={fx.paramValue(box.index) ?? box.rest}
    title={box.title}
    {face}
    orientation="vertical"
    min={box.min ?? 0}
    max={box.max ?? 1}
    centerOrigin={face === 'knob' && box.center !== undefined}
    centerValue={box.center}
    isGhost={fx.isGhost}
    color={ink}
    readout={fx.paramDisplay(box.index)}
    onInteraction={(v) => fx.sendParam(box.index, v)}
  />
{/snippet}

{#if face === 'knob'}
  <div class="param-column param-knobs" class:slot-ghost={fx.isGhost}>
    <KnobGrid count={boxes.length}>
      {#snippet item(i)}{@render control(boxes[i])}{/snippet}
    </KnobGrid>
  </div>
{:else}
  <div class="param-column" class:slot-ghost={fx.isGhost}>
    {#each boxes as box (box.index)}
      {@render control(box)}
    {/each}
  </div>
{/if}

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
