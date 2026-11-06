<script lang="ts" generics="T">
  /**
   * A segmented tab a finger can SCRUB (2026-11-05): press anywhere on it
   * and the choice follows the finger across the options, a row, a column
   * or a grid, instead of a separate tap per step. Every pick-one tab in
   * the central views is one of these; Drift's octave strip and Echo's wave
   * grid each wired the pattern by hand before (user, 2026-09-12: "can I
   * slide my finger to scrub octaves?").
   *
   * The tab owns the pointer through `use:drag` and finds the option under
   * the finger by geometry (`segmentScrub`), so the hairlines between
   * options belong to an option rather than being dead bands. The options
   * stay real buttons for the keyboard and their accessible names, with
   * `pointer-events: none` so they never compete with the tab; Enter still
   * picks one. `onSelect` fires once per option the finger crosses, and
   * not for a press on the option already chosen.
   *
   * Drawn as the house `.seg-grid` (ADR-474): one frame, hairlines between
   * the options, the chosen one lit in `tint`. Size the options' type with
   * `--scrub-font-size`, `--scrub-font-weight` and `--scrub-padding` on
   * `style`: a host's own classes do not reach inside (Svelte scopes them).
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
    /** The finger lifted, the gesture was cancelled, or a key picked. */
    onDone?: () => void;
    /** Columns; a column is `cols={1}`. */
    cols?: number;
    /** Rows; by default as many as the options (and the lead) fill. */
    rows?: number;
    tint?: string;
    /** Each option's accessible name. */
    label: (option: T, index: number) => string;
    /** What an option shows; its label when absent. */
    item?: Snippet<[T, number]>;
    /**
     * A cell ahead of the options, not one of them (Drift's OSC 1/2 badge):
     * a scrub across it picks nothing, and what it holds keeps its own tap.
     */
    lead?: Snippet;
    /** The options' words in the tab's ink at rest, not the house colour. */
    inked?: boolean;
    /** Radio semantics, named so (Shifter's Mode, Stereo). */
    groupLabel?: string;
    /** `data-tab` on the frame, for tests and shot steps. */
    name?: string;
    class?: string;
    style?: string;
    ghost?: boolean;
  }

  let {
    options,
    selected,
    onSelect,
    onDone,
    cols = options.length,
    rows,
    tint,
    label,
    item,
    lead,
    inked = false,
    groupLabel,
    name,
    class: frameClass = '',
    style = '',
    ghost = false
  }: Props = $props();

  let leadCells = $derived(lead ? 1 : 0);
  let rowCount = $derived(rows ?? Math.max(1, Math.ceil((options.length + leadCells) / Math.max(1, cols))));
  let frame = $state<HTMLElement | null>(null);
  let box: ScrubBox | null = null;
  /** The option this gesture last landed on, so it needs no echo to hold still. */
  let last = -1;

  function at(info: DragInfo) {
    if (!box) return;
    const index = gridCellIndex(info.x, info.y, box, cols, rowCount) - leadCells;
    if (index < 0 || index >= options.length || index === last) return;
    const first = last === -1;
    last = index;
    // A press on the option already chosen changes nothing; a drag back
    // onto it later in the gesture does.
    if (first && index === selected) return;
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
  class:scrub-inked={inked}
  role={groupLabel ? 'radiogroup' : undefined}
  aria-label={groupLabel}
  data-tab={name}
  style="--btn-tint: {tint ?? 'var(--phosphor)'}; grid-template-columns: repeat({cols}, minmax(0, 1fr)); grid-template-rows: repeat({rowCount}, minmax(0, 1fr)); {style}"
  bind:this={frame}
  use:drag={{ commit: 'immediate', onDown: down, onMove: at, onEnd: () => onDone?.() }}
>
  {#if lead}<div class="scrub-lead">{@render lead()}</div>{/if}
  {#each options as option, index}
    <button
      class="device-segment scrub-option"
      class:active={index === selected}
      title={label(option, index)}
      aria-label={label(option, index)}
      role={groupLabel ? 'radio' : undefined}
      aria-checked={groupLabel ? index === selected : undefined}
      aria-pressed={groupLabel ? undefined : index === selected}
      onclick={() => {
        if (index !== selected) onSelect(index, option);
        onDone?.();
      }}
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
    padding: var(--scrub-padding, 2px);
    font-size: var(--scrub-font-size, 0.75rem);
    font-weight: var(--scrub-font-weight, 600);
    font-variant-numeric: tabular-nums;
    text-align: center;
    line-height: 1.15;
  }
  /* The lead's cell, on the tab's own field. */
  .scrub-lead {
    background: var(--surface-well);
    min-width: 0;
    min-height: 0;
  }
  .scrub-ghost {
    opacity: var(--opacity-ghost);
  }

  /* ---- Flat grammar: an inked tab's words wear its colour at rest, so the
     colour reads before anything is chosen (where the colour is the
     meaning: an oscillator, an engine, the device's own ink). The lit
     option is `--btn-tint` either way (app.css `.seg-grid`). */
  :global([data-grammar="flat"]) .scrub-inked .scrub-option:not(.active) {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
  :global([data-grammar="flat"]) .scrub-inked .scrub-option:hover:not(.active) {
    color: var(--btn-tint);
  }
</style>
