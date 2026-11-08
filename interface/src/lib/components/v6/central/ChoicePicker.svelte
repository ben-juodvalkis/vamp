<script lang="ts">
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
  }

  let { options, selected, onSelect, label, tint, ghost = false, caption }: Props = $props();

  let open = $state(false);
  let current = $derived(selected !== undefined && selected >= 0 ? options[selected] : undefined);
  let cols = $derived(options.length > 8 ? 4 : options.length > 4 ? 4 : options.length);

  function pick(i: number) {
    open = false;
    if (i !== selected) onSelect(i);
  }
</script>

<button
  class="picker-button"
  class:ghost
  class:captioned={!!caption}
  style="--picker-tint: {tint};"
  aria-label="{label}: {current ?? 'unknown'}"
  aria-haspopup="dialog"
  disabled={ghost}
  onclick={() => (open = true)}
>
  {#if caption}<span class="picker-caption">{caption}</span>{/if}
  <span class="picker-line"><span class="picker-value">{current ?? '—'}</span><span class="picker-caret" aria-hidden="true">▾</span></span>
</button>

{#if open}
  <div class="picker-scrim" role="presentation" onclick={() => (open = false)}></div>
  <div class="picker-sheet" role="dialog" aria-label={label} style="--picker-tint: {tint};">
    <div class="picker-title">{label}</div>
    <div class="picker-grid" role="radiogroup" style="grid-template-columns: repeat({cols}, minmax(0, 1fr));">
      {#each options as option, i (i)}
        <button
          class="physical-button picker-option"
          class:active={i === selected}
          role="radio"
          aria-checked={i === selected}
          style="--btn-tint: {tint};"
          onclick={() => pick(i)}
        >{option}</button>
      {/each}
    </div>
  </div>
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
</style>
