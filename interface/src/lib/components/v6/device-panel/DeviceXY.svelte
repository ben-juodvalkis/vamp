<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import ControlGlyph, { type ControlGlyphName } from './ControlGlyph.svelte';
  import FilterCurve, { type CurveType } from './FilterCurve.svelte';
  import { familyScheme, type DeviceColorScheme } from '$lib/config/devicePresets';
  import { MIN_SEND_INTERVAL_MS } from '$lib/utils/sliderThrottle';
  import { fitText } from '$lib/utils/fitText';
  import { hzToCurveX } from '$lib/utils/instrumentFilterCurves';
  import { drag, type DragInfo, type DragEndInfo } from '$lib/actions/drag';
  import { isTap, pastSlop, relativeXY } from './padGesture';

  interface Props {
    xValue?: number;
    yValue?: number;
    title?: string;
    titleClass?: string;
    // Where the title sits: the pad's middle, or its foot, out of the way
    // of a picture drawn across the middle (Wavetable's wave).
    titleAt?: 'center' | 'bottom';
    rateLabel?: string;
    /** Draw the rate label only while a finger drags the pad (a browser tile, 2026-11-06). */
    rateWhileDragging?: boolean;
    xAxisLabels?: string[];
    onInteraction?: (x: number, y: number) => void;
    onRelease?: (x: number, y: number) => void;
    onTap?: () => void;
    isGhost?: boolean;
    showCurve?: boolean;
    curveType?: CurveType;
    // Stages of the curve (FilterCurve `order`): 2 draws a 24 dB slope.
    curveOrder?: number;
    // The cutoff X spans, as [minHz, maxHz] on a log sweep — the device's
    // own range, measured in Live. Unset, X 0..1 is the curve's 20 Hz..20 kHz.
    curveFreqRange?: readonly [number, number];
    color?: DeviceColorScheme;
    invertResonance?: boolean;
    // Drawn under the handle and the title, filling the pad: a picture of
    // what the two axes do (the Reverb view's tail). Visual only — give it
    // `pointer-events: none`; the pad keeps the gesture.
    background?: Snippet;
    // A mark for what the pad does, drawn above the title. Visual only, the
    // title still names the pad.
    icon?: ControlGlyphName;
    // How high the handle travels, as a fraction of the pad: a Y of 1 parks
    // it there, and a drag the pad's height × yTop long spans the full Y.
    // Under 1 when the top of the pad belongs to something else (the Reverb
    // view's tabs and readouts over its tail).
    yTop?: number;
    // How far a drag moves each axis, as [x, y]: 1 spans the axis over the
    // pad's size, 0.25 takes four pads' travel (a fine, stepped parameter).
    sensitivity?: readonly [number, number];
  }

  let {
    xValue = 0.5,
    yValue = 0.5,
    title = "",
    titleClass = "",
    titleAt = 'center',
    rateLabel,
    rateWhileDragging = false,
    xAxisLabels,
    onInteraction,
    onRelease,
    onTap,
    isGhost = false,
    showCurve = false,
    curveType = 'lowpass',
    curveOrder = 1,
    curveFreqRange,
    color = familyScheme('utility'),
    invertResonance = false,
    background,
    icon,
    yTop = 1,
    sensitivity = [1, 1]
  }: Props = $props();

  let isDragging = $state(false);

  // The shown dot: the props, overridden by the finger while it drags. Only
  // re-synced when not dragging, so a quantized echo from Live does not
  // jump the dot under the finger.
  let localX = $state(xValue);
  let localY = $state(yValue);
  $effect(() => {
    if (!isDragging) {
      localX = xValue;
      localY = yValue;
    }
  });

  // The dot and time at touch-down, for the relative drag and the tap rule.
  let initialDotX = 0;
  let initialDotY = 0;
  let downAt = 0;

  // Frame-synchronized XY throttle (handles both X and Y together).
  // The rAF loop self-terminates each frame after sending pending values; new
  // pointer movement re-arms it via scheduleXYFrame(). This prevents the loop
  // from leaking when pointerup is missed (page hidden, pointer leaves window,
  // component unmounts mid-drag) — see issue #392.
  //
  // rAF alone is NOT a rate limit: on the iPad's 120 Hz ProMotion panel it
  // fires every ~8 ms, and this control writes TWO parameters per send, so an
  // ungated drag emits ~240 messages/second against issue #384's 60 Hz budget.
  // sendXYFrame therefore gates on MIN_SEND_INTERVAL_MS — the same ceiling
  // createSliderThrottle uses — and re-arms rAF when it trips so the latest
  // pending pair still ships on the next frame.
  let xyRafId: number | null = null;
  let xyPendingX: number | null = null;
  let xyPendingY: number | null = null;
  let xyActive = false;
  let lastSentX: number | null = null;
  let lastSentY: number | null = null;
  let lastSentTs = 0;

  function scheduleXYFrame() {
    if (xyActive && !xyRafId) {
      xyRafId = requestAnimationFrame(sendXYFrame);
    }
  }

  function startXYThrottle() {
    xyActive = true;
    scheduleXYFrame();
  }

  function sendXYFrame(now: number) {
    xyRafId = null;
    if (xyPendingX !== null && xyPendingY !== null && onInteraction) {
      if (now - lastSentTs < MIN_SEND_INTERVAL_MS) {
        scheduleXYFrame();
        return;
      }
      if (xyPendingX !== lastSentX || xyPendingY !== lastSentY) {
        onInteraction(xyPendingX, xyPendingY);
        lastSentX = xyPendingX;
        lastSentY = xyPendingY;
        lastSentTs = now;
      }
      xyPendingX = null;
      xyPendingY = null;
    }
  }

  function flushXYThrottle() {
    xyActive = false;
    if (xyRafId) {
      cancelAnimationFrame(xyRafId);
      xyRafId = null;
    }
    // The resting value bypasses the 60 Hz gate — pointerup must always
    // deliver where the finger actually left the pad.
    if (xyPendingX !== null && xyPendingY !== null && onInteraction) {
      if (xyPendingX !== lastSentX || xyPendingY !== lastSentY) {
        onInteraction(xyPendingX, xyPendingY);
      }
    }
    xyPendingX = null;
    xyPendingY = null;
    lastSentX = null;
    lastSentY = null;
    lastSentTs = 0;
  }

  // Unmount path: cancel without flushing. Flushing here would fire onInteraction
  // with stale XY coords against whatever device is now mounted in this slot.
  function cancelXYThrottle() {
    xyActive = false;
    if (xyRafId) {
      cancelAnimationFrame(xyRafId);
      xyRafId = null;
    }
    xyPendingX = null;
    xyPendingY = null;
    lastSentX = null;
    lastSentY = null;
    lastSentTs = 0;
  }

  onDestroy(cancelXYThrottle);

  // Whether the press has passed the tap slop: until it does, nothing is
  // written, so a tap (or finger wobble on one) never moves the dot.
  let hasMoved = false;

  /**
   * The drag (ADR-427): `use:drag` owns the pointer, so a second finger on
   * the pad neither drives the dot nor ends the first finger's drag.
   */
  const padDrag = {
    commit: 'immediate' as const,
    binding: 'capture' as const,
    onStart: ({ event }: DragInfo) => {
      event?.preventDefault();
      isDragging = true;
      hasMoved = false;
      initialDotX = localX;
      initialDotY = localY;
      downAt = performance.now();
    },
    onMove: ({ dx, dy, width, height }: DragInfo) => {
      if (!hasMoved) {
        if (!pastSlop(dx, dy)) return;
        hasMoved = true;
        startXYThrottle();
      }
      const { x, y } = relativeXY({
        startX: initialDotX,
        startY: initialDotY,
        dx,
        dy,
        width,
        height,
        sensitivity,
        yTop
      });
      // Update local state immediately for visual feedback
      localX = x;
      localY = y;
      // Queue for frame-synchronized send; sendXYFrame self-terminates, so
      // each new movement re-arms it.
      xyPendingX = x;
      xyPendingY = y;
      scheduleXYFrame();
    },
    onEnd: ({ dx, dy, reason }: DragEndInfo) => {
      isDragging = false;
      // Unmounted mid-drag: onDestroy cancels the throttle without a flush.
      if (reason === 'teardown') return;
      if (reason === 'up' && isTap(dx, dy, performance.now() - downAt)) onTap?.();
      // Where the finger left the pad, before the flush clears it.
      const releaseX = xyPendingX !== null ? xyPendingX : localX;
      const releaseY = xyPendingY !== null ? xyPendingY : localY;
      flushXYThrottle();
      onRelease?.(releaseX, releaseY);
    }
  };
