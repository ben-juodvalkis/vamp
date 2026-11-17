<script lang="ts">
  /**
   * The Bass Amp's view (`Bass Amp.adg`, the `bass` slot). The rack has one
   * visible macro, the mix, so the view is the Bass tile itself at full
   * size (`BassControl`, which keeps its load-to-the-head latch). The tile
   * opened the Guitar rack's view until the FX chain overview gave every
   * device a view of its own (2026-10-26).
   *
   * One section on the face grid (ADR-510), named for what the one amount
   * is, Mix, and one box across it. The box wears the amp as a full stack,
   * the picture its chain cell draws (user, 2026-10-26), the fill rising
   * through it: until the Ink rollout (ADR-544) it was a bare box with
   * "Bass" at its left edge. The picture takes the name's place on the box
   * (`FaceControl`), so the group around it carries the name, and it is
   * drawn at full strength here, being the box's whole face.
   */

  import { setContext } from 'svelte';
  import BassControl from '$lib/components/v6/device-panel/BassControl.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { PICTURE_CONTEXT } from '$lib/components/v6/browser/devicePictures';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';

  // The tile draws its device's picture here as it does on a chain cell.
  setContext(PICTURE_CONTEXT, true);

  const bass = useFxGridSlot('bass');
</script>

<div class="bass-layout" data-view="bass">
  <FaceGrid sections={[1]}>
    <FaceSection span={1}>
      {#snippet head()}<PanelEyebrow title="Mix" color={bass.color.primary} />{/snippet}
      <div class="slider-col" class:slot-ghost={bass.isGhost} role="group" aria-label="Bass Amp mix">
        <BassControl device={bass.device} />
      </div>
    </FaceSection>
  </FaceGrid>
</div>

<style>
  .bass-layout {
    height: 100%;
    width: 100%;
  }

  .slider-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  /* The picture is the box's whole face here, so it is drawn at full
     strength: `FaceControl` fades it to sit behind a chain cell's
     controls, and across a box this size that left it too faint to find.
     The copy over the fill keeps its own strength. */
  .slider-col :global(.slider-picture:not(.slider-picture--inverse)) {
    opacity: 1;
  }
</style>
