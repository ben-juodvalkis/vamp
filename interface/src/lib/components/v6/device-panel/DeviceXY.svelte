<script lang="ts">
  import { onDestroy } from 'svelte';
  import FilterCurve, { type CurveType } from './FilterCurve.svelte';
  import { familyScheme, type DeviceColorScheme } from '$lib/config/devicePresets';
  import { MIN_SEND_INTERVAL_MS } from '$lib/utils/sliderThrottle';

  interface Props {
    xValue?: number;
    yValue?: number;
    title?: string;
    titleClass?: string;
    rateLabel?: string;
    xAxisLabels?: string[];
    onInteraction?: (x: number, y: number) => void;
    onRelease?: (x: number, y: number) => void;
    onTap?: () => void;
    isGhost?: boolean;
    showCurve?: boolean;
    curveType?: CurveType;
    color?: DeviceColorScheme;
    invertResonance?: boolean;
  }

  let {
    xValue = 0.5,
    yValue = 0.5,
    title = "",
    titleClass = "",
    rateLabel,
    xAxisLabels,
    onInteraction,
    onRelease,
    onTap,
    isGhost = false,
    showCurve = false,
    curveType = 'lowpass',
    color = familyScheme('utility'),
    invertResonance = false
  }: Props = $props();

  let isDragging = $state(false);
  let container: HTMLDivElement;

  // Local state for smooth interaction
  let localX = $state(xValue);
  let localY = $state(yValue);

  // Sync from props (props only change on track switch, not during drag - no observers!)
  // But ONLY sync when not dragging to prevent quantized OSC values from jumping the visual
  $effect(() => {
    if (!isDragging) {
      localX = xValue;
      localY = yValue;
    }
  });

  // Relative mode state - track initial positions
  let initialTouchX = $state(0);
  let initialTouchY = $state(0);
  let initialDotX = $state(0);
  let initialDotY = $state(0);

  // Cache bounding rect for absolute positioning
  let cachedRect: DOMRect | null = null;

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

  // Tap detection state
  let tapStartTime = $state(0);
  let tapStartX = $state(0);
  let tapStartY = $state(0);
  const TAP_TIME_THRESHOLD = 200; // ms
  const TAP_MOVEMENT_THRESHOLD = 5; // pixels

  // Track whether intentional movement has occurred (for tap vs drag detection)
  let hasMoved = $state(false);

  function handlePointerDown(event: PointerEvent) {
    event.preventDefault(); // Prevent scrolling and default behavior
    isDragging = true;
    hasMoved = false; // Reset movement tracking for tap detection

    // Cache bounding rect for performance during drag
    cachedRect = container.getBoundingClientRect();

    container.setPointerCapture(event.pointerId);

    // Store initial touch position and current dot position for relative mode
    initialTouchX = event.clientX;
    initialTouchY = event.clientY;
    initialDotX = localX;
    initialDotY = localY;

    // Store tap detection data
    tapStartTime = Date.now();
    tapStartX = event.clientX;
    tapStartY = event.clientY;

    // DON'T start RAF throttle or update position here - wait for intentional movement
    // This ensures taps (pointerdown → pointerup with no move) don't fire onInteraction
  }

  function handlePointerMove(event: PointerEvent) {
    if (!isDragging) return;
    event.preventDefault(); // Prevent scrolling during drag

    // Only treat as intentional drag if movement exceeds tap threshold
    // This ensures taps don't accidentally trigger onInteraction due to finger wobble
    if (!hasMoved) {
      const moveX = Math.abs(event.clientX - tapStartX);
      const moveY = Math.abs(event.clientY - tapStartY);
      if (moveX < TAP_MOVEMENT_THRESHOLD && moveY < TAP_MOVEMENT_THRESHOLD) {
        return; // Ignore micro-movements
      }
      hasMoved = true;
      startXYThrottle();
    }

    updatePositionRelative(event);
  }

  function handlePointerUp(event: PointerEvent) {
    isDragging = false;
    container.releasePointerCapture(event.pointerId);

    // Check for tap detection
    const tapDuration = Date.now() - tapStartTime;
    const tapMovementX = Math.abs(event.clientX - tapStartX);
    const tapMovementY = Math.abs(event.clientY - tapStartY);
    const isTap = tapDuration < TAP_TIME_THRESHOLD &&
                  tapMovementX < TAP_MOVEMENT_THRESHOLD &&
                  tapMovementY < TAP_MOVEMENT_THRESHOLD;

    // If it's a tap and we have an onTap handler, call it
    if (isTap && onTap) {
      onTap();
    }

    // Clear cached rect
    cachedRect = null;

    // Store current values for release callback before they get cleared
    const releaseX = xyPendingX !== null ? xyPendingX : localX;
    const releaseY = xyPendingY !== null ? xyPendingY : localY;

    // Flush throttle to send final values
    flushXYThrottle();

    // Call release callback (for operations that should only happen on release)
    if (onRelease) {
      onRelease(releaseX, releaseY);
    }
  }

  function updatePositionRelative(event: PointerEvent) {
    if (!cachedRect) return;

    // Calculate finger movement delta in pixels
    const fingerDeltaX = event.clientX - initialTouchX;
    const fingerDeltaY = event.clientY - initialTouchY;

    // Convert pixel delta to normalized coordinates (0-1)
    const deltaX = fingerDeltaX / cachedRect.width;
    const deltaY = -fingerDeltaY / cachedRect.height; // Invert Y (up = positive)

    // Apply delta to initial dot position and clamp to bounds
    const x = Math.max(0, Math.min(1, initialDotX + deltaX));
    const y = Math.max(0, Math.min(1, initialDotY + deltaY));

    // Update local state immediately for visual feedback
    localX = x;
    localY = y;

    // Queue for frame-synchronized send
    xyPendingX = x;
    xyPendingY = y;
    // Re-arm rAF — sendXYFrame self-terminates so each new movement must schedule.
    scheduleXYFrame();
  }
