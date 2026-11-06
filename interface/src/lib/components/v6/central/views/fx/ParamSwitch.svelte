<script lang="ts">
  /**
   * An on/off switch on one effect parameter, lit in the device's ink while
   * on (the Redux view's switch, shared by the effect views built on Live's
   * panels, 2026-11-06). A ghost's first press loads the device.
   */
  interface Props {
    label: string;
    on: boolean;
    tint: string;
    onToggle: () => void;
    ghost?: boolean;
    /** One touch row tall rather than an equal share of its column (a switch under a graph or a tab). */
    row?: boolean;
  }

  let { label, on, tint, onToggle, ghost = false, row = false }: Props = $props();
</script>

<button
  class="physical-button param-switch w-full"
  class:active={on}
  class:slot-ghost={ghost}
  class:row
  style="--btn-tint: {tint};"
  aria-pressed={on}
  onclick={onToggle}
>{label}</button>

<style>
  .param-switch {
    flex: 1 1 0;
    min-height: var(--height-touch);
  }
  .param-switch.row {
    flex: 0 0 var(--height-touch);
  }
  .param-switch {
    font-size: 0.9375rem;
    font-weight: 600;
  }

  :global([data-grammar="flat"]) .param-switch {
    font-weight: var(--font-weight-medium);
  }
  :global([data-grammar="flat"]) .param-switch.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }
  :global([data-grammar="flat"]) .param-switch:not(.active) {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
</style>
