<script lang="ts">
  /**
   * VmSlot — the wrapper around one virtual-macro control (ADR-428,
   * Milestone 1b), split out of the Drum Rack view on 2026-09-10 so every
   * row draws its slots the same way.
   *
   * `vm-none` (the kit — or the held pad — has no member for the function)
   * rides the same ghost dim every empty device slot uses and takes no
   * pointer input; `vm-held` (every member is macro-held) keeps the
   * control's ink and value — it is a true reading — but takes no input
   * either, and wears a small badge saying why ("macro", or "31/32 macro"
   * when only some members are held and the control still moves the
   * free ones). A coverage badge (some pads lack a rack macro) sits
   * top-left so it never hides under a held badge. The control inside
   * stays unaware of any of it.
   *
   * `data-vm-state` / `data-vm-function` / `data-vm-macro` are what the
   * tests and the shot recipes read.
   */
  import type { Snippet } from 'svelte';
  import { Lock } from '@lucide/svelte';
  import type { VmState } from '$lib/services/drumVirtualMacros';

  interface Props {
    state: VmState;
    /** The function(s) the control drives, for `data-vm-function` ("filterFreq|filterRes"). */
    fn?: string;
    /** The rack macro name(s), for `data-vm-macro`. */
    macro?: string;
    /** "held by macro" text, or nothing. */
    badge?: string | null;
    /** "pads reached" text, or nothing. */
    coverage?: string | null;
    class?: string;
    children: Snippet;
  }

  let { state, fn, macro, badge = null, coverage = null, class: klass = '', children }: Props = $props();
</script>

<div
  class="vm-slot {klass}"
  class:vm-none={state === 'none'}
  class:vm-held={state === 'held'}
  data-vm-state={state}
  data-vm-function={fn}
  data-vm-macro={macro}
>
  {@render children()}
  {#if badge}
    <span class="vm-held-badge" aria-label="held by macro">
      <Lock size={9} strokeWidth={2.5} aria-hidden="true" />{badge}
    </span>
  {/if}
  {#if coverage}
    <span class="vm-held-badge vm-coverage-badge" aria-label="pads reached">{coverage}</span>
  {/if}
</div>

<style>
  .vm-slot {
    position: relative;
  }
  .vm-slot.vm-none {
    opacity: var(--opacity-ghost);
    pointer-events: none;
  }
  .vm-slot.vm-held {
    pointer-events: none;
  }
  .vm-slot.vm-held > :global(*:not(.vm-held-badge)) {
    opacity: 0.8;
  }
  /* The badge's face is the global `.vm-held-badge` (app.css); the slot
     pins it to its corner. */
  .vm-held-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 2;
  }
  .vm-coverage-badge {
    left: 6px;
    right: auto;
  }
</style>
