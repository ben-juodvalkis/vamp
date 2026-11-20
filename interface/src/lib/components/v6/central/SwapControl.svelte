<script lang="ts">
  /**
   * SwapControl — the swap pill every instrument view shares (ADR-439), in
   * one of two orientations: stood on its end down the left of the view
   * (`CentralDisplay`'s column, the name reading bottom to top), or lying flat
   * inside a view through `HostedSwapPill`, one touch row tall.
   *
   * **The whole pill is the door to the browser** (ADR-552, superseding the
   * step arrows of ADR-439 and the name-only door of ADR-442) when `onOpen`
   * is given: a tap anywhere on it opens the browser to pick a replacement.
   * There are no arrows and nothing steps from here. It is a tap, not a hold,
   * and it stays live while the pill is disabled or working — "No preset
   * recorded" is a name that should open the browser. Without `onOpen` the
   * pill is a plain label.
   *
   * Dumb: the label (the name, or why the pill cannot step), whether it is
   * busy, disabled or failed, and one callback.
   */
  import { press } from '$lib/actions';

  interface Props {
    /** "Kit", "Pad", "Preset", "Clip" — what the browser would replace. */
    scopeLabel: string;
    /** What is loaded now, or why the pill cannot step. */
    label: string;
    /** The whole reason behind a short label — a named error's detail. */
    detail?: string;
    working?: boolean;
    disabled?: boolean;
    error?: string | null;
    ink?: string | null;
    /** The mounted view's `data-density`, mirrored so the pill's inset is the view's. */
    density?: string | null;
    orientation?: 'vertical' | 'horizontal';
    /** Open the browser to pick a replacement, from a tap anywhere on the pill. The pill is inert when absent. */
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
    onOpen = null
  }: Props = $props();

  let scope = $derived(scopeLabel.toLowerCase());
  let swapState = $derived(disabled ? 'disabled' : working ? 'working' : error ? 'error' : 'ready');
</script>

<div
  class="swap-control"
  data-orientation={orientation}
  data-swap-state={swapState}
  data-density={density ?? undefined}
  style="--btn-tint: {ink ?? 'var(--foreground)'};"
>
  {#if onOpen}
    <button
      type="button"
      class="swap-pill"
      data-swap="open"
      aria-label="Browse to replace {scope}: {detail || label}"
      title={detail || undefined}
      use:press={{ onPress: onOpen, touchAction: 'none' }}
    ><span class="swap-name" aria-live="polite">{label}</span></button>
  {:else}
    <div class="swap-pill" role="group" aria-label="{scopeLabel}: {detail || label}" title={detail || undefined}>
      <span class="swap-name" aria-live="polite">{label}</span>
    </div>
  {/if}
</div>

<style>
  .swap-control {
    display: flex;
    flex: 0 0 auto;
    min-height: 0;
    padding: var(--central-inset) 0 var(--central-inset) var(--central-inset);
  }
  .swap-pill {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--height-touch, 44px);
    min-height: 0;
    margin: 0;
    padding: 0.5rem 0;
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--btn-tint) 55%, transparent);
    border-radius: var(--radius-sm);
    background: var(--surface-well);
    box-shadow: inset 0 1px 0 oklch(0 0 0 / 0.5);
    color: var(--btn-tint);
    font: inherit;
  }
  button.swap-pill {
    cursor: pointer;
    user-select: none;
    transition: background-color var(--t-fast) var(--ease-precise);
  }
  button.swap-pill:active {
    background: color-mix(in oklab, var(--btn-tint) 18%, var(--surface-well));
  }
  @media (hover: hover) {
    button.swap-pill:hover {
      background: color-mix(in oklab, var(--btn-tint) 12%, var(--surface-well));
    }
  }
  /* On its end the name reads bottom to top, laid out vertically and turned
     to read upward, ending in an ellipsis when it runs past the pill. */
  .swap-name {
    min-width: 0;
    min-height: 0;
    max-height: 100%;
    overflow: hidden;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1rem;
    font-weight: var(--font-weight-medium);
    color: var(--btn-tint);
  }

  /* ---- Lying flat: one touch row as wide as its host gives it. No inset —
     the view that places it owns the space around it. */
  .swap-control[data-orientation='horizontal'] {
    padding: 0;
    min-width: 0;
  }
  [data-orientation='horizontal'] .swap-pill {
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
    height: var(--height-touch, 44px);
    padding: 0 0.5rem;
  }
  [data-orientation='horizontal'] .swap-name {
    max-height: none;
    max-width: 100%;
    writing-mode: horizontal-tb;
    transform: none;
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
    border: 1px solid var(--button-frame, var(--line-strong));
    box-shadow: none;
  }
  :global([data-grammar="flat"]) button.swap-pill:active {
    background: var(--secondary);
  }
  @media (hover: hover) {
    :global([data-grammar="flat"]) button.swap-pill:hover {
      background: var(--secondary);
    }
  }
</style>
