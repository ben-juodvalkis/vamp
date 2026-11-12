<script lang="ts">
  /**
   * A rack's macros in its central view, laid out as Live's macro panel
   * (ADR-532): two rows numbered row by row, as many columns as half its
   * visible macros, each a knob where Live has it, one still named
   * "Macro N" drawn dim, as Live greys it. The same rule as the chain cell
   * (`liveMacroSlots`), so the two and Live agree.
   */
  import { selectedTrackStore, type DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceSlider from '../device-panel/DeviceSlider.svelte';
  import { glyphForName } from '$lib/config/controlGlyphMap';
  import { liveMacroSlots } from '$lib/utils/macroLayoutUtils';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';

  interface Props {
    rack: DeviceRecord;
    /** A macro's colours, by its place in the panel (row-major). */
    colorAt: (place: number) => DeviceColorScheme;
  }

  let { rack, colorAt }: Props = $props();

  const MACRO_MAX = 127;
  const VISIBLE_MACROS = 'visible_macro_count';

  $effect(() => selectedTrackStore.subscribeProperty(rack.devicePath, VISIBLE_MACROS));

  const grid = $derived.by(() => {
    const visible = selectedTrackStore.propertyValue(rack.devicePath, VISIBLE_MACROS);
    return liveMacroSlots(selectedTrackStore.paramNamesForDevice(rack), typeof visible === 'number' ? visible : undefined);
  });

  const valueOf = (index: number) =>
    (selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(rack, index)) ?? 0) / MACRO_MAX;
</script>

<div
  class="rack-macro-panel"
  data-macro-rows={grid.rows}
  data-macro-cols={grid.cols}
  style="grid-template-columns: repeat({grid.cols}, minmax(0, 1fr)); grid-template-rows: repeat({grid.rows}, minmax(0, 1fr));"
>
  {#each grid.slots as m, k (k)}
    <div class="macro-slot" class:dim={m?.dim} data-macro-index={m?.macroIndex}>
      {#if m}
        <DeviceSlider
          value={valueOf(m.macroIndex)}
          title={m.name}
          face="knob"
          knobSize="l"
          knobFit
          knobCaptionBelow
          icon={glyphForName(m.name)}
          color={colorAt(k)}
          readout={selectedTrackStore.paramDisplay(selectedTrackStore.paramPath(rack, m.macroIndex))}
          onInteraction={(v) => selectedTrackStore.setParamValue(selectedTrackStore.paramPath(rack, m.macroIndex), v * MACRO_MAX)}
        />
      {/if}
    </div>
  {/each}
</div>

<style>
  .rack-macro-panel {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    display: grid;
    gap: var(--central-gap);
  }
  .macro-slot {
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .macro-slot.dim {
    opacity: 0.35;
  }
  .macro-slot > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
</style>
