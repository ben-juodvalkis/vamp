<script lang="ts" module>
  /** An envelope's parameters by Live name; any level left out is drawn at its default. */
  export interface EnvelopeNames {
    attack: string;
    decay: string;
    sustain: string;
    release: string;
    /** The level the attack starts from (0 when absent). */
    initial?: string;
    /** The level the attack reaches (1 when absent). */
    peak?: string;
    /** The level the release falls to (0 when absent). */
    final?: string;
  }

  /** Where each breakpoint sits, in 0..1 of the graph's width and height (0 the top). */
  export interface EnvelopeShape {
    start: { x: number; y: number };
    peak: { x: number; y: number };
    sustain: { x: number; y: number };
    hold: { x: number; y: number };
    end: { x: number; y: number };
  }

  /**
   * The picture, from the stages' values as 0..1 over their own ranges. The
   * width is four slots, Ableton's own reading: attack and decay each take up
   * to one, the sustain holds to the start of the last, and release takes up
   * to that one. A time of zero is a vertical edge, as Live draws it.
   */
  export function envelopeShape(v: { a: number; d: number; s: number; r: number; i?: number; p?: number; f?: number }): EnvelopeShape {
    const Q = 0.25;
    const lvl = (x: number) => 1 - Math.max(0, Math.min(1, x));
    const xa = v.a * Q;
    const xd = xa + v.d * Q;
    const xh = 3 * Q;
    return {
      start: { x: 0, y: lvl(v.i ?? 0) },
      peak: { x: xa, y: lvl(v.p ?? 1) },
      sustain: { x: xd, y: lvl(v.s) },
      hold: { x: xh, y: lvl(v.s) },
      end: { x: xh + v.r * Q, y: lvl(v.f ?? 0) }
    };
  }
</script>