</script>

<div class="device-xy">
  <div
    class="xy-container"
    class:ghost={isGhost}
    use:drag={padDrag}
    role="slider"
    tabindex="0"
    aria-label="{title}: X {(localX * 100).toFixed(0)}%, Y {(localY * 100).toFixed(0)}%"
    aria-valuenow={localX}
    aria-valuemin="0"
    aria-valuemax="1"
    style="--xy-border: {isGhost ? 'var(--line)' : color.primary}; --xy-tint: {color.primary};"
  >
    {#if background}{@render background()}{/if}

    <!-- Filter curve visualization -->
    {#if showCurve}
      <FilterCurve
        cutoff={curveFreqRange ? hzToCurveX(curveFreqRange[0] * Math.pow(curveFreqRange[1] / curveFreqRange[0], localX)) : localX}
        order={curveOrder}
        resonance={invertResonance ? 1 - localY : localY}
        {curveType}
        width={300}
        height={300}
        curveColor={color.primary}
      />
    {/if}

    <!-- Center title -->
    {#if title}
      <div class="center-title {titleClass}" class:title-bottom={titleAt === 'bottom'}>
        {#if icon}<span class="title-icon" aria-hidden="true"><ControlGlyph name={icon} /></span>{/if}
        <span class="fit-label" use:fitText={title}>{title}</span>
      </div>
    {/if}


    <!-- Rate label (centered, below title) - only show when active (not ghost) -->
    {#if rateLabel && !isGhost && (!rateWhileDragging || isDragging)}
      <div class="rate-label-centered">{rateLabel}</div>
    {/if}

    <!-- X-axis labels along the bottom - only show when active (not ghost) -->
    {#if xAxisLabels && !isGhost}
      <div class="x-axis-labels">
        {#each xAxisLabels as label}
          <span class="x-axis-label">{label}</span>
        {/each}
      </div>
    {/if}

    <!-- Control handle: its travel inset by the dot's radius, so at a rail
         (a filter shut, a Drum Buss at rest) the dot is whole, not half
         off the pad's edge. -->
    <div
      class="xy-handle"
      class:dragging={isDragging}
      style="left: calc(var(--dot-r) + {localX} * (100% - 2 * var(--dot-r))); bottom: calc(var(--dot-r) + {localY * yTop} * (100% - 2 * var(--dot-r))); --handle-ink: {color.primary};"
    ></div>
  </div>

</div>

<style>
  .device-xy {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    user-select: none;
    font-family: var(--font-sans);
    font-size: 11px;
  }

  /* 1px device hairline (§5.6). The call site sets --xy-tint (device ink) and
     --xy-border (the hairline colour: device ink, or --line for a ghost — the
     frame never brightens on hover). (Inset top-edge well shadow removed — read
     as a hard dark line.) */
  .xy-container {
    position: relative;
    flex: 1;
    /* Query container so pad text can size to the pad (cqw) — see .center-title. */
    container-type: inline-size;
    background: var(--surface-well);
    border: 1px solid var(--xy-border, var(--line));
    border-radius: var(--radius-sm);
    cursor: crosshair;
    overflow: hidden;
    transition: border-color 0.2s ease, background-color 0.2s ease;
  }

  /* FX-grid XYs: a subtle device-tinted well. */
  :global(.device-control) .xy-container {
    background: color-mix(in oklab, var(--xy-tint, transparent) 12%, var(--surface-well));
  }

  /* Ghost: dim the BODY (curve / crosshairs / handle) per-element instead of
     blanketing the whole pad. The parent already ghosts the slot (.device-ghost
     in the FX grid, .slot-ghost in central views), so a blanket opacity here was
     a SECOND dim that — stacked with the title's tint — sank the label to ~0.09
     alpha. Dimming the body only lets the title ride a single parent dim. */
  .xy-container.ghost {
    border-style: dashed;
  }
  .xy-container.ghost > :global(svg),
  .xy-container.ghost .xy-handle {
    opacity: var(--opacity-ghost);
  }

  .xy-container:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--ring);
  }

  /* Center title — the device name on the pad. Size scales with the pad width via
     container query (cqw) so the large central pads don't wear a tiny fixed label;
     clamp keeps small FX-grid pads legible and caps the big ones. Ink raised from
     the old 35% (too dim on the dark well, esp. for mid-luminance device hues) to
     70% device tint — still device-colored, clearly readable (§2.7). */
  .center-title {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: clamp(max(var(--type-min), calc(26 * var(--fluid-px))), 10cqw, 64px);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    pointer-events: none;
    user-select: none;
    z-index: 1;
    color: color-mix(in oklab, var(--xy-tint, var(--foreground)) 70%, transparent);
  }

  .center-title {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15em;
  }

  /* At the foot the title takes the pad's whole width, so a long name
     (Meld's "Basic Shapes") stays one line rather than wrapping in the
     right half a centred box is left. */
  .center-title.title-bottom {
    top: auto;
    left: var(--spacing-sm);
    right: var(--spacing-sm);
    bottom: var(--spacing-sm);
    transform: none;
    text-align: center;
  }

  .title-icon {
    display: flex;
    width: 2.6em;
    height: 2.6em;
  }
  .title-icon :global(svg) {
    width: 100%;
    height: 100%;
  }


  /* Ghost label stays legible (§5.6): full device tint (not white, not dimmed) and
     not part of the per-element ghost dim above — so an empty slot reads clearly at
     a glance and matches the slider's ghost label. */
  .xy-container.ghost .center-title {
    color: var(--xy-tint, var(--foreground));
  }

  /* Live value readout — mono tabular (§5.6). */
  .rate-label-centered {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums lining-nums;
    font-size: 24px;
    font-weight: 600;
    pointer-events: none;
    user-select: none;
    z-index: 2;
    color: var(--foreground);
  }

  /* Solo dot marker (§5.6) — the luminous ring is gone; the 10px white-hot dot
     is the whole marker. The 28px box stays as the (invisible) positioning frame
     so the drag-scale keeps a stable origin. Visual only (pointer-events:none) —
     the pad is the touch target, so the size change is safe. */
  .xy-container {
    --dot-r: 6px;
  }
  .xy-handle {
    position: absolute;
    width: 28px;
    height: 28px;
    background: transparent;
    border: none;
    transform: translate(-50%, 50%);
    pointer-events: none;
    transition: transform 0.15s ease;
    will-change: left, bottom;
    z-index: 3;
  }
  .xy-handle::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    background: color-mix(in oklab, var(--handle-ink, white) 55%, white);
  }

  .xy-handle.dragging {
    transform: translate(-50%, 50%) scale(1.1);
    transition: none;
  }

  /* ---- Flat grammar: flat ControlBackground pad, 1px dark frame (ignores
     --xy-border, the call site's ink), Live's control text for the title,
     light-grey dot handle. */
  :global([data-grammar="flat"]) .xy-container,
  :global([data-grammar="flat"] .device-control) .xy-container {
    background: var(--surface-well);
    border: 1px solid var(--line-strong);
    border-radius: 2px;
  }
  :global([data-grammar="flat"]) .xy-container.ghost {
    border-style: solid;
  }
  :global([data-grammar="flat"]) .xy-container:focus {
    box-shadow: 0 0 0 1px var(--flat-selection);
  }
  :global([data-grammar="flat"]) .center-title {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
    font-size: clamp(max(var(--type-min), calc(20 * var(--fluid-px))), 8cqw, 44px);
    color: var(--foreground);
  }
  :global([data-grammar="flat"]) .xy-container.ghost .center-title {
    color: var(--signal-dim);
  }
  /* Ink (ADR-544): a pad's name and mark are labels, in plain ink. */
  :global([data-skin="hybrid"]) .center-title,
  :global([data-skin="hybrid"]) .title-icon {
    color: var(--label);
  }
  :global([data-skin="hybrid"]) .xy-container.ghost .center-title,
  :global([data-skin="hybrid"]) .xy-container.ghost .title-icon {
    color: var(--signal-dim);
  }
  :global([data-grammar="flat"]) .rate-label-centered {
    font-size: 16px;
    font-weight: 500;
  }
  :global([data-grammar="flat"]) .xy-handle::before {
    background: var(--flat-handle);
  }

  /* X-axis labels along the bottom */
  .x-axis-labels {
    position: absolute;
    bottom: 2px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: space-between;
    padding: 0 4px;
    pointer-events: none;
    user-select: none;
    z-index: 1;
  }

  .x-axis-label {
    font-size: 9px;
    font-weight: 500;
    color: var(--fg-tertiary);
  }

  /* No grid lines in AbletonXY style */
</style>