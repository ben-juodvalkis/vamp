<script lang="ts">
  /**
   * EnvelopeGroup — the bracket around an amp envelope's sliders
   * (2026-09-12, user's call: "can they be on their own envelope card?").
   *
   * The four ADSR stages replaced a single XY pad in three views on the
   * same day. A pad was self-evidently one control; four bare sliders in
   * a row of other bare sliders are not — nothing said where the envelope
   * stopped and Spread or Feedback began.
   *
   * It said it with a card until 2026-09-13; now it says it with two
   * `SectionDivider` hairlines, one on each side, and the name as a
   * centred eyebrow over the stages. A card cost a border, a background
   * and ~16px of padding to fence off four controls that are themselves
   * bordered boxes — and the sliders lost that height off a 660px band. A
   * bracket costs two 1px lines and the title's own line.
   *
   * The name is UPRIGHT and CENTRED (user, 2026-09-13: "the text should
   * have normal orientation and probably just be at the top of that
   * section"). The first cut ran it up the left-hand hairline in rotated
   * 10px caps, which was unreadable at the size the seam wants to be.
   *
   * Bracket only: it takes the sliders as a snippet rather than a list of
   * stages, because the Sampler row's sliders carry the virtual-macro
   * grammar (`vm-slot`, ghost/held states, macro badges) and Operator's
   * and Wavetable's do not. One component owning both would be a switch
   * over two unrelated shapes; owning the bracket alone is the part that
   * is actually the same.
   *
   * The hairlines render INSIDE whatever box the host puts this in, so
   * that box's gap is the air between a hairline and the stages, and the
   * host's own gap is the air on the hairline's far side. They must be the
   * same value or the seam sits off-centre: Operator and Wavetable wrapped
   * this in `gap-2` inside a `gap-4` grid, which measured 8px on the stage
   * side and 16px outside (2026-09-14).
   */
  import type { Snippet } from 'svelte';
  import SectionDivider from '../SectionDivider.svelte';

  interface Props {
    /** The group's ink — the host's device/track scheme primary. */
    ink: string;
    /**
     * Defaults to "Amp Envelope" — every current host draws the amplitude
     * envelope, and a device with a second one (Operator's filter and
     * pitch envelopes, Wavetable's two mod envelopes) would need the
     * bracket to say which. The name is what lets the sliders inside be
     * one letter each.
     */
    title?: string;
    /**
     * Which hairlines to draw. `both` brackets the group; `trailing` drops
     * the leading one for a host where the group OPENS the band — Operator's,
     * whose leading hairline drew against the view's own left edge with
     * nothing on the far side of it to separate (audit, 2026-09-13).
     */
    edges?: 'both' | 'trailing';
    /**
     * Drawn over the eyebrow, inside the hairlines, so it spans the stages
     * and not the seam — Operator's swap pill (user's layout, 2026-09-16).
     */
    header?: Snippet;
    children: Snippet;
  }

  let { ink, title = 'Amp Envelope', edges = 'both', header, children }: Props = $props();
</script>

{#if edges === 'both'}
  <SectionDivider orientation="vertical" {ink} />
{/if}
<div class="envelope-group" data-envelope-group>
  {#if header}{@render header()}{/if}
  <div class="envelope-stages">
    <span class="envelope-title" style="color: {ink};">{title}</span>
    <div class="envelope-body">
      {@render children()}
    </div>
  </div>
</div>
<SectionDivider orientation="vertical" {ink} />

<style>
  .envelope-group {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
  }

  /* The eyebrow and the stages it names — one control's own spacing, so its
     gap is the group's, not the view's. A header above it is another control
     and takes the view's gap (ADR-434). */
  .envelope-stages {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
  }

  /* The same eyebrow every named group in a central view wears, so a
     bracket's name and a panel's name read as one kind of thing. */
  .envelope-title {
    flex: 0 0 auto;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-align: center;
    white-space: nowrap;
  }

  .envelope-body {
    display: flex;
    flex-direction: row;
    gap: var(--central-gap);
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
  }

  /* Flat grammar: titles are authored mixed-case, with no tracking (§8.1). */
  :global([data-grammar='flat']) .envelope-title {
    letter-spacing: normal;
    font-weight: var(--font-weight-medium);
  }
</style>
