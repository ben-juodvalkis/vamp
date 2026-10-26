<script lang="ts">
  /**
   * The Wah's view (`Wah.adg`, the `wah` slot, ADR-445). The expression
   * pedal plays it; this is its one control, a slider on the macro the
   * pedal sweeps. It sat under the Guitar's Gain in the Pedal view, and
   * only while `features.expressionPedal` was on, until the FX chain
   * overview gave every device a view of its own (2026-10-26): the chain
   * opens this view on a Wah the track holds, pedal or not.
   *
   * Wah.adg's Macro 1, which the rack names "Pedal", 0..127 — the
   * surface's `devices.wah.freqMacroIndex`. A tap on a ghost loads Wah.adg,
   * a drag loads it and writes; the surface puts it at the head of the
   * audio effects either way.
   *
   * The slider is titled with the chain the toe switch has selected
   * (2026-10-12): Macro 2 is mapped across the rack's chain selector, and
   * the toe switch steps it through the chains at even spacing — 3 chains
   * at 0 / 64 / 127 — so the chain is the macro's position rounded to the
   * nearest of those steps (the surface's `_step_values`). The names are
   * the rack's own (`chain_names`, Wah · Volume · Ring in Wah.adg).
   *
   * NO {#if device} gate - always renders, handles its own state.
   */

  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';

  const wah = useFxGridSlot('wah');

  const MACRO_MAX = 127;
  const WAH_PEDAL_MACRO = 1;
  const WAH_CHAIN_MACRO = 2;

  let wahInk = $derived({
    primary: trackInk(wah.color.primary, paintModeReactive()),
    secondary: wah.color.secondary,
    accent: trackInk(wah.color.accent, paintModeReactive())
  });

  let wahValue = $derived((wah.paramValue(WAH_PEDAL_MACRO) ?? 0) / MACRO_MAX);

  let wahChainNames = $derived.by(() => {
    const value = wah.devicePath ? selectedTrackStore.propertyValue(wah.devicePath, 'chain_names') : undefined;
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  });
  let wahTitle = $derived.by(() => {
    const names = wahChainNames;
    if (wah.isGhost || names.length === 0) return 'Wah';
    const t = (wah.paramValue(WAH_CHAIN_MACRO) ?? 0) / MACRO_MAX;
    const index = Math.min(names.length - 1, Math.max(0, Math.round(t * (names.length - 1))));
    return names[index] || 'Wah';
  });
  $effect(() => {
    const path = wah.devicePath;
    if (!path) return;
    return selectedTrackStore.subscribeProperty(path, 'chain_names');
  });
</script>

<div class="wah-layout" data-view="wah">
  <div class="slider-col" class:slot-ghost={wah.isGhost}>
    <DeviceSlider
      value={wahValue}
      title={wahTitle}
      icon="wah"
      orientation="vertical"
      isGhost={wah.isGhost}
      color={wahInk}
      readout={wah.paramDisplay(WAH_PEDAL_MACRO)}
      onTap={() => wah.loadIfGhost()}
      onInteraction={(v) => wah.sendParam(WAH_PEDAL_MACRO, v * MACRO_MAX)}
    />
  </div>
</div>

<style>
  .wah-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
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
