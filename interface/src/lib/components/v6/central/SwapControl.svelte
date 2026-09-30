<script lang="ts">
  /**
   * SwapControl — the swap pill every instrument view shares (ADR-439), in
   * one of two orientations.
   *
   * **Vertical** (the default), stood on its end: the name of what is loaded,
   * reading bottom to top, between an up and a down arrow. A press on the
   * pill's **top** half steps FORWARD (next), on its bottom half back — the
   * user's call, 2026-09-15: up is onward, and on a freshly loaded kit Live
   * disables Previous (the kit sits on its own reference sample), so a top
   * half that stepped back refused the first press every time. Mounted by
   * `CentralDisplay` down the left of the view, transparent around the pill,
   * so it takes a column of width rather than a row of height from views laid
   * out for the whole band, and the frame's inset is measured off the pill
   * exactly as off the view's own controls (ADR-434).
   *
   * **Horizontal** (2026-09-16), lying flat: the name reading across between a
   * left arrow that steps back and a right arrow that steps forward, one touch
   * row tall and as wide as the group of controls it heads. A view places it
   * through `HostedSwapPill`, and carries no inset of its own there — the
   * view's gap is the space around it.
   *
   * Either way: two half-pill buttons under one centered name, each with its
   * own press (ADR-427), so the split is always the pill's middle, however
   * long the name.
   *
   * **The name is the door to the browser** (ADR-442) when `onOpen` is given:
   * it becomes a button over the halves, exactly as long as the text and as
   * thick as the pill, so a tap ON the name opens the browser to pick a
   * replacement and a tap either side of it lands on a half and steps. The
   * pill steps to the neighbor; the name goes and picks one. It is a tap, not
   * the 800ms hold the clip rail's Replace Inst was, and it stays live while
   * the halves are disabled — "No preset recorded" is a name that should open
   * the browser. A name never runs closer than a touch target to either end,
   * so each step always keeps 44px of its own.
   *
   * Dumb: what a step moves, the label (the name, or why the pill cannot
   * step), whether it is busy, disabled or failed, and two callbacks. The Drum
   * Rack wires it to Live's own similar-sample buttons through the AX helper;
   * every other instrument to the neighboring preset in its catalog folder
   * (`central/useInstrumentSwap.svelte.ts` decides which); an audio clip to
   * the neighboring file in Live's ranking (`central/useClipSwap.svelte.ts`).
   */
  import { press } from '$lib/actions';

  interface Props {
    /** "Kit", "Pad", "Preset", "Clip" — what a step moves. */
    scopeLabel: string;
    /** What is loaded now, or why the pill cannot step. */
    label: string;
    /** The whole reason behind a short label — a named error's detail. */
    detail?: string;
    working?: boolean;
    disabled?: boolean;
    error?: string | null;
    ink?: string | null;
    /**
     * Lying flat only: a name too long for the pill wraps to a second line and
     * the pill grows to hold it, instead of ending in an ellipsis. For a view
     * that hosts the pill over a narrow column (Omnisphere's, 2026-09-29).
     */
    wrap?: boolean;
    /** The mounted view's `data-density`, mirrored so the pill's inset is the view's. */
    density?: string | null;
    orientation?: 'vertical' | 'horizontal';
    onPrev: () => void;
    onNext: () => void;
    /** Open the browser to pick a replacement, from a tap on the name. The name is inert when absent. */
    onOpen?: (() => void) | null;
  }

  let {
    scopeLabel,
    label,
    detail = '',
    working = false,
    disabled = false,
    error = null,
    ink = null,
    density = null,
    orientation = 'vertical',
    wrap = false,
    onPrev,
    onNext,
    onOpen = null
  }: Props = $props();

  let idle = $derived(!disabled && !working);
  let scope = $derived(scopeLabel.toLowerCase());
  let swapState = $derived(disabled ? 'disabled' : working ? 'working' : error ? 'error' : 'ready');
  let flat = $derived(orientation === 'horizontal');

  // Onward is up on its end and right lying flat; back is down and left.
  const ARROWS = {
    vertical: { next: 'M3.5 10 8 5.5l4.5 4.5', prev: 'M3.5 6 8 10.5 12.5 6' },
    horizontal: { next: 'M6 3.5 10.5 8 6 12.5', prev: 'M10 3.5 5.5 8l4.5 4.5' }
  } as const;