<script lang="ts">
  /**
   * EnvelopeGraph — an envelope as Live draws it (ADR-514): the line through
   * its breakpoints on a dark display, the breakpoints squares a finger
   * drags. The attack's square moves Attack across and Peak up, the decay's
   * Decay across and Sustain up, the release's Release across and Final up,
   * and the start's Initial up. A drag is relative, from where the finger
   * lands, and goes to the square nearest it however far off, so a finger
   * never has to land on a 10px mark. While a square moves, its values read
   * over the graph in Live's words.
   *
   * Values ride `PanelParams`, so a name the device does not list draws at
   * its default and its square moves nothing; a section that is off ghosts
   * the graph and turns on at the first drag.
   */
  import type { PanelParams } from './views/panel/usePanelParams.svelte';
  import DeviceSlider from '../device-panel/DeviceSlider.svelte';

  interface Props {
    params: PanelParams;
    names: EnvelopeNames;
    /** The line's ink. */
    ink: string;
    /** The section's switch: off ghosts the graph; a drag turns it on. */
    sw?: string;
    /** Drawn small in the top-left corner (an envelope's name). */
    label?: string;
    /**
     * Small Attack, Decay, Sustain and Release knobs under the picture (Ben,
     * 2026-11-07: the graph alone hides the numbers a knob shows at a glance);
     * `side` stands them two by two beside it, lettered; `short` keeps them
     * under it, lettered, for a picture too narrow for the words; `beside`
     * stands them two by two beside it with their whole names.
     */
    knobs?: boolean | 'side' | 'short' | 'beside';
  }

  let { params, names, ink, sw, label, knobs = true }: Props = $props();

  const STAGES = [
    ['attack', 'Attack'],
    ['decay', 'Decay'],
    ['sustain', 'Sustain'],
    ['release', 'Release']
  ] as const;
  let scheme = $derived({ primary: ink, secondary: ink, accent: ink });

  /** The cell's size; the picture keeps a landscape shape inside it (ADR-514: a tall, narrow one reads badly). */
  let cw = $state(0);
  let ch = $state(0);
  const MAX_ASPECT = 0.6;
  let w = $derived(cw);
  let h = $derived(Math.min(ch, Math.round(cw * MAX_ASPECT)));
  /** The inset around the line: a square's half and a little, less on a short strip. */
  let PAD = $derived(h > 0 && h < 90 ? 7 : 10);

  const u = (n: string | undefined, fallback: number) => (n ? (params.unit(n) ?? fallback) : fallback);

  type Handle = 'start' | 'peak' | 'sustain' | 'end';

  let shape = $derived(
    envelopeShape({
      a: u(names.attack, 0),
      d: u(names.decay, 0.5),
      s: u(names.sustain, 1),
      r: u(names.release, 0.3),
      i: names.initial ? u(names.initial, 0) : undefined,
      p: names.peak ? u(names.peak, 1) : undefined,
      f: names.final ? u(names.final, 0) : undefined
    })
  );

  const X = (x: number) => PAD + x * Math.max(0, w - 2 * PAD);
  const Y = (y: number) => PAD + y * Math.max(0, h - 2 * PAD);

  let line = $derived(
    [shape.start, shape.peak, shape.sustain, shape.hold, shape.end].map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ')
  );
  let fill = $derived(`${line} L${X(shape.end.x).toFixed(1)} ${Y(1)} L${X(0)} ${Y(1)} Z`);

  /** Each square's two parameters: across (a time) and up (a level). */
  const listed = (n: string | undefined) => (n && params.has(n) ? n : undefined);
  let handles = $derived(
    [
      { id: 'start' as Handle, at: shape.start, x: undefined, y: listed(names.initial) },
      { id: 'peak' as Handle, at: shape.peak, x: listed(names.attack), y: listed(names.peak) },
      { id: 'sustain' as Handle, at: shape.sustain, x: listed(names.decay), y: listed(names.sustain) },
      { id: 'end' as Handle, at: shape.end, x: listed(names.release), y: listed(names.final) }
    ].filter((hd) => hd.x !== undefined || hd.y !== undefined)
  );

  let on = $derived(!sw || params.isOn(sw));
  let active = $state<Handle | null>(null);
  let drag: { id: Handle; pointer: number; x0: number; y0: number; ux?: number; uy?: number } | null = null;

  function nearest(px: number, py: number): Handle | null {
    let best: Handle | null = null;
    let bd = Infinity;
    for (const hd of handles) {
      const d = Math.hypot(X(hd.at.x) - px, Y(hd.at.y) - py);
      if (d < bd) {
        bd = d;
        best = hd.id;
      }
    }
    return best;
  }

  function down(e: PointerEvent) {
    if (drag) return;
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const id = nearest(e.clientX - r.left, e.clientY - r.top);
    if (!id) return;
    const hd = handles.find((x) => x.id === id)!;
    drag = { id, pointer: e.pointerId, x0: e.clientX, y0: e.clientY, ux: hd.x ? params.unit(hd.x) : undefined, uy: hd.y ? params.unit(hd.y) : undefined };
    active = id;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const hd = handles.find((x) => x.id === drag!.id);
    if (!hd) return;
    // A slot is a quarter of the width: a drag across one sweeps a time end to end.
    const slot = Math.max(1, (w - 2 * PAD) / 4);
    const tall = Math.max(1, h - 2 * PAD);
    if (hd.x && drag.ux !== undefined) params.writeUnit(hd.x, drag.ux + (e.clientX - drag.x0) / slot, sw);
    if (hd.y && drag.uy !== undefined) params.writeUnit(hd.y, drag.uy - (e.clientY - drag.y0) / tall, sw);
  }

  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    drag = null;
    active = null;
  }

  /** What the moving square reads, in Live's words where it has them. */
  function readout(n: string | undefined): string | null {
    if (!n) return null;
    const d = params.display(n);
    if (d) return d;
    const t = params.unit(n);
    return t === undefined ? null : `${Math.round(t * 100)} %`;
  }
  let activeReadout = $derived.by(() => {
    const hd = handles.find((x) => x.id === active);
    if (!hd) return '';
    return [readout(hd.x), readout(hd.y)].filter(Boolean).join(' · ');
  });
  let ghost = $derived(!params.has(names.attack) && !params.has(names.decay));
  /** The fill gradient's id: one a graph, since several share a page. */
  const gradientId = `env-fill-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div class="env-wrap" class:with-knobs={!!knobs} class:side={knobs === 'side' || knobs === 'beside'}>
<div class="graph-cell" bind:clientWidth={cw} bind:clientHeight={ch}>
<div
  class="env-graph"
  style:height={cw > 0 ? `${h}px` : '100%'}
  class:off={!on || ghost}
  style="--env-ink: {ink};"
  data-envelope-graph={names.attack}
>
  <svg
    width={w}
    height={h}
    role="slider"
    tabindex="-1"
    aria-label="{label ?? 'Envelope'}: attack, decay, sustain, release"
    aria-valuenow={Math.round(u(names.sustain, 1) * 100)}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    style="touch-action: none;"
  >
    {#if w > 0 && h > 0}
      <defs>
        <!-- The envelope's body: its ink, fading to the floor (ADR-516). -->
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={ink} stop-opacity="0.32" />
          <stop offset="1" stop-color={ink} stop-opacity="0.04" />
        </linearGradient>
      </defs>
      <line class="floor" x1={X(0)} x2={X(1)} y1={Y(1)} y2={Y(1)} />
      {#each [0.25, 0.5] as q (q)}
        <line class="grid" x1={X(q)} x2={X(q)} y1={PAD} y2={Y(1)} />
      {/each}
      <line class="mark" x1={X(0.75)} x2={X(0.75)} y1={PAD} y2={Y(1)} />
      <path class="fill" d={fill} fill="url(#{gradientId})" />
      <path class="line" d={line} />
      {#each handles as hd (hd.id)}
        <rect
          class="handle"
          class:hot={active === hd.id}
          x={X(hd.at.x) - 6}
          y={Y(hd.at.y) - 6}
          width="12"
          height="12"
          rx="2"
          data-env-handle={hd.id}
        />
      {/each}
    {/if}
  </svg>
  {#if label}<span class="label">{label}</span>{/if}
  {#if active && activeReadout}<span class="readout">{activeReadout}</span>{/if}
</div>
</div>
{#if knobs}
  <div class="env-knobs">
    {#each STAGES as [key, title] (key)}
      {@const n = names[key]}
      {@const r = params.range(n)}
      <div class="env-knob" data-param={n}>
        <DeviceSlider
          value={params.raw(n) ?? r?.min ?? 0}
          title={knobs === 'side' || knobs === 'short' ? title[0] : title}
          face="knob"
          knobSize="s"
          min={r?.min ?? 0}
          max={r?.max ?? 1}
          orientation="vertical"
          labelSize="small"
          isGhost={!params.has(n) || !on}
          color={scheme}
          readout={params.display(n)}
          onInteraction={(v) => params.write(n, v, sw)}
        />
      </div>
    {/each}
  </div>
{/if}
</div>

<style>
  .env-wrap {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }
  .env-wrap > .graph-cell {
    flex: 1 1 0;
  }
  /* Tall enough for a small knob and its caption at full size (48px, KnobFace
     size-s), so the stages read at a glance (ADR-515: 4.5rem drew them at
     about 28px). */
  .env-knobs {
    flex: 0 0 auto;
    height: 5.875rem;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    /* A knob is 48px wide: the gap can be small, so a word fits under each. */
    gap: var(--spacing-xs);
  }
  /* Beside the picture, two by two: a short, wide cell (Analog's two
     envelopes a voice, stacked). */
  .env-wrap.side {
    flex-direction: row;
  }
  .env-wrap.side > .env-knobs {
    height: auto;
    width: 7.5rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
    gap: 2px var(--spacing-xs);
  }
  .env-knob {
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  .graph-cell {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    display: flex;
    align-items: center;
  }
  .env-graph {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    background: var(--surface-well);
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    overflow: hidden;
  }
  .env-graph.off {
    opacity: var(--opacity-ghost);
  }
  svg {
    position: absolute;
    inset: 0;
    display: block;
    cursor: grab;
  }
  .floor,
  .mark,
  .grid {
    stroke: var(--line-strong);
    stroke-width: 1;
  }
  /* The slots' edges, faint: a quarter of the width each (the reading
     Live's own display keeps). */
  .grid {
    opacity: 0.6;
    stroke-dasharray: 1 5;
  }
  .mark {
    stroke-dasharray: 2 4;
  }
  /* The body's fill is the gradient the markup names (its ink, fading). */
  .fill {
    opacity: 1;
  }
  .line {
    fill: none;
    stroke: var(--env-ink);
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .handle {
    fill: var(--surface-well);
    stroke: var(--env-ink);
    stroke-width: 1.5;
  }
  .handle.hot {
    fill: var(--env-ink);
  }
  .label,
  .readout {
    position: absolute;
    top: 6px;
    font-size: 0.6875rem;
    font-weight: 700;
    line-height: 1;
    pointer-events: none;
  }
  .label {
    left: 8px;
    color: var(--env-ink);
    opacity: 0.85;
  }
  .readout {
    right: 8px;
    color: var(--env-ink);
    font-variant-numeric: tabular-nums;
  }
</style>
