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
  import ControlGlyph from '$lib/components/v6/device-panel/ControlGlyph.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';

  const wah = useFxGridSlot('wah');

  const MACRO_MAX = 127;
  const WAH_PEDAL_MACRO = 1;
  const WAH_CHAIN_MACRO = 2;

  // The selected track's ink, as the slot's scheme hands it over (ADR-544).
  let wahInk = $derived(wah.color);

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
  /** The chain the toe switch has selected, or -1 before the rack names its chains. */
  let wahChain = $derived.by(() => {
    const names = wahChainNames;
    if (wah.isGhost || names.length === 0) return -1;
    const t = (wah.paramValue(WAH_CHAIN_MACRO) ?? 0) / MACRO_MAX;
    return Math.min(names.length - 1, Math.max(0, Math.round(t * (names.length - 1))));
  });
  let wahTitle = $derived((wahChain >= 0 && wahChainNames[wahChain]) || 'Wah');
  /** What the box's head lists: the rack's chains, or the one name before they are known. */
  let wahHead = $derived(wahChain >= 0 ? wahChainNames.map((name, i) => ({ name: name || 'Wah', on: i === wahChain })) : [{ name: 'Wah', on: true }]);

  // A finger is down on the box: its head says Live's value, as a box's
  // name does while it is dragged.
  let touching = $state(false);
  let wahReadout = $derived(touching ? wah.paramDisplay(WAH_PEDAL_MACRO) : undefined);
  $effect(() => {
    const path = wah.devicePath;
    if (!path) return;
    return selectedTrackStore.subscribeProperty(path, 'chain_names');
  });
</script>

<svelte:window onpointerup={() => (touching = false)} onpointercancel={() => (touching = false)} />

<div class="wah-layout" data-view="wah">
  <FaceGrid sections={[1]}>
    <FaceSection span={1}>
      {#snippet head()}<PanelEyebrow title="Pedal" color={wahInk.primary} />{/snippet}
      <div class="slider-col" class:slot-ghost={wah.isGhost}>
        <DeviceSlider
          value={wahValue}
          title={wahTitle}
          orientation="vertical"
          isGhost={wah.isGhost}
          color={wahInk}
          readout={wah.paramDisplay(WAH_PEDAL_MACRO)}
          onDown={() => (touching = true)}
          onTap={() => wah.loadIfGhost()}
          onInteraction={(v) => wah.sendParam(WAH_PEDAL_MACRO, v * MACRO_MAX)}
        >
          {#snippet label()}
            <span class="wah-head">
              <span class="wah-mark" aria-hidden="true"><ControlGlyph name="wah" /></span>
              {#if wahReadout}
                <span class="wah-chains"><span class="wah-chain on">{wahReadout}</span></span>
              {:else}
                <span class="wah-chains" data-wah-chains>
                  {#each wahHead as chain (chain)}
                    <span class="wah-chain" class:on={chain.on}>{chain.name}</span>
                  {/each}
                </span>
              {/if}
            </span>
          {/snippet}
        </DeviceSlider>
      </div>
    </FaceSection>
  </FaceGrid>
</div>

<style>
  .wah-layout {
    height: 100%;
    width: 100%;
  }

  .slider-col {
    min-width: 0;
    min-height: 0;
  }

  /* The box's head, laid over the whole box so it sits at the top and in
     the middle whatever the box's shape: the mark over the chains. It is
     drawn inside the box's label, in both its layers, so it takes the
     label's ink on the well and the fill's own where the fill has risen. */
  .wah-head {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    padding-top: 10px;
    font-size: 19px;
    font-weight: 600;
    line-height: 1.15;
    text-transform: none;
    letter-spacing: 0;
  }
  .wah-mark {
    display: flex;
    width: 40px;
    height: 40px;
  }
  .wah-mark :global(svg) {
    width: 100%;
    height: 100%;
  }
  .wah-chains {
    display: flex;
    align-items: baseline;
    gap: 1.75rem;
    white-space: nowrap;
  }
  /* The chains the toe switch is not on: the same ink, dimmed. */
  .wah-chain:not(.on) {
    opacity: 0.4;
  }
</style>
