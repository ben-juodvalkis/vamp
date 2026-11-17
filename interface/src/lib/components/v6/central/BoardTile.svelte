<script lang="ts">
  import { press } from '$lib/actions/press';
  /**
   * BoardTile — one panel of a full-screen board (ADR-516): a header bar
   * over the page the tile draws.
   *
   * The header names the section in plain ink on a bar a step off the
   * panel (ADR-544: a name is a label, and a board is one track's, so no
   * bar wears a colour; until then each wore its section's ink), holds the
   * section's switch at its right where
   * the section has one (Osc On, Filter On, a stage's On), lit while on as
   * every switch is, and has room between for a pick or two that belong to
   * the whole section (`tools`: Wavetable's category and table). The body
   * is the page's face grid, usually with no header line of its own
   * (`FaceGrid heads={false}`), since the bar names the tile; a tile of
   * several sections keeps the line for their names.
   *
   * The switch is the bar's height, 2.25rem, and at least 3.25rem wide: one
   * step under the 44px floor in height, bought back in width, so the bar
   * costs a row of knobs no more than the header line it replaces. Moving
   * the switch here is what takes the slabs out of the bodies: a board of
   * thirty sections is thirty small lamps on their bars, not thirty filled
   * buttons among the knobs.
   */
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    /** The section's ink. Kept for its callers; nothing is drawn in it since ADR-544. */
    ink: string;
    /** The section's switch state; undefined draws no switch. */
    on?: boolean;
    onToggle?: () => void;
    /** The switch's word ("On"). */
    switchTitle?: string;
    /** The switch's `data-param`, for tests and shot steps. */
    switchParam?: string;
    /** The switch exists but the device does not list it yet. */
    switchDisabled?: boolean;
    /** Controls on the bar, after the title: a section-wide pick or two. */
    tools?: Snippet;
    children: Snippet;
    /** Dims the body (the section is off); the bar stays. */
    ghost?: boolean;
    [key: `data-${string}`]: string | number | boolean | undefined;
  }

  let { title, ink, on, onToggle, switchTitle = 'On', switchParam, switchDisabled = false, tools, children, ghost = false, ...rest }: Props = $props();
</script>

<section class="board-panel" style="--panel-ink: {ink};" {...rest}>
  <header class="panel-head">
    <h3 class="panel-title">{title}</h3>
    {#if tools}<div class="panel-tools">{@render tools()}</div>{/if}
    {#if on !== undefined}
      <button
        type="button"
        class="physical-button btn-toggle panel-switch"
        class:active={on}
        aria-pressed={on}
        aria-label="{title} {switchTitle.toLowerCase()}"
        disabled={switchDisabled}
        data-param={switchParam}
        data-board-switch
        use:press={{ onPress: () => onToggle?.(), disabled: switchDisabled }}
      >{switchTitle}</button>
    {/if}
  </header>
  <div class="panel-body" class:ghost>{@render children()}</div>
</section>

<style>
  .board-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  /* The bar: a step off the panel's surface under the section's name, a
     hairline under it. No hue: the name is a label (ADR-544). */
  .panel-head {
    flex: none;
    height: var(--board-head-h, 2.25rem);
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding-inline: var(--central-inset) 0.375rem;
    background: color-mix(in oklab, var(--foreground) 5%, transparent);
    border-bottom: 1px solid var(--board-panel-line, var(--line));
    min-width: 0;
  }
  .panel-title {
    flex: none;
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    line-height: 1;
    color: var(--label);
  }
  .panel-tools {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    min-width: 0;
    /* A pick on the bar is the bar's height, not a board's touch row. */
    --picker-h: calc(var(--board-head-h, 2.25rem) - 0.375rem);
  }
  .panel-tools > :global(*) {
    flex: 1 1 0;
    min-width: 0;
    max-width: 13rem;
  }
  .panel-switch {
    flex: none;
    margin-left: auto;
    height: calc(var(--board-head-h, 2.25rem) - 0.375rem);
    min-width: 3.25rem;
    padding: 0 0.625rem;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .panel-body {
    flex: 1 1 0;
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .panel-body > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
  .panel-body.ghost {
    opacity: var(--opacity-ghost);
  }
  /* Flat grammar: the switch is app.css's (ON's block when lit, a label
     when not); the bar adds nothing to it. */
  :global([data-grammar='flat']) .panel-switch {
    font-weight: var(--font-weight-medium);
  }
</style>
