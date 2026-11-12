<script lang="ts">
  /**
   * A rack chain's cell face (ADR-529): its volume drawn as a track strip
   * draws its fader — the level a wash of the chain's colour from the foot,
   * edge ticks at the level on both rails, a hairline at 0 dB. Drawing only:
   * the cell's own drag sets the volume, so the name above it drags too.
   */
  interface Props {
    /** 0..1, Live's chain volume. */
    volume: number;
    /** Where 0 dB sits on that scale. */
    unity: number;
  }

  let { volume, unity }: Props = $props();
  const v = $derived(Math.max(0, Math.min(1, volume)));
</script>

<div class="chain-strip-face" style="--v: {v}; --unity: {unity};" data-debug="chain-volume" aria-hidden="true">
  <span class="wash"></span>
  <span class="unity"></span>
  <span class="tick left"></span>
  <span class="tick right"></span>
</div>

<style>
  .chain-strip-face {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    border-radius: 3px;
    background: var(--surface-well, rgb(0 0 0 / 0.3));
    overflow: hidden;
    touch-action: none;
  }
  .wash {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: calc(var(--v) * 100%);
    background: color-mix(in oklab, var(--cell-ink) 38%, transparent);
  }
  .unity {
    position: absolute;
    left: 20%;
    right: 20%;
    bottom: calc(var(--unity) * 100%);
    height: 1px;
    background: var(--fg-tertiary);
  }
  /* The strip's edge ticks (ADR-384): two short marks on the rails at the level. */
  .tick {
    position: absolute;
    bottom: calc(var(--v) * 100% - 1px);
    width: 30%;
    height: 2px;
    background: var(--cell-ink);
  }
  .tick.left {
    left: 0;
  }
  .tick.right {
    right: 0;
  }
</style>
