<script lang="ts">
  /**
   * FaceGrid — a central view's face laid on ONE column grid (ADR-510).
   *
   * The face is a row of sections (`FaceSection`), each a whole number of
   * equal columns, with a `FaceSeam` between two sections. `sections` lists
   * each section's column count in order, so `[4, 1, 1, 2, 2]` is Drift's
   * ten columns: Oscillators, Filter, Envelopes, LFO, Global.
   *
   * Every column is the same width, every gutter inside a section is
   * `--face-gutter`, and every seam is the same distance between two
   * sections' controls (a central gap, the hairline, a central gap), so
   * the face reads on one beat instead of each section being sized on its
   * own. Two rows: a header line for every section's eyebrow, and the
   * controls under it, all starting and ending on the same pixel. A face
   * whose sections need no eyebrow (a board tile named by its own header
   * bar, ADR-516) drops the line with `heads={false}`, so its controls take
   * the whole height.
   *
   * Sections use CSS subgrid, so a control inside a section sits on the
   * face's own columns: one column wide by default, or `grid-column: span
   * N` for wider (a pad over two columns).
   */
  import type { Snippet } from 'svelte';

  interface Props {
    /** Each section's column count, left to right. */
    sections: readonly number[];
    children: Snippet;
    class?: string;
    /** False drops the header line: the sections' controls take the whole height. */
    heads?: boolean;
    /** `data-*` attributes land on the grid itself (a view's `data-view`, a test hook). */
    [key: `data-${string}`]: string | number | boolean | undefined;
  }

  let { sections, children, class: className = '', heads = true, ...rest }: Props = $props();

  let template = $derived(sections.map((n) => `repeat(${n}, minmax(0, 1fr))`).join(' var(--face-seam) '));
  let columns = $derived(sections.reduce((a, b) => a + b, 0));
</script>

<div class="face-grid {className}" class:headless={!heads} style="grid-template-columns: {template};" data-face-columns={columns} {...rest}>
  {@render children()}
</div>

<style>
  .face-grid {
    /* Between two controls in one section. */
    --face-gutter: var(--spacing-sm);
    /* The seam's own track: with a gutter either side, two sections'
       controls are a central gap, the hairline and a central gap apart,
       the distance every SectionDivider in a flex row keeps. */
    --face-seam: max(1px, calc(2 * var(--central-gap) + 1px - 2 * var(--face-gutter)));
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    column-gap: var(--face-gutter);
    row-gap: var(--central-gap);
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    box-sizing: border-box;
    padding: var(--central-inset);
  }
  /* No header line: one row, which every section and seam spans; a
     section's head is not drawn. */
  .face-grid.headless {
    grid-template-rows: minmax(0, 1fr);
  }
  .face-grid.headless > :global(.face-section),
  .face-grid.headless > :global(.face-seam) {
    grid-row: 1;
  }
  .face-grid.headless > :global(.face-section > .face-head) {
    display: none;
  }
</style>
