<script lang="ts" generics="T">
  /**
   * A segmented tab a finger can SCRUB (2026-11-05): press anywhere on it
   * and the choice follows the finger across the options, a row, a column
   * or a grid, instead of a separate tap per step. The pattern Drift's
   * octave strip and Echo's wave grid each wired by hand (user, 2026-09-12:
   * "can I slide my finger to scrub octaves?").
   *
   * The tab owns the pointer through `use:drag` and finds the option under
   * the finger by geometry (`segmentScrub`), so the hairlines between
   * options belong to an option rather than being dead bands. The options
   * stay real buttons for the keyboard and their accessible names, with
   * `pointer-events: none` so they never compete with the tab; Enter still
   * picks one. Only a change of option reaches `onSelect`: a scrub crosses
   * many frames inside one option.
   *
   * Drawn as the house `.seg-grid` (ADR-474): one frame, hairlines between
   * the options, the chosen one lit in `tint`.
   */
  import type { Snippet } from 'svelte';
  import { drag } from '$lib/actions';
  import type { DragInfo } from '$lib/actions/drag';
  import { gridCellIndex, scrubBoxOf, type ScrubBox } from '$lib/utils/segmentScrub';

  interface Props {
    options: readonly T[];
    /** The chosen option's index, -1 for none. */
    selected: number;
    onSelect: (index: number, option: T) => void;
    /** Columns; rows follow from the option count. A column is `cols={1}`. */
    cols?: number;
    tint?: string;
    /** Each option's accessible name. */
    label: (option: T, index: number) => string;
    /** What an option shows; its label's text when absent. */
    item?: Snippet<[T, number]>;
    /** Classes on the frame (size, flex) and on each option (type size). */
    class?: string;
    optionClass?: string;
    ghost?: boolean;
  }

  let {
    options,
    selected,
    onSelect,
    cols = options.length,
    tint,
    label,
    item,
    class: frameClass = '',
    optionClass = '',
    ghost = false
  }: Props = $props();

  let rows = $derived(Math.max(1, Math.ceil(options.length / Math.max(1, cols))));
  let frame = $state<HTMLElement | null>(null);
  let box: ScrubBox | null = null;
  /** The option this gesture last sent, so it needs no echo to hold still. */
  let last = -1;

  function at(info: DragInfo) {
    if (!box) return;
    const index = gridCellIndex(info.x, info.y, box, cols, rows);
    if (index < 0 || index >= options.length || index === last) return;
    const pressed = last === -1;
    last = index;
    // A press on the option already chosen changes nothing; a drag back
    // onto it later in the gesture does.
    if (pressed && index === selected) return;
    onSelect(index, options[index]);
  }

  function down(info: DragInfo) {
    box = scrubBoxOf(frame);
    last = -1;
    at(info);
  }
</script>

<div
  class="device-segmented seg-grid scrub-tabs {frameClass}"
  class:scrub-ghost={ghost}
  style="--btn-tint: {tint ?? 'var(--phosphor)'}; grid-template-columns: repeat({cols}, minmax(0, 1fr)); grid-template-rows: repeat({rows}, minmax(0, 1fr));"
  bind:this={frame}
  use:drag={{ commit: 'immediate', onDown: down, onMove: at }}
>
  {#each options as option, index}
    <button
      class="device-segment scrub-option {optionClass}"
      class:active={index === selected}
      aria-label={label(option, index)}
      aria-pressed={index === selected}
      onclick={() => index !== selected && onSelect(index, option)}
    >
      {#if item}{@render item(option, index)}{:else}{label(option, index)}{/if}
    </button>
  {/each}
</div>

<style>
  .scrub-tabs {
    display: grid;
    min-width: 0;
    min-height: 0;
  }
  /* The tab owns the pointer; the options are its face. */
  .scrub-option {
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: 0;
    padding: 2px;
    font-size: 0.75rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .scrub-ghost {
    opacity: var(--opacity-ghost);
  }

  /* ---- Flat grammar: the options' text in the tab's ink, so the colour
     reads before anything is chosen (Drift's and Wavetable's rows). */
  :global([data-grammar="flat"]) .scrub-option {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
  :global([data-grammar="flat"]) .scrub-option.active {
    background: var(--btn-tint);
    color: var(--flat-on-fg);
  }
</style>
