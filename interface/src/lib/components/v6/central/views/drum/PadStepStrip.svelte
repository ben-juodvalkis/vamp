<script lang="ts">
  /**
   * PadStepStrip — a pad's own Permute at tile scale (ADR-435, 2026-09-14).
   *
   * Two hairline rows at the foot of a pad tile: the mute pattern in the
   * tile's own ink, the pitch pattern in the pitch blue, the running step
   * lifted — the strip's `MiniSequencer` reduced to what a 68px tile can
   * carry. Presentational only: the tile owns the pointer, and this sits
   * under it (`pointer-events: none`). A row that does nothing (no mute
   * step off, no pitch step on) recedes, as it does on the strip.
   */
  import type { TinySequencerState } from '$lib/components/v6/tracks/composables/useTinySequencer.svelte';

  interface Props {
    state: TinySequencerState;
  }

  let { state }: Props = $props();
</script>

<div class="pad-steps" aria-hidden="true" data-pad-steps>
  <div class="row" class:inert={!state.mute.enabled}>
    {#each Array(state.mute.length) as _, i}
      <span class="cell mute" class:on={state.mute.pattern[i]} class:now={state.mute.position === i}></span>
    {/each}
  </div>
  <div class="row" class:inert={!state.pitch.enabled}>
    {#each Array(state.pitch.length) as _, i}
      <span class="cell pitch" class:on={state.pitch.pattern[i]} class:now={state.pitch.position === i}></span>
    {/each}
  </div>
</div>

<style>
  .pad-steps {
    position: absolute;
    left: 5px;
    right: 5px;
    bottom: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    pointer-events: none;
  }
  .row {
    display: flex;
    gap: 1px;
    height: 3px;
    transition: opacity 160ms var(--ease-settle);
  }
  .row.inert {
    opacity: 0.35;
  }
  .cell {
    flex: 1;
    min-width: 0;
    border-radius: 1px;
    background: color-mix(in srgb, currentColor, transparent 80%);
    transition: background-color 120ms var(--ease-settle);
  }
  .cell.mute.on {
    background: currentColor;
  }
  .cell.pitch.on {
    background: var(--act-pitch);
  }
  /* The running step: lifted towards white, on or off. */
  .cell.now {
    background: color-mix(in srgb, currentColor, white 45%);
  }
  .cell.pitch.now.on {
    background: color-mix(in oklab, var(--act-pitch) 60%, white);
  }
</style>
