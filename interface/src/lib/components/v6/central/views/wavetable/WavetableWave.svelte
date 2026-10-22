<script lang="ts">
  /**
   * One cycle of an oscillator's wave, drawn across an XY pad behind its
   * handle (the pad's `background` snippet). Visual only: the pad keeps the
   * gesture. Stroked like FilterCurve (a 2px line over a faint wider echo)
   * and held to the middle band of the pad so the title stays readable.
   */
  interface Props {
    cycle: ArrayLike<number> | null;
    color: string;
  }

  let { cycle, color }: Props = $props();

  const W = 300;
  const H = 300;
  /** Half the band the wave fills, as a fraction of the pad's height. */
  const AMPLITUDE = 0.32;

  let path = $derived.by(() => {
    if (!cycle || cycle.length < 2) return '';
    const n = cycle.length;
    let d = '';
    // One more point than the cycle holds, so the wave closes at the right edge.
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * W;
      const y = H / 2 - cycle[i % n] * AMPLITUDE * H;
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return d;
  });
</script>

{#if path}
  <svg class="wavetable-wave" viewBox="0 0 {W} {H}" preserveAspectRatio="none" style="--wave-color: {color};" aria-hidden="true">
    <path d={path} class="wave-echo" fill="none" stroke-width="5" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
    <path d={path} class="wave-line" fill="none" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
  </svg>
{/if}

<style>
  .wavetable-wave {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 1;
  }

  .wave-echo {
    stroke: var(--wave-color);
    opacity: 0.18;
  }

  .wave-line {
    stroke: var(--wave-color);
    opacity: 0.75;
  }
</style>
