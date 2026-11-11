<script lang="ts" module>
  /**
   * Operator's 11 algorithms as Live draws them: one square per oscillator
   * on an 8-unit grid, a modulator above the oscillator it feeds, the
   * carriers on the bottom row. Read off Live's own algorithm strip
   * (2026-11-05), in [col, row] per oscillator A, B, C, D.
   */
  type Cell = [number, number];
  export const OPERATOR_ALGORITHMS: ReadonlyArray<readonly [Cell, Cell, Cell, Cell]> = [
    [[0, 6], [0, 4], [0, 2], [0, 0]],
    [[1, 4], [1, 2], [0, 0], [2, 0]],
    [[1, 4], [0, 2], [0, 0], [2, 2]],
    [[1, 4], [0, 2], [2, 2], [1, 0]],
    [[2, 4], [0, 4], [1, 2], [1, 0]],
    [[0, 4], [2, 4], [2, 2], [2, 0]],
    [[2, 2], [0, 0], [2, 0], [4, 0]],
    [[0, 2], [0, 0], [2, 2], [2, 0]],
    [[0, 2], [2, 2], [4, 2], [2, 0]],
    [[0, 2], [2, 2], [4, 2], [4, 0]],
    [[0, 0], [2, 0], [4, 0], [6, 0]]
  ];
  /** Live's oscillator colors, A to D. */
  export const OPERATOR_OSC_COLORS = ['#dfd850', '#68d3cc', '#6771ee', '#e37c37'] as const;
</script>

<script lang="ts">
  /**
   * The current algorithm, drawn behind an XY pad (its `background`
   * snippet): an oscillator that is on is a filled square, one that is
   * off an outline. Visual only: the pad keeps the gesture.
   */
  interface Props {
    /** Algorithm, 0..10. */
    algorithm: number;
    /** Osc-A On … Osc-D On. */
    on: readonly [boolean, boolean, boolean, boolean];
    /** Draw at the scale of the widest algorithm, so a row of them share one square size (the Algorithm pick). */
    uniform?: boolean;
  }

  let { algorithm, on, uniform = false }: Props = $props();

  const SQ = 10 / 8; // a square in grid units (Live: 10px on an 8px grid)
  let cells = $derived(OPERATOR_ALGORITHMS[Math.min(10, Math.max(0, Math.round(algorithm)))]);
  /** The widest and tallest any algorithm reaches: 6 grid units, plus a square. */
  const FULL = Math.max(...OPERATOR_ALGORITHMS.flat().flat()) + SQ;
  let box = $derived.by(() => {
    const cols = Math.max(...cells.map((c) => c[0])) + SQ;
    const rows = Math.max(...cells.map((c) => c[1])) + SQ;
    const side = uniform ? FULL : Math.max(cols, rows);
    return { x: (cols - side) / 2, y: (rows - side) / 2, side };
  });
</script>

<div class="op-alg" aria-hidden="true" data-operator-algorithm={Math.round(algorithm)}>
  <svg viewBox="{box.x - 0.5} {box.y - 0.5} {box.side + 1} {box.side + 1}">
    {#each cells as [col, row], i (i)}
      <rect
        x={col + 0.06}
        y={row + 0.06}
        width={SQ - 0.12}
        height={SQ - 0.12}
        fill={on[i] ? OPERATOR_OSC_COLORS[i] : 'none'}
        stroke={OPERATOR_OSC_COLORS[i]}
        data-osc={'ABCD'[i]}
        data-on={on[i] ? '1' : '0'}
      />
    {/each}
  </svg>
</div>

<style>
  .op-alg {
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

  .op-alg svg {
    width: 55cqmin;
    height: 55cqmin;
  }

  .op-alg rect {
    stroke-width: 1.5px;
    vector-effect: non-scaling-stroke;
  }
</style>