</script>

{#snippet half(direction: 'next' | 'prev')}
  <button
    type="button"
    class="swap-half swap-half-{direction}"
    data-swap={direction}
    aria-label="{direction === 'next' ? 'Next' : 'Previous'} {scope}"
    disabled={!idle}
    use:press={{ onPress: direction === 'next' ? onNext : onPrev, disabled: !idle, touchAction: 'none' }}
  >
    <svg class="swap-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d={ARROWS[orientation][direction]} /></svg>
  </button>
{/snippet}

<div
  class="swap-control"
  data-orientation={orientation}
  data-swap-state={swapState}
  data-density={density ?? undefined}
  data-wrap={wrap && flat ? '' : undefined}
>
  <div
    class="swap-pill"
    role="group"
    aria-label="Swap {scope}: {detail || label}"
    title={detail || undefined}
    style="--btn-tint: {ink ?? 'var(--foreground)'};"
  >
    <!-- Reading order follows the drawing: top then bottom on its end, left
         then right lying flat. -->
    {#if flat}
      {@render half('prev')}
      {@render half('next')}
    {:else}
      {@render half('next')}
      {@render half('prev')}
    {/if}
    <!-- After the halves, so a name that is a door sits over them. -->
    {#if onOpen}
      <button
        type="button"
        class="swap-name"
        data-swap="open"
        aria-label="Browse to replace {scope}: {label}"
        aria-live="polite"
        use:press={{ onPress: onOpen, touchAction: 'none' }}
      >{label}</button>
    {:else}
      <span class="swap-name" aria-live="polite">{label}</span>
    {/if}
  </div>
</div>

<style>
  .swap-control {
    display: flex;
    flex: 0 0 auto;
    min-height: 0;
    padding: var(--central-inset) 0 var(--central-inset) var(--central-inset);
  }
  .swap-pill {
    display: grid;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    width: var(--height-touch, 44px);
    min-height: 0;
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--btn-tint) 55%, transparent);
    border-radius: var(--radius-sm);
    background: var(--surface-well);
    box-shadow: inset 0 1px 0 oklch(0 0 0 / 0.5);
  }
  .swap-half {
    grid-column: 1;
    display: flex;
    justify-content: center;
    min-height: 0;
    padding-block: 0.75rem;
    border: 0;
    background: transparent;
    color: var(--btn-tint);
    cursor: pointer;
    user-select: none;
    transition: background-color var(--t-fast) var(--ease-precise);
  }
  .swap-half-next {
    grid-row: 1;
    align-items: flex-start;
  }
  .swap-half-prev {
    grid-row: 2;
    align-items: flex-end;
  }
  .swap-half:active:not(:disabled) {
    background: color-mix(in oklab, var(--btn-tint) 18%, transparent);
  }
  @media (hover: hover) {
    .swap-half:hover:not(:disabled) {
      background: color-mix(in oklab, var(--btn-tint) 12%, transparent);
    }
  }
  .swap-half:disabled {
    cursor: default;
  }
  .swap-arrow {
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .swap-half:disabled .swap-arrow {
    opacity: 0.3;
  }
  /* One name down both halves, reading bottom to top, laid out vertically
     (vertical-rl) and turned to read upward. Its box is exactly the text's
     length, centered, and never longer than the pill less a touch target at
     each end — so the arrows stay clear and a long name ends in an ellipsis.
     The line is as thick as the pill (`line-height` is the column's width in
     vertical-rl), so a name that is a door is hit across the whole column. A
     plain name lets a press through to the half below. */
  .swap-name {
    grid-column: 1;
    grid-row: 1 / -1;
    justify-self: stretch;
    align-self: center;
    min-height: 0;
    max-height: calc(100% - 2 * var(--height-touch, 44px));
    margin: 0;
    padding: 0.5rem 0;
    overflow: hidden;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1rem;
    /* The pill's inside: a touch target less its 1px border each side. */
    line-height: calc(var(--height-touch, 44px) - 2px);
    font-weight: var(--font-weight-medium);
    color: var(--btn-tint);
    pointer-events: none;
  }
  button.swap-name {
    position: relative;
    z-index: 1;
    cursor: pointer;
    user-select: none;
    pointer-events: auto;
    transition: background-color var(--t-fast) var(--ease-precise);
  }
  button.swap-name:active {
    background: color-mix(in oklab, var(--btn-tint) 18%, transparent);
  }
  @media (hover: hover) {
    button.swap-name:hover {
      background: color-mix(in oklab, var(--btn-tint) 12%, transparent);
    }
  }

  /* ---- Lying flat: one touch row as wide as its host gives it, back on the
     left half and onward on the right, the name across both. No inset — the
     view that places it owns the space around it. */
  .swap-control[data-orientation='horizontal'] {
    padding: 0;
    min-width: 0;
  }
  [data-orientation='horizontal'] .swap-pill {
    flex: 1 1 auto;
    grid-template-rows: none;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    width: auto;
    min-width: 0;
    height: var(--height-touch, 44px);
  }
  [data-orientation='horizontal'] .swap-half {
    grid-row: 1;
    align-items: center;
    padding-block: 0;
    padding-inline: 0.75rem;
  }
  [data-orientation='horizontal'] .swap-half-prev {
    grid-column: 1;
    justify-content: flex-start;
  }
  [data-orientation='horizontal'] .swap-half-next {
    grid-column: 2;
    justify-content: flex-end;
  }
  [data-orientation='horizontal'] .swap-name {
    grid-column: 1 / -1;
    grid-row: 1;
    align-self: stretch;
    justify-self: center;
    min-width: 0;
    max-width: calc(100% - 2 * var(--height-touch, 44px));
    max-height: none;
    padding: 0 0.5rem;
    writing-mode: horizontal-tb;
    transform: none;
  }
  /* Wrapping: at least a touch row tall, taller when the name takes two
     lines; a name longer than two lines still ends in an ellipsis. It breaks
     between words, a word only when it alone is wider than the space — and a
     step smaller, since the arrows' touch targets leave the name ~66px over
     Omnisphere's column. */
  [data-orientation='horizontal'][data-wrap] .swap-pill {
    height: auto;
    min-height: var(--height-touch, 44px);
  }
  [data-orientation='horizontal'][data-wrap] .swap-name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    align-self: center;
    padding: 0.375rem 0.5rem;
    white-space: normal;
    font-size: 0.875rem;
    line-height: 1.2;
    overflow-wrap: break-word;
  }
  /* A pill too narrow to name anything — over a single column of drum pads
     it is 68px, less than the padding that keeps the name clear of the
     arrows — draws the two arrows alone, each centred in its half. The name
     still rides the group's label and tooltip. */
  [data-orientation='horizontal'] .swap-pill {
    container-type: inline-size;
  }
  @container (max-width: 6.5rem) {
    [data-orientation='horizontal'] .swap-name {
      display: none;
    }
    [data-orientation='horizontal'] .swap-half-prev,
    [data-orientation='horizontal'] .swap-half-next {
      justify-content: center;
      padding-inline: 0;
    }
  }

  [data-swap-state='working'] .swap-name,
  [data-swap-state='disabled'] .swap-name {
    color: var(--signal-dim);
  }
  [data-swap-state='disabled'] .swap-name {
    font-weight: var(--font-weight-normal, 400);
  }
  [data-swap-state='error'] .swap-name {
    color: var(--destructive);
  }

  :global([data-grammar="flat"]) .swap-pill {
    border: 1px solid var(--line-strong);
    box-shadow: none;
  }
  :global([data-grammar="flat"]) .swap-half {
    color: var(--foreground);
  }
  :global([data-grammar="flat"]) .swap-half:active:not(:disabled) {
    background: var(--secondary);
  }
  @media (hover: hover) {
    :global([data-grammar="flat"]) .swap-half:hover:not(:disabled) {
      background: var(--secondary);
    }
  }
  :global([data-grammar="flat"]) button.swap-name:active {
    background: var(--secondary);
  }
  @media (hover: hover) {
    :global([data-grammar="flat"]) button.swap-name:hover {
      background: var(--secondary);
    }
  }
</style>
