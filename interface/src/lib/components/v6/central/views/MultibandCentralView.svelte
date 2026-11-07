<script lang="ts">
  /**
   * MultibandCentralView — the Multiband Dynamics' view (slot `ott`).
   *
   * The Mid band's Below Threshold and the device's Output, two value
   * boxes side by side. The Below Ratio is the device's chain cell, so it
   * left this view (user, 2026-10-26; three boxes, stacked before ADR-477). A ghost loads it on the first
   * drag, inserted by name with the user's own default. Indices and rails
   * live in `multibandParams.ts`.
   *
   * Split out of the shared dynamics view (`SquashCentralView`) when the
   * FX chain overview gave every device its own view (ADR-478).
   *
   * Self-contained: queries its own slot state, takes no props, and
   * renders through ghost/loading/active without a `{#if device}` gate.
   *
   * Full screen (ADR-515) is the board, as Live lays the device out: a row
   * a band with its Below and Above blocks to drag, then the globals and
   * the sidechain (`multiband/MultibandBoardTile.svelte`).
   */

  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
  import InstrumentBoard from '../InstrumentBoard.svelte';
  import MultibandBoardTile, { MULTIBAND_BOARD } from './multiband/MultibandBoardTile.svelte';
  import { usePanelParams } from './panel/usePanelParams.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import {
    MB_BELOW_THRESHOLD_MID,
    MB_THRESHOLD_MIN,
    MB_THRESHOLD_MAX,
    MB_OUTPUT,
    MB_OUTPUT_MIN,
    MB_OUTPUT_MAX
  } from '../../device-panel/multibandParams';

  const multiband = useFxGridSlot('ott');
  /** The board binds by Live's names (ADR-515). */
  const params = usePanelParams(() => multiband.device ?? undefined);

  // A ghost draws Live's factory defaults (the dump's `default`s).
  let mbThreshold = $derived(multiband.paramValue(MB_BELOW_THRESHOLD_MID) ?? -60);
  let mbOutput = $derived(multiband.paramValue(MB_OUTPUT) ?? 0);
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="mb-central-layout relative" data-device="multiband">
{#if multiband.device && centralDisplayStore.expanded}
<InstrumentBoard rows={MULTIBAND_BOARD} ink={multiband.color.primary}>
  {#snippet tile(id)}
    <MultibandBoardTile page={id} {params} ink={multiband.color} />
  {/snippet}
</InstrumentBoard>
{:else}
<!-- One face grid (ADR-510): Threshold over two columns, Output one. -->
<FaceGrid sections={[2, 1]}>
  <FaceSection span={2}>
  {#snippet head()}<PanelEyebrow title="Mid Band" color={multiband.color.primary} />{/snippet}
  <div class="mb-slider face-span-2" class:slot-ghost={multiband.isGhost}>
    <DeviceSlider
      value={mbThreshold}
      title="Threshold"
      icon="threshold"
      orientation="vertical"
      min={MB_THRESHOLD_MIN}
      max={MB_THRESHOLD_MAX}
      isGhost={multiband.isGhost}
      color={multiband.color}
      readout={multiband.paramDisplay(MB_BELOW_THRESHOLD_MID)}
      onTap={() => multiband.loadIfGhost()}
      onInteraction={(value) => multiband.sendParam(MB_BELOW_THRESHOLD_MID, value)}
    />
  </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
  {#snippet head()}<PanelEyebrow title="Output" color={multiband.color.primary} />{/snippet}
  <div class="mb-slider" class:slot-ghost={multiband.isGhost}>
    <DeviceSlider
      value={mbOutput}
      title="Output"
      face="knob"
      knobSize="l"
      icon="output"
      orientation="vertical"
      min={MB_OUTPUT_MIN}
      max={MB_OUTPUT_MAX}
      centerOrigin={true}
      centerValue={0}
      isGhost={multiband.isGhost}
      color={multiband.color}
      readout={multiband.paramDisplay(MB_OUTPUT)}
      onTap={() => multiband.loadIfGhost()}
      onInteraction={(value) => multiband.sendParam(MB_OUTPUT, value)}
    />
  </div>
  </FaceSection>
</FaceGrid>
{/if}
</div>

<style>
  /* threshold | output */
  /* The threshold a set rides as a box, the output set once as a knob
     (ADR-509), on the FaceGrid (ADR-510). */
  .mb-central-layout {
    height: 100%;
    width: 100%;
    min-height: 0;
  }

  .mb-slider {
    min-width: 0;
    min-height: 0;
  }
</style>
