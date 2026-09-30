<script lang="ts" module>
  export type EnvelopeStage = 'attack' | 'decay' | 'sustain' | 'release';
</script>

<script lang="ts">
  /**
   * EnvelopeEditor — an ADSR drawn the way Live draws one (user's call,
   * 2026-09-29, off a screenshot of Live's envelope): the attack rises to the
   * peak, the decay curves down to the sustain level, sustain holds, the
   * release falls to silence. Three handles on the curve:
   *
   * - the peak: sideways is attack time;
   * - the knee where decay meets sustain: sideways is decay time, up and
   *   down is the sustain level;
   * - the end of the tail: sideways is release time.
   *
   * Each time stage owns up to SEG of the width, so a longer stage pushes
   * everything after it right, as in Live. Drags are relative (the XY pad's
   * grammar): a touch never jumps a value, and the finger does not have to
   * land dead on a handle — the nearest one takes it. Every finger drives
   * its own handle, so two can move at once.
   *
   * Values are 0..1 parameter values; one throttle per stage keeps each
   * write at the 60 Hz budget (issue #384), and a release always delivers
   * the resting value.
   */
  import { onDestroy } from 'svelte';
  import { familyScheme, type DeviceColorScheme } from '$lib/config/devicePresets';
  import { createSliderThrottle } from '$lib/utils/sliderThrottle';

  type Handle = 'peak' | 'knee' | 'tail';

  interface Props {
    attack?: number;
    decay?: number;
    sustain?: number;
    release?: number;
    /** Names the control for assistive tech ("Amp Envelope"). */
    title?: string;
    /** Live's formatted value per stage ("1.00 ms"), when it has sent one. */
    displays?: Partial<Record<EnvelopeStage, string | undefined>>;
    color?: DeviceColorScheme;
    onChange?: (stage: EnvelopeStage, value: number) => void;
  }

  let {
    attack = 0,
    decay = 0.5,
    sustain = 1,
    release = 0.5,
    title = 'Envelope',
    displays = {},
    color = familyScheme('utility'),
    onChange
  }: Props = $props();

  const STAGES: EnvelopeStage[] = ['attack', 'decay', 'sustain', 'release'];
  const STAGE_NAMES: Record<EnvelopeStage, string> = {
    attack: 'Attack',
    decay: 'Decay',
    sustain: 'Sustain',
    release: 'Release'
  };
  /** The width each time stage may take, and the sustain plateau's. */
  const SEG = 0.3;
  const HOLD = 0.1;
  /** Keeps a handle at an edge wholly inside the well and touchable. */
  const PAD = 14;

  // Local values: what the curve draws. A stage follows its prop except
  // while a finger holds it, so a quantized echo cannot jolt the handle.
  let local = $state<Record<EnvelopeStage, number>>({ attack: 0, decay: 0.5, sustain: 1, release: 0.5 });
  let held = $state<Record<EnvelopeStage, boolean>>({ attack: false, decay: false, sustain: false, release: false });

  $effect(() => {
    const incoming = { attack, decay, sustain, release };
    for (const s of STAGES) {
      if (!held[s]) local[s] = incoming[s];
    }
  });

  const throttles = Object.fromEntries(
    STAGES.map((s) => [s, createSliderThrottle((v) => onChange?.(s, v))])
  ) as Record<EnvelopeStage, ReturnType<typeof createSliderThrottle>>;

  onDestroy(() => STAGES.forEach((s) => throttles[s].cancel()));

  let width = $state(0);
  let height = $state(0);
  let w = $derived(Math.max(0, width - 2 * PAD));
  let h = $derived(Math.max(0, height - 2 * PAD));

  let xPeak = $derived(PAD + local.attack * SEG * w);
  let xKnee = $derived(xPeak + local.decay * SEG * w);
  let xHold = $derived(xKnee + HOLD * w);
  let xTail = $derived(xHold + local.release * SEG * w);
  let yTop = PAD;
  let yBottom = $derived(PAD + h);
  let ySustain = $derived(PAD + (1 - local.sustain) * h);

  // Attack straight up; decay and release fall fast and ease out — the
  // exponential look of Live's curve, as a quadratic through the corner.
  let curve = $derived(
    `M ${PAD} ${yBottom} L ${xPeak} ${yTop} ` +
      `Q ${xPeak} ${ySustain} ${xKnee} ${ySustain} ` +
      `L ${xHold} ${ySustain} ` +
      `Q ${xHold} ${yBottom} ${xTail} ${yBottom}`
  );
  let fill = $derived(`${curve} Z`);

  let handles = $derived([
    { id: 'peak' as Handle, x: xPeak, y: yTop },
    { id: 'knee' as Handle, x: xKnee, y: ySustain },
    { id: 'tail' as Handle, x: xTail, y: yBottom }
  ]);

  interface Grab {
    handle: Handle;
    x0: number;
    y0: number;
    start: Record<EnvelopeStage, number>;
    moved: boolean;
  }
  const grabs = new Map<number, Grab>();
  let heldHandles = $state<Handle[]>([]);

  const STAGES_OF: Record<Handle, EnvelopeStage[]> = {
    peak: ['attack'],
    knee: ['decay', 'sustain'],
    tail: ['release']
  };

  let svg: SVGSVGElement;

  function nearestFree(px: number, py: number): Handle | null {
    const taken = new Set([...grabs.values()].map((g) => g.handle));
    let best: Handle | null = null;
    let bestD = Infinity;
    for (const hd of handles) {
      if (taken.has(hd.id)) continue;
      const d = Math.hypot(hd.x - px, hd.y - py);
      if (d < bestD) {
        bestD = d;
        best = hd.id;
      }
    }
    return best;
  }

  function syncHeld() {
    const on = new Set([...grabs.values()].flatMap((g) => STAGES_OF[g.handle]));
    for (const s of STAGES) held[s] = on.has(s);
    heldHandles = [...grabs.values()].map((g) => g.handle);
  }

  function onPointerDown(event: PointerEvent) {
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const handle = nearestFree(event.clientX - rect.left, event.clientY - rect.top);
    if (!handle) return;
    svg.setPointerCapture(event.pointerId);
    grabs.set(event.pointerId, {
      handle,
      x0: event.clientX,
      y0: event.clientY,
      start: { ...local },
      moved: false
    });
    syncHeld();
  }

  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  function onPointerMove(event: PointerEvent) {
    const grab = grabs.get(event.pointerId);
    if (!grab || w <= 0 || h <= 0) return;
    event.preventDefault();
    const dx = event.clientX - grab.x0;
    const dy = event.clientY - grab.y0;
    if (!grab.moved) {
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      grab.moved = true;
      STAGES_OF[grab.handle].forEach((s) => throttles[s].start());
    }
    const set = (s: EnvelopeStage, v: number) => {
      local[s] = clamp(v);
      throttles[s].push(local[s]);
    };
    const time = dx / (SEG * w);
    if (grab.handle === 'peak') set('attack', grab.start.attack + time);
    if (grab.handle === 'knee') {
      set('decay', grab.start.decay + time);
      set('sustain', grab.start.sustain - dy / h);
    }
    if (grab.handle === 'tail') set('release', grab.start.release + time);
  }

  function onPointerUp(event: PointerEvent) {
    const grab = grabs.get(event.pointerId);
    if (!grab) return;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    grabs.delete(event.pointerId);
    STAGES_OF[grab.handle].forEach((s) => throttles[s].flush());
    syncHeld();
  }

  // The readout names what the finger holds: Live's own string once it has
  // sent one, a percentage of the rail until then.
  function readout(s: EnvelopeStage): string {
    return `${STAGE_NAMES[s]} ${displays[s] ?? `${Math.round(local[s] * 100)}%`}`;
  }
  let readoutStages = $derived(
    heldHandles.length ? heldHandles.flatMap((hd) => STAGES_OF[hd]) : []
  );