</script>

<div class="device-xy">
  <div
    class="xy-container"
    class:ghost={isGhost}
    bind:this={container}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
    role="slider"
    tabindex="0"
    aria-label="{title}: X {(localX * 100).toFixed(0)}%, Y {(localY * 100).toFixed(0)}%"
    aria-valuenow={localX}
    aria-valuemin="0"
    aria-valuemax="1"
    style="--xy-border: {isGhost ? 'var(--line)' : color.primary}; --xy-tint: {color.primary};"
  >
    <!-- Filter curve visualization -->
    {#if showCurve}
      <FilterCurve
        cutoff={localX}
        resonance={invertResonance ? 1 - localY : localY}
        {curveType}
        width={300}
        height={300}
        curveColor={color.primary}
      />
    {/if}

    <!-- Center title -->
    {#if title}
      <div class="center-title {titleClass}">{title}</div>
    {/if}

    <!-- Rate label (centered, below title) - only show when active (not ghost) -->
    {#if rateLabel && !isGhost}
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

    <!-- Control handle -->
    <div
      class="xy-handle"
      class:dragging={isDragging}
      style="left: {localX * 100}%; bottom: {localY * 100}%; --handle-ink: {color.primary};"
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
    /* The drag is ours on both axes. Without this a touch here computes
       `auto` (the nearest ancestor scroller resets the chain), so Chromium
       claims the pan a few px in and fires pointercancel — the drag stops.
       preventDefault on pointerdown does not prevent a touch pan. */
    touch-action: none;
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
  :global([data-skin="hybrid"]) .center-title {
    color: var(--xy-tint, var(--foreground));
  }
  :global(.light[data-skin="hybrid"]) .center-title {
    color: color-mix(in oklab, var(--xy-tint, var(--foreground)) 55%, var(--foreground));
  }
  :global([data-skin="hybrid"]) .xy-container.ghost .center-title {
    color: color-mix(in srgb, var(--xy-tint, var(--foreground)) 70%, var(--signal-dim));
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