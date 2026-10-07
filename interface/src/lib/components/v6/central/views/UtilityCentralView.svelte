<script lang="ts">
  /**
   * UtilityCentralView - Slot-Aware Version
   *
   * Self-contained central view that queries its own slot state.
   * Renders immediately with ghost/loading/active states.
   *
   * NO {#if device} gate - always renders, controls handle their own state.
   * NO props required - queries its slot internally.
   *
   * What is left here is the Gate. Every Compressor control this view used
   * to carry — the sidechain source grid and its cutoff, the Makeup auto
   * toggle and its output gain, the Compressor module — moved to
   * `SquashCentralView` on 2026-09-11 (user's call): the Gain tile was
   * opening a compressor, and the Squash tile, which IS the dynamics
   * column, opened this same view through a registry alias. Squash is the
   * dynamics view now; this one is the Gain tile's.
   *
   * The Glue Compressor left earlier, for a full-height FX-grid column
   * beside Gain (2026-09-10, ADR-431 addendum).
   */

  import GateControl from '../../device-panel/GateControl.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

  const gate = useFxGridSlot('gate');
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="utility-central-layout relative">
  <div class="device-wrapper gate-section" class:slot-ghost={gate.isGhost}>
    <GateControl device={gate.device} icon="gate" xIcon="release" yIcon="threshold" />
  </div>
</div>

<style>
  .utility-central-layout {
    display: grid;
    /* One module. It keeps roughly the third of the width it had beside
       the compressor sections rather than stretching to 1366px — a Gate
       XY pad that wide is a different control to aim at, and this view is
       expected to grow back. */
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  .device-wrapper {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0; /* Allow shrinking below content size */
  }

  .gate-section {
    min-height: 0;
    width: 100%;
    max-width: 480px;
  }
</style>