</script>

<div
  class="envelope-editor"
  bind:clientWidth={width}
  bind:clientHeight={height}
  style="--env-ink: {color.primary};"
>
  <svg
    bind:this={svg}
    role="group"
    aria-label="{title}: attack {Math.round(local.attack * 100)}%, decay {Math.round(local.decay * 100)}%, sustain {Math.round(local.sustain * 100)}%, release {Math.round(local.release * 100)}%"
    width={width}
    height={height}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  >
    {#if w > 0 && h > 0}
      <path class="env-fill" d={fill} />
      <path class="env-curve" d={curve} />
      {#each handles as hd (hd.id)}
        <rect
          class="env-handle"
          class:held={heldHandles.includes(hd.id)}
          data-handle={hd.id}
          x={hd.x - 7}
          y={hd.y - 7}
          width="14"
          height="14"
        />
      {/each}
    {/if}
  </svg>
  {#if readoutStages.length}
    <div class="env-readout">
      {#each readoutStages as s (s)}<span>{readout(s)}</span>{/each}
    </div>
  {/if}
</div>

<style>
  .envelope-editor {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--surface-well);
    border: 1px solid var(--env-ink, var(--line));
    border-radius: var(--radius-sm);
    user-select: none;
  }

  svg {
    position: absolute;
    inset: 0;
    display: block;
    /* The drag is ours on both axes (see DeviceXY's .xy-container). */
    touch-action: none;
    cursor: crosshair;
  }

  .env-fill {
    fill: color-mix(in oklab, var(--env-ink) 18%, transparent);
    stroke: none;
  }

  .env-curve {
    fill: none;
    stroke: var(--env-ink);
    stroke-width: 2.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  /* Live's handles: small open squares on the curve, filled while held. */
  .env-handle {
    fill: var(--surface-well);
    stroke: var(--foreground);
    stroke-width: 2;
    pointer-events: none;
  }
  .env-handle.held {
    fill: var(--foreground);
  }

  .env-readout {
    position: absolute;
    top: 6px;
    right: 8px;
    display: flex;
    gap: 0.75rem;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums lining-nums;
    font-size: 0.8125rem;
    color: var(--foreground);
    pointer-events: none;
  }

  /* Flat grammar: the well's dark frame, as DeviceXY and DeviceSlider wear. */
  :global([data-grammar="flat"]) .envelope-editor {
    border: 1px solid var(--line-strong);
    border-radius: 2px;
  }
  :global([data-grammar="flat"]) .env-handle {
    stroke: var(--flat-handle, var(--foreground));
  }
  :global([data-grammar="flat"]) .env-handle.held {
    fill: var(--flat-handle, var(--foreground));
  }
</style>
