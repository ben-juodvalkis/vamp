<script lang="ts">
  /**
   * SectionDivider — a hairline between two logical parts of a central view.
   *
   * The central views had two ways of saying "these controls belong
   * together and those don't", and neither worked well:
   *
   *   1. A CARD: a bordered, titled box around the group (Squash's two
   *      `.dyn-panel`s, Drift's three `.drift-card`s, the Bass panel,
   *      `EnvelopeCard`). Every control in this interface is already a
   *      bordered box, so a card is a box of boxes — it costs a border, a
   *      radius, a background AND the padding to keep the inner boxes off
   *      its edge, which is roughly 20px of the 660px-tall band per card,
   *      spent on saying something a 1px line can say.
   *   2. NOTHING: Reverb's preset grid runs straight into its sliders, the
   *      Drum Rack's pad grid into its controls, the Arpeggiator's three
   *      devices into each other. The flex gap between groups is the same
   *      gap as between two sliders inside a group, so there is no signal
   *      at all — the eye has to read the labels to find the seam.
   *
   * A divider is the middle setting: one hairline, ~1px of ink, no
   * background, no radius, no padding around the content it separates. It
   * groups by SEPARATION rather than by enclosure, so the controls keep
   * the full height of the band.
   *
   * **It carries no text.** The first cut ran the group's name up the rule
   * in 10px rotated caps; the user's call, 2026-09-13: "I don't like the
   * tiny text in the divider line. The text should have normal orientation
   * and probably just be at the top of that section if it's needed at
   * all." So a name, where a group needs one, is a centred eyebrow at the
   * top of the group itself — upright, at the size the rest of the
   * interface writes titles — and the divider is the line and nothing
   * else. Most groups turned out not to need one: the seam plus the
   * device's own ink already says where the boundary is.
   *
   * The rule fades at both ends (a gradient, not a flat line) so it reads
   * as a seam between groups rather than as another box edge — at full
   * strength against the control borders it would just look like a third
   * column of frames.
   */
  interface Props {
    /**
     * `vertical` is a vertical rule separating side-by-side columns (the
     * common case in a 1366×~660 band); `horizontal` separates stacked rows.
     */
    orientation?: 'vertical' | 'horizontal';
    /**
     * The rule's colour — a device scheme's primary, where the seam divides
     * one device from another. Defaults to neutral, which is right for a
     * seam between two parts of the SAME device.
     */
    ink?: string;
  }

  let { orientation = 'vertical', ink }: Props = $props();
</script>

<div
  class="section-divider"
  data-orientation={orientation}
  style={ink ? `--divider-ink: ${ink};` : undefined}
  role="separator"
  aria-orientation={orientation}
></div>

<style>
  .section-divider {
    --divider-ink: var(--muted-foreground);
    flex: 0 0 auto;
    /* No padding and no background: the divider is the gap, not a box in
       it. The flex gap of the container it sits in supplies the air. */
  }

  .section-divider[data-orientation='vertical'] {
    align-self: stretch;
    width: 1px;
    min-height: 0;
    background: linear-gradient(
      to bottom,
      transparent,
      color-mix(in oklab, var(--divider-ink) 40%, transparent) 18%,
      color-mix(in oklab, var(--divider-ink) 40%, transparent) 82%,
      transparent
    );
  }

  .section-divider[data-orientation='horizontal'] {
    width: 100%;
    min-width: 0;
    height: 1px;
    background: linear-gradient(
      to right,
      transparent,
      color-mix(in oklab, var(--divider-ink) 40%, transparent) 18%,
      color-mix(in oklab, var(--divider-ink) 40%, transparent) 82%,
      transparent
    );
  }

  /* Flat grammar draws lines, not washes — a solid hairline at the same
     strength as a panel border rather than a fading one. */
  :global([data-grammar='flat']) .section-divider {
    background: var(--line-strong);
  }
</style>
