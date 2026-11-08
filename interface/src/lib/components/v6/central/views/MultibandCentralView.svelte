<script lang="ts">
  /**
   * MultibandCentralView — the Multiband Dynamics' view (slot `ott`).
   *
   * The band (2026-11-08): the Mid band as Live draws it, its Below and
   * Above blocks on a dB scale (`multiband/BandDynamicsDisplay.svelte`:
   * a threshold's edge drags across, a block's ratio up and down), across
   * six columns, then the device's Amount and Output, large. Until then
   * the face was one value box, the Mid band's Below Threshold, beside an
   * Output knob, most of the band empty; the Below Ratio alone is the
   * device's chain cell (user, 2026-10-26), and the display moves it only
   * as one of the band's four handles. Every parameter binds by Live's
   * name (`usePanelParams`); a ghost draws the face at Live's defaults and
   * the first touch loads it.
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
  import BandDynamicsDisplay from './multiband/BandDynamicsDisplay.svelte';
  import { usePanelParams } from './panel/usePanelParams.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';

  const multiband = useFxGridSlot('ott');
  /** The face and the board bind by Live's names (ADR-515). */
  const params = usePanelParams(() => multiband.device ?? undefined);

  const MID_ON = 'Band Activator (Mid)';
  const lo = (p: string) => params.range(p)?.min ?? 0;
  const hi = (p: string) => params.range(p)?.max ?? 1;
</script>

<!-- A knob bound by name, large: a range either side of zero draws from zero. -->
{#snippet knob(param: string, title: string, fallback: number)}
  {@const l = lo(param)}
  {@const h = hi(param)}
  {@const bipolar = l < 0 && h > 0}
  <div class="mb-knob" data-param={param}>
    <DeviceSlider
      value={params.raw(param) ?? fallback}
      {title}
      face="knob"
      knobSize="l"
      min={l}
      max={h}
      centerOrigin={bipolar}
      centerValue={bipolar ? 0 : undefined}
      orientation="vertical"
      labelSize="small"
      isGhost={multiband.isGhost}
      color={multiband.color}
      readout={params.display(param)}
      onTap={() => multiband.loadIfGhost()}
      onInteraction={(v) => params.write(param, v)}
    />
  </div>
{/snippet}

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="mb-central-layout relative" data-device="multiband">
{#if multiband.device && centralDisplayStore.expanded}
<InstrumentBoard rows={MULTIBAND_BOARD} ink={multiband.color.primary}>
  {#snippet tile(id)}
    <MultibandBoardTile page={id} {params} ink={multiband.color} />
  {/snippet}
</InstrumentBoard>
{:else}
<!-- One face grid (ADR-510): the Mid band's display over six columns,
     Amount and Output a column each. -->
<FaceGrid sections={[6, 2]}>
  <FaceSection span={6}>
  {#snippet head()}<PanelEyebrow title="Mid Band" color={multiband.color.primary} />{/snippet}
  <!-- A ghost's first touch loads the device (the display has no tap of its own). -->
  <div class="mb-display face-span-all" class:slot-ghost={multiband.isGhost} onpointerdowncapture={() => multiband.loadIfGhost()}>
    <BandDynamicsDisplay {params} band="Mid" ink={multiband.color.primary} sw={MID_ON} />
  </div>
  </FaceSection>
  <FaceSeam ink={multiband.color.primary} />

  <FaceSection span={2}>
  {#snippet head()}<PanelEyebrow title="Global" color={multiband.color.primary} />{/snippet}
  {@render knob('Amount', 'Amount', 1)}
  {@render knob('Output', 'Output', 0)}
  </FaceSection>
</FaceGrid>
{/if}
</div>

<style>
  /* The Mid band's picture, then Amount and Output (ADR-509: set once, as
     knobs), on the FaceGrid (ADR-510). */
  .mb-central-layout {
    height: 100%;
    width: 100%;
    min-height: 0;
  }

  .mb-display,
  .mb-knob {
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  .mb-display {
    display: flex;
  }
  .mb-display > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
</style>
