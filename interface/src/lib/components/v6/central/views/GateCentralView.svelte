<script lang="ts">
  /**
   * GateCentralView — the Gate's view (slot `gate`).
   *
   * The Gate's pad (`GateControl`: release across, threshold up) at the
   * view's full size, on the face grid (ADR-510) under a header line that
   * names its two amounts. The pad is its dot over the device's picture,
   * as on its chain cell (ADR-544): the threshold line and what opens over
   * it, closing over the release, both moving with the dot. Until the
   * rollout the pad carried a glyph and the word "Gate" in its middle, and
   * nothing said what either direction moved. The app binds no other Gate
   * parameter, so the view is its pad (ADR-510's addendum).
   *
   * Split out of the shared dynamics view (`SquashCentralView`) when the
   * FX chain overview gave every device its own view (ADR-478).
   *
   * Self-contained: queries its own slot state, takes no props, and
   * renders through ghost/loading/active without a `{#if device}` gate —
   * `GateControl` handles its own slot state.
   */

  import { setContext } from 'svelte';
  import GateControl from '../../device-panel/GateControl.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { PICTURE_CONTEXT } from '$lib/components/v6/browser/devicePictures';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';

  // The pad draws its device's picture here as it does on its chain cell.
  setContext(PICTURE_CONTEXT, true);

  const gate = useFxGridSlot('gate');
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="gate-central-layout relative">
  <FaceGrid sections={[1]}>
    <FaceSection span={1}>
      {#snippet head()}<PanelEyebrow title="Release · Threshold" color={gate.color.primary} />{/snippet}
      <div class="device-wrapper gate-body" class:slot-ghost={gate.isGhost}>
        <GateControl device={gate.device} />
      </div>
    </FaceSection>
  </FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510): one section, the pad. */
  .gate-central-layout {
    height: 100%;
    width: 100%;
    min-height: 0;
  }

  .device-wrapper {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0; /* Allow shrinking below content size */
  }
</style>
