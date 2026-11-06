<script lang="ts">
  /**
   * FaceSeam — the hairline between two sections of a `FaceGrid` face
   * (ADR-510). It sits on the grid's seam track, full height, header line
   * included, so every seam on a face is the same width.
   */
  import SectionDivider from './SectionDivider.svelte';

  interface Props {
    ink?: string;
  }

  let { ink }: Props = $props();
</script>

<div class="face-seam" aria-hidden="true">
  <SectionDivider orientation="vertical" {ink} />
</div>

<style>
  .face-seam {
    grid-row: 1 / span 2;
    display: flex;
    justify-content: center;
    min-width: 0;
    min-height: 0;
  }
</style>
