<script lang="ts">
  import { press } from '$lib/actions/press';
  import { Portal } from 'bits-ui';
  import type { Snippet } from 'svelte';
  /**
   * ChoicePicker — one value out of a list, picked from a grid that opens
   * over the central view (2026-11-06, Drift's modulation sources).
   *
   * Closed, it is a field naming the current choice ("Env 2 ▾"), small
   * enough to sit under a knob as its caption. With `caption` it also says
   * what it picks, in small type over the value ("Wave" over "Sine"), so a
   * board of many picks needs no name beside each (ADR-516). Its height is
   * `--picker-h` (2.25rem; a board sets the touch floor). Open, a scrim
   * covers the nearest positioned ancestor (the central view) and the
   * options stand in a grid of touch-size cells; a tap picks and closes, a
   * tap on the scrim closes. For lists a tab cannot hold in a column:
   * Drift's twelve matrix targets, its eight sources under every amount.
   *
   * The open grid is moved INTO that ancestor (a portal), not left beside
   * the field: on a full-screen board the field sits in a rounded,
   * `overflow: hidden` tile, and Safari clips an absolute child to it even
   * though the tile is not its containing block, so on the iPad the scrim
   * dimmed the tile and the grid never showed (2026-11-10, Operator's
   * Algorithm). Chromium draws it either way.
   */
  interface Props {
    options: readonly string[];
    /** The chosen index, or -1 / undefined when unknown. */
    selected: number | undefined;
    onSelect: (index: number) => void;
    /** What is being picked, for the open grid's title and assistive tech. */
    label: string;
    tint: string;
    ghost?: boolean;
    /** Drawn small over the value inside the field: what the pick is. */
    caption?: string;
    /** A picture of option i, drawn in its cell over its name (Operator's algorithms). */
    art?: Snippet<[number]>;
  }

  let { options, selected, onSelect, label, tint, ghost = false, caption, art }: Props = $props();

  let open = $state(false);
  let field: HTMLButtonElement | undefined = $state();
  /** The box the open grid covers: the field's nearest positioned ancestor. */
  let host = $derived.by(() => {
    if (!open || !field) return undefined;
    for (let el = field.parentElement; el; el = el.parentElement) {
      if (getComputedStyle(el).position !== 'static') return el;
    }
    return document.body;
  });
  let current = $derived(selected !== undefined && selected >= 0 ? options[selected] : undefined);
  let cols = $derived(options.length > 8 ? 4 : options.length > 4 ? 4 : options.length);

  function pick(i: number) {
    open = false;
    if (i !== selected) onSelect(i);
  }
</script>

<button
  bind:this={field}
  class="picker-button"
  class:ghost
  class:captioned={!!caption}
  style="--picker-tint: {tint};"
  aria-label="{label}: {current ?? 'unknown'}"
  aria-haspopup="dialog"
  disabled={ghost}
  use:press={{ onPress: () => (open = true), disabled: ghost }}
>
  {#if caption}<span class="picker-caption">{caption}</span>{/if}
  {#if art && current !== undefined && selected !== undefined}
    <!-- A pictured pick shows its picture closed too, not just its name. -->
    <span class="picker-line picker-line-art"><span class="picker-field-art" aria-hidden="true">{@render art(selected)}</span><span class="picker-caret" aria-hidden="true">▾</span></span>
  {:else}
    <span class="picker-line"><span class="picker-value">{current ?? '—'}</span><span class="picker-caret" aria-hidden="true">▾</span></span>
  {/if}
</button>

{#if open && host}
  <Portal to={host}>
  <div class="picker-scrim" role="presentation" use:press={{ onPress: () => (open = false) }}></div>
  <div class="picker-sheet" role="dialog" aria-label={label} style="--picker-tint: {tint};">
    <div class="picker-title">{label}</div>
    <div class="picker-grid" role="radiogroup" style="grid-template-columns: repeat({cols}, minmax(0, 1fr));">
      {#each options as option, i (i)}
        <button
          class="physical-button picker-option"
          class:pictured={!!art}
          class:active={i === selected}
          role="radio"
          aria-checked={i === selected}
          style="--btn-tint: {tint};"
          use:press={{ onPress: () => pick(i) }}
        >{#if art}<span class="picker-art" aria-hidden="true">{@render art(i)}</span><span class="picker-art-name">{option}</span>{:else}{option}{/if}</button>
      {/each}
    </div>
  </div>
  </Portal>
{/if}

<style>
  .picker-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.125rem;
    width: 100%;
    height: var(--picker-h, 2.25rem);
    min-width: 0;
    padding: 0 0.5rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-well);
    color: var(--picker-tint);
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.1;
    white-space: nowrap;
    cursor: pointer;
  }
  .picker-button.ghost {
    opacity: var(--opacity-ghost);
    cursor: default;
  }
  /* A board's columns are narrow: the field keeps its padding small. */
  :global([data-instrument-board]) .picker-button {
    padding: 0 0.25rem;
  }
  /* The field's name, small and quiet over its value. */
  .picker-caption {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.625rem;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: var(--signal-dim);
  }
  .picker-line {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    min-width: 0;
    max-width: 100%;
  }
  .picker-value {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  /* The closed field's picture takes the line's whole height. */
  .picker-line-art {
    align-self: stretch;
    flex: 1 1 0;
    min-height: 0;
    padding: 0.125rem 0;
  }
  .picker-field-art {
    position: relative;
    align-self: stretch;
    flex: 1 1 0;
    min-width: 0;
  }
  .picker-field-art :global(.op-alg) {
    opacity: 1;
  }
  .picker-field-art :global(.op-alg svg) {
    width: 100cqmin;
    height: 100cqmin;
  }
  .picker-caret {
    flex: none;
    font-size: 0.625rem;
    opacity: 0.6;
  }
  .picker-scrim {
    position: absolute;
    inset: 0;
    background: var(--scrim, rgb(0 0 0 / 0.55));
    z-index: 20;
  }
  .picker-sheet {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(32rem, 90%);
    max-height: 90%;
    overflow: auto;
    z-index: 21;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    padding: var(--central-inset);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-raised, var(--background));
  }
  .picker-title {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--picker-tint);
    text-align: center;
  }
  .picker-grid {
    display: grid;
    gap: var(--spacing-sm);
  }
  .picker-option {
    min-height: var(--height-touch);
    font-size: 0.8125rem;
  }
  /* A pictured option: the picture over its name, the cell square enough to read it. */
  .picker-option.pictured {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    min-height: 7rem;
    padding: 0.5rem 0.25rem 0.375rem;
  }
  /* The current one keeps its dark cell, so the picture's own colors read
     (an orange fill hid Osc D): a ring in the ON color and its name lit. */
  :global([data-grammar="flat"]) .picker-option.pictured.active {
    background: var(--surface-well);
    border-color: var(--phosphor);
    box-shadow: inset 0 0 0 1px var(--phosphor);
    color: var(--phosphor);
  }
  .picker-art {
    position: relative;
    flex: 1 1 0;
    width: 100%;
    min-height: 0;
  }
  .picker-art :global(.op-alg) {
    opacity: 1;
  }
  .picker-art :global(.op-alg svg) {
    width: 100cqmin;
    height: 100cqmin;
  }
  .picker-art-name {
    flex: none;
    font-size: 0.75rem;
    line-height: 1;
  }
</style>
