<script lang="ts">
  /**
   * A three-band tone pad over its own response curve: the left third drags
   * the low shelf, the middle is an invisible XY for the mid band (X its
   * frequency, Y its gain), the right third drags the high shelf. The EQ
   * tile's face, shared with the Pedal view's tone stack (2026-10-07) so the
   * two look and feel the same.
   *
   * Presentational: values come in normalized 0..1 (0.5 flat), gestures go
   * out the same way, and the host decides what a write on a ghost means.
   * The shelves report only once a drag passes the tap threshold, so a tap
   * reaches `onTap` and loads nothing (ADR-167).
   */
  import type { DeviceColorScheme } from '$lib/config/devicePresets';
  import FilterCurve from './FilterCurve.svelte';
  import DeviceXY from './DeviceXY.svelte';

  interface Props {
    title: string;
    low: number;
    mid: number;
    midFreq: number;
    high: number;
    isGhost?: boolean;
    color: DeviceColorScheme;
    ariaLabel?: string;
    // The curve's ink; FilterCurve's own (the filter family's) when unset.
    curveColor?: string;
    onTap?: () => void;
    onLow?: (value: number) => void;
    onHigh?: (value: number) => void;
    onMid?: (freq: number, gain: number) => void;
  }

  let { title, low, mid, midFreq, high, isGhost = false, color, ariaLabel, curveColor, onTap, onLow, onHigh, onMid }: Props = $props();

  // The curve is a picture of the three bands, ±12 dB across the range.
  let bands = $derived([
    { freq: 120, gain: (low - 0.5) * 24, q: 0.71, type: 'lowshelf' },
    { freq: Math.pow(10, 2 + midFreq * 2), gain: (mid - 0.5) * 24, q: 0.5, type: 'peak' },
    { freq: 4500, gain: (high - 0.5) * 24, q: 0.4, type: 'highshelf' }
  ]);

  const TAP_MOVEMENT_THRESHOLD = 5; // pixels - matches DeviceXY

  // A vertical drag on a shelf zone: 100 px spans the whole range.
  function shelfDrag(read: () => number, write: ((v: number) => void) | undefined) {
    let dragging = false;
    let startY = 0;
    let startValue = 0;
    let hasMoved = false;
    return {
      onpointerdown(e: PointerEvent) {
        dragging = true;
        startY = e.clientY;
        startValue = read();
        hasMoved = false;
        (e.target as Element).setPointerCapture(e.pointerId);
      },
      onpointermove(e: PointerEvent) {
        if (!dragging || !e.buttons) return;
        const deltaY = startY - e.clientY;
        if (!hasMoved) {
          if (Math.abs(deltaY) < TAP_MOVEMENT_THRESHOLD) return; // Ignore micro-movements
          hasMoved = true;
        }
        write?.(Math.max(0, Math.min(1, startValue + deltaY / 100)));
      },
      onpointerup(e: PointerEvent) {
        dragging = false;
        (e.target as Element).releasePointerCapture(e.pointerId);
      }
    };
  }

  const lowDrag = shelfDrag(() => low, (v) => onLow?.(v));
  const highDrag = shelfDrag(() => high, (v) => onHigh?.(v));
</script>

<style>
  /* DeviceXY border, background, and focus ring transparent here — the
     mid-band pad rides on the shared curve, so it must have no frame of its
     own. !important: these fight DeviceXY's own scoped rules (higher
     specificity, other file), so ordering/specificity can't be relied on. */
  :global(.eq-xy-invisible .xy-container),
  :global(.eq-xy-invisible .xy-container:focus),
  :global(.eq-xy-invisible .xy-container:hover) {
    border-color: transparent !important;
    background: transparent !important;
    box-shadow: none !important;
  }

  /* Title — mirrors DeviceXY's .center-title so the labels match: same fluid
     size, weight, casing, spacing. Color (device tint) is set inline from
     `color.primary`. Rides full brightness even in ghost mode — the ghost
     dim is applied to the filter-curve body, not the label (matches
     XY/slider). */
  .eq-title {
    font-size: clamp(max(var(--type-min), calc(26 * var(--fluid-px))), 10cqw, 64px);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .eq-panel {
    container-type: inline-size;
  }

  /* Flat grammar: same ControlBackground module as its neighbours. This scoped
     rule outranks app.css `.glass-panel-subtle` (and its flat twin) and the
     `rounded-lg` utility, so no !important is needed. */
  :global([data-grammar="flat"]) .eq-panel {
    background: var(--surface-well);
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    box-shadow: none;
  }
  :global([data-grammar="flat"]) .eq-title {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
  }
</style>

<div
  class="eq-panel relative w-full h-full glass-panel-subtle rounded-lg overflow-hidden"
  role="button"
  tabindex="0"
  aria-label={ariaLabel ?? title}
  onclick={() => onTap?.()}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onTap?.();
    }
  }}
>
  <!-- Title overlay - matches DeviceXY .center-title (fluid size, device tint).
       Full brightness in ghost mode; only the curve body below dims. -->
  <div
    class="eq-title absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none select-none"
    style="color: {isGhost ? color.primary : `color-mix(in oklab, ${color.primary} 70%, transparent)`};"
  >{title}</div>

  <!-- Background: Filter curve visualization (full screen) -->
  <div class="absolute inset-0 pointer-events-none z-0" class:opacity-60={isGhost}>
    <FilterCurve curveType="eq" {bands} {curveColor} width={200} height={200} />
  </div>

  <!-- Foreground: Controls overlay (full screen) -->
  <div class="absolute inset-0 flex gap-1 p-1 z-10">
    <!-- Low shelf (left) - invisible container -->
    <div class="flex-1 relative">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="h-full w-full flex items-center justify-center cursor-ns-resize"
        data-band="low"
        onpointerdown={lowDrag.onpointerdown}
        onpointermove={lowDrag.onpointermove}
        onpointerup={lowDrag.onpointerup}
      ></div>
    </div>

    <!-- Mid XY (center) - invisible border -->
    <div class="flex-1 eq-xy-invisible">
      <DeviceXY
        xValue={midFreq}
        yValue={mid}
        title=""
        isGhost={false}
        showCurve={false}
        {color}
        onInteraction={(x, y) => onMid?.(x, y)}
      />
    </div>

    <!-- High shelf (right) - invisible container -->
    <div class="flex-1 relative">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="h-full w-full flex items-center justify-center cursor-ns-resize"
        data-band="high"
        onpointerdown={highDrag.onpointerdown}
        onpointermove={highDrag.onpointermove}
        onpointerup={highDrag.onpointerup}
      ></div>
    </div>
  </div>
</div>
