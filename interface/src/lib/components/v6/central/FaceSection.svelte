<script lang="ts">
  /**
   * FaceSection — one section of a `FaceGrid` face (ADR-510): `span`
   * columns wide, its header on the face's header line and its controls on
   * the face's columns under it.
   *
   * `head` is the header line (usually a `PanelEyebrow`, sometimes with a
   * small switch beside it); left out, the line stays empty so the controls
   * still start on the other sections' pixel. Each direct child of the
   * section takes one column; give a child `grid-column: span N` (or the
   * `face-span-N` class) to take more, `face-span-all` to take them all.
   */
  import type { Snippet } from 'svelte';

  interface Props {
    span: number;
    head?: Snippet;
    children: Snippet;
    class?: string;
    style?: string;
    /** Dims the section's controls (a device or section switched off); its header stays. */
    ghost?: boolean;
    [key: `data-${string}`]: string | number | boolean | undefined;
  }

  let { span, head, children, class: className = '', style = '', ghost = false, ...rest }: Props = $props();
</script>

<section class="face-section {className}" style="grid-column: span {span}; {style}" {...rest}>
  <div class="face-head">{@render head?.()}</div>
  <div class="face-body" class:ghost>{@render children()}</div>
</section>

<style>
  .face-section {
    grid-row: 1 / span 2;
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: subgrid;
    min-width: 0;
    min-height: 0;
  }
  /* The header line: centred over the section, and allowed to run into
     the seams either side, since a one-column section's name can be wider
     than its column. */
  .face-head {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-sm);
    min-width: 0;
    height: 1rem;
    overflow: visible;
    white-space: nowrap;
  }
  .face-body {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
  }
  .face-body > :global(*) {
    min-width: 0;
    min-height: 0;
  }
  .face-body > :global(.face-span-2) {
    grid-column: span 2;
  }
  .face-body > :global(.face-span-3) {
    grid-column: span 3;
  }
  .face-body > :global(.face-span-4) {
    grid-column: span 4;
  }
  .face-body > :global(.face-span-5) {
    grid-column: span 5;
  }
  .face-body > :global(.face-span-6) {
    grid-column: span 6;
  }
  .face-body.ghost {
    opacity: var(--opacity-ghost);
  }
  .face-body > :global(.face-span-all) {
    grid-column: 1 / -1;
  }
</style>
