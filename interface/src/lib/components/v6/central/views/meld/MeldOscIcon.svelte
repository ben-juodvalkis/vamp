<script lang="ts">
  /**
   * Meld's oscillator type as its mark, drawn behind an XY pad's handle
   * (the pad's `background` snippet). Visual only: the pad keeps the
   * gesture. Centered, a fixed share of the pad's shorter side.
   */
  import { MELD_OSC_ICONS, MELD_OSC_ICON_VIEWBOX } from './meldOscIcons';

  interface Props {
    /** A/B Osc Type, 0..24. */
    type: number;
    color: string;
    /** The pad's title sits at its foot: lift the mark clear of it. */
    raised?: boolean;
  }

  let { type, color, raised = false }: Props = $props();

  let markup = $derived(MELD_OSC_ICONS[Math.round(type)] ?? '');
</script>

{#if markup}
  <div class="meld-osc-icon" class:raised style="color: {color};" aria-hidden="true">
    <svg viewBox={MELD_OSC_ICON_VIEWBOX} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      {@html markup}
    </svg>
  </div>
{/if}

<style>
  .meld-osc-icon {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 1;
    container-type: size;
    opacity: 0.75;
  }

  .meld-osc-icon.raised {
    bottom: 22%;
  }

  .meld-osc-icon svg {
    width: 55cqmin;
    height: 55cqmin;
  }

  .meld-osc-icon svg :global(*) {
    vector-effect: non-scaling-stroke;
  }
</style>
