<script lang="ts">
  /**
   * GateCentralView — the Gate's view (slot `gate`).
   *
   * The Gate's pad (`GateControl`, threshold × release) at the view's full
   * size. Split out of the shared dynamics view (`SquashCentralView`) when
   * the FX chain overview gave every device its own view (ADR-478).
   *
   * Self-contained: queries its own slot state, takes no props, and
   * renders through ghost/loading/active without a `{#if device}` gate —
   * `GateControl` handles its own slot state.
   */

  import GateControl from '../../device-panel/GateControl.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

  const gate = useFxGridSlot('gate');
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="gate-central-layout relative">
  <div class="device-wrapper gate-body" class:slot-ghost={gate.isGhost}>
    <GateControl device={gate.device} icon="gate" />
  </div>
</div>

<style>
  .gate-central-layout {
    display: flex;
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

  .gate-body {
    flex: 1;
  }
</style>
