<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import { familyScheme, type DeviceColorScheme } from '$lib/config/devicePresets';
  import MeterVisualization from '$lib/components/v6/looping/MeterVisualizationV6.svelte';
  import { createSliderThrottle } from '$lib/utils/sliderThrottle';

  // Minimal track interface for meter visualization
  interface MeterTrack {
    meterLevel: number;
    mute: boolean;
  }

  interface Props {
    value?: number;
    title?: string;
    // Drawn label in place of the title text (a glyph). Rendered in both label
    // layers, so ink it with currentColor and it flips on the fill like text
    // does. `title` still names the slider for assistive tech.
    label?: Snippet;
    onInteraction?: (value: number) => void;
    onTap?: () => void;
    // Fired at TRUE finger-down, before any movement or tap/drag verdict.
    // For a host that wants the touch itself to mean something — switching
    // which of two things a view is showing, say — where `onTap` (under
    // 200ms, under 5px) and `onInteraction` (a moved finger) both leave a
    // press that rests and lifts unanswered. View state only: a device write
    // belongs in `onInteraction`, which is throttled to the frame.
    onDown?: () => void;
    isGhost?: boolean;
    orientation?: 'vertical' | 'horizontal';
    labelOrientation?: 'vertical' | 'horizontal' | 'auto';  // 'auto' follows slider orientation
    labelSize?: 'small' | 'large';  // 'small' for FX grid, 'large' for central views
    color?: DeviceColorScheme;
    min?: number;
    max?: number;
    centerOrigin?: boolean;  // If true, fill expands from center (for bipolar controls like gain)
    centerValue?: number;    // The value that represents center (default: midpoint of min/max)
    // Draw the split handle line (two rail-pinned segments with a gap for the
    // label) instead of a solid fill. Implied by `track` — meter mode has no
    // fill to read position from, so it always needs the handle. Set it
    // explicitly for a fill-less bipolar slider that wants the same read.
    handleLine?: boolean;
    track?: MeterTrack | null;  // Optional track for meter visualization
    trackIndex?: number;       // Track index for meter
    meterColor?: string;       // Optional track-color tint for the meter fill
  }

  let {
    value = 0,
    title = "",
    label,
    onInteraction,
    onTap,
    onDown,
    isGhost = false,
    orientation = 'vertical',
    labelOrientation = 'auto',
    labelSize = 'large',
    color = familyScheme('utility'),
    min = 0,
    max = 1,
    centerOrigin = false,
    centerValue,
    handleLine = false,
    track = null,
    trackIndex = 0,
    meterColor
  }: Props = $props();

  // Resolve label orientation - 'auto' follows slider orientation
  let effectiveLabelOrientation = $derived(
    labelOrientation === 'auto' ? orientation : labelOrientation
  );

  // Meter mode has no fill, so it always draws the handle; `handleLine` opts
  // a fill-less slider into the same treatment. When the handle is showing,
  // the solid fill is suppressed — position is read from the line instead.
  let showHandleLine = $derived(handleLine || !!track);
  let showFill = $derived(!track && !handleLine);

  let isDragging = $state(false);
  let container: HTMLDivElement;

  // Local state for smooth interaction
  let localValue = $state(value);

  // Sync from props (props only change on track switch - no observers!)
  $effect(() => {
    localValue = value;
  });

  // Track start position for relative dragging
  let startPointer = 0;
  let startValue = 0;

  // Frame-synchronized throttle for smooth updates
  const throttle = createSliderThrottle((value: number) => {
    onInteraction?.(value);
  });

  // Cancel any pending rAF on unmount — guards against drag-interrupt leaks (#392).
  onDestroy(throttle.cancel);

  // Tap detection state
  let tapStartTime = $state(0);
  let tapStartX = $state(0);
  let tapStartY = $state(0);
  const TAP_TIME_THRESHOLD = 200; // ms
  const TAP_MOVEMENT_THRESHOLD = 5; // pixels

  // Computed for display (guard against division by zero if min >= max)
  let fillPercent = $derived(max > min ? ((localValue - min) / (max - min)) * 100 : 0);

  // Center origin calculations (for bipolar controls)
  // Use provided centerValue, or default to midpoint of range
  let effectiveCenterValue = $derived(centerValue ?? (min + max) / 2);
  let centerPercent = $derived(max > min ? ((effectiveCenterValue - min) / (max - min)) * 100 : 50);
  let fillFromCenter = $derived(() => {
    if (!centerOrigin) return null;
    const current = fillPercent;
    const center = centerPercent;
    if (current >= center) {
      // Above center: fill from center upward
      return { bottom: center, height: current - center };
    } else {
      // Below center: fill from current to center
      return { bottom: current, height: center - current };
    }
  });

  // Inverse-video clip: the slider region the fill currently covers, as a
  // clip-path inset in SCREEN space (the inverse label layer is never rotated, so
  // this holds regardless of the inner text's writing-mode). The inverse label is
  // clipped to this region so letters the fill has risen over flip to the on-fill
  // ink and stay readable. Empty fill → fully clipped (inverse hidden).
  let inverseClip = $derived.by(() => {
    if (centerOrigin) {
      const f = fillFromCenter();
      if (!f || f.height <= 0) return 'inset(0 0 100% 0)';
      const near = f.bottom;                    // gap before the fill (bottom/left)
      const far = 100 - (f.bottom + f.height);  // gap after the fill (top/right)
      return orientation === 'vertical'
        ? `inset(${far}% 0 ${near}% 0)`
        : `inset(0 ${far}% 0 ${near}%)`;
    }
    const off = 100 - fillPercent;  // uncovered portion (top for vertical, right for horizontal)
    return orientation === 'vertical'
      ? `inset(${off}% 0 0 0)`
      : `inset(0 ${off}% 0 0)`;
  });

  function handlePointerDown(event: PointerEvent) {
    event.preventDefault(); // Prevent scrolling and default behavior
    isDragging = true;

    // Store start position and current value for relative dragging
    startPointer = orientation === 'vertical' ? event.clientY : event.clientX;
    startValue = localValue;

    // Store tap detection data
    tapStartTime = Date.now();
    tapStartX = event.clientX;
    tapStartY = event.clientY;

    container.setPointerCapture(event.pointerId);
    throttle.start();

    onDown?.();
  }

  function handlePointerMove(event: PointerEvent) {
    if (!isDragging) return;
    event.preventDefault(); // Prevent scrolling during drag
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

    // Send final value immediately
    throttle.flush();
  }

  function updatePositionRelative(event: PointerEvent) {
    const rect = container.getBoundingClientRect();

    // Guard against invalid min/max
    if (max <= min) return;

    // Calculate delta from start position
    const currentPointer = orientation === 'vertical' ? event.clientY : event.clientX;
    const size = orientation === 'vertical' ? rect.height : rect.width;
    const delta = (currentPointer - startPointer) / size;

    // Apply delta to start value (invert for vertical)
    const normalizedDelta = orientation === 'vertical' ? -delta : delta;
    const normalizedValue = (startValue - min) / (max - min);
    const newNormalizedValue = Math.max(0, Math.min(1, normalizedValue + normalizedDelta));
    const newValue = min + (newNormalizedValue * (max - min));

    // Update local state immediately for visual feedback
    localValue = newValue;

    // Queue for frame-synchronized send
    throttle.push(newValue);
  }
</script>

<div class="device-slider {orientation}">
  <div
    class="slider-container"
    class:ghost={isGhost}
    bind:this={container}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
    role="slider"
    tabindex="0"
    aria-label="{title}: {localValue.toFixed(2)}"
    aria-valuenow={localValue}
    aria-valuemin={min}
    aria-valuemax={max}
    style="
      --slider-border: {isGhost ? 'color-mix(in oklab, var(--signal-dim) 30%, transparent)' : color.primary};
      --slider-tint: {color.primary};
      --slider-secondary: {color.secondary};
      {track ? '--slider-bg-override: transparent;' : ''}
    "
  >
    <!-- Meter Visualization (optional background) -->
    {#if track}
      <MeterVisualization {trackIndex} {track} color={meterColor} />
    {/if}

    <!-- Center line indicator — only meaningful alongside a center-out fill.
         In handle-line mode the handle is the sole position read, so a second
         full-width rule at center just competes with it. -->
    {#if centerOrigin && showFill}
      <div
        class="center-line {orientation}"
        style="
          background-color: {color.primary};
          {orientation === 'vertical'
            ? `bottom: ${centerPercent}%;`
            : `left: ${centerPercent}%;`}
        "
      ></div>
    {/if}

    <!-- Fill (suppressed in meter mode and when the handle line is showing) -->
    {#if showFill}
      {#if centerOrigin}
        <!-- Center origin mode: fill expands from center line -->
        {@const fill = fillFromCenter()}
        {#if fill}
          <div
            class="slider-fill {orientation}"
            class:dragging={isDragging}
            style="
              background-color: {color.primary};
              {orientation === 'vertical'
                ? `height: ${fill.height}%; bottom: ${fill.bottom}%;`
                : `width: ${fill.height}%; left: ${fill.bottom}%;`}
            "
          ></div>
        {/if}
      {:else}
        <!-- Normal mode: fill from bottom/left -->
        <div
          class="slider-fill {orientation}"
          class:dragging={isDragging}
          style="
            background-color: {color.primary};
            {orientation === 'vertical'
              ? `height: ${fillPercent}%; bottom: 0;`
              : `width: ${fillPercent}%; left: 0;`}
          "
        ></div>
      {/if}
    {/if}

    <!-- Title label. Two stacked layers: the base reads on the unfilled well
         (device tint, matching the XY label); the inverse copy is clipped to the
         filled region (inline clip-path) and uses an on-fill ink so letters stay
         readable once the fill rises over them. No inverse in meter mode. -->
    {#if title || label}
      <div class="slider-label label-{effectiveLabelOrientation} label-{labelSize}">
        <span class="slider-label-text">{#if label}{@render label()}{:else}{title}{/if}</span>
      </div>
      {#if showFill}
        <div
          class="slider-label slider-label--inverse label-{effectiveLabelOrientation} label-{labelSize}"
          style="clip-path: {inverseClip};"
          aria-hidden="true"
        >
          <span class="slider-label-text">{#if label}{@render label()}{:else}{title}{/if}</span>
        </div>
      {/if}
    {/if}

    <!-- Handle (meter mode or explicit handleLine; breaks around label) -->
    {#if showHandleLine}
      {#if orientation === 'vertical'}
        <!-- Vertical: Split into left and right segments -->
        <div
          class="slider-handle-segment vertical-left"
          class:dragging={isDragging}
          style="

            bottom: {fillPercent}%;
          "
        ></div>
        <div
          class="slider-handle-segment vertical-right"
          class:dragging={isDragging}
          style="

            bottom: {fillPercent}%;
          "
        ></div>
      {:else}
        <!-- Horizontal: Split into top and bottom segments -->
        <div
          class="slider-handle-segment horizontal-top"
          class:dragging={isDragging}
          style="

            left: {fillPercent}%;
          "
        ></div>
        <div
          class="slider-handle-segment horizontal-bottom"
          class:dragging={isDragging}
          style="

            left: {fillPercent}%;
          "
        ></div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .device-slider {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    user-select: none;
    font-family: var(--font-sans);
    font-size: 11px;
  }

  /* Inset WELL (§5.6): blur removed; the slider track is a recessed lane with a
     1px device hairline (--slider-tint = device ink; --slider-border = the
     hairline colour the call site sets inline: device ink, or a dim mix for a
     ghost — the frame never brightens on hover). --slider-bg-override still
     lets a meter take over the background. */
  .slider-container {
    position: relative;
    flex: 1;
    /* Size query so the label can scale to the slider (cqw/cqh) like the XY pad.
       `size` (not just inline-size) is needed so vertical labels can size off cqh. */
    container-type: size;
    border: 1px solid var(--slider-border, var(--slider-tint, var(--line)));
    border-radius: var(--radius-sm);
    cursor: pointer;
    overflow: hidden;
    /* Same reason as DeviceXY's `.xy-container`: without it a touch drag is
       claimed as a pan and cancelled a few px in. */
    touch-action: none;
    transition: background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    background: var(--slider-bg-override, var(--surface-well));
    box-shadow: inset 0 1px 0 oklch(0 0 0 / 0.5);
  }

  /* FX-grid sliders: a subtle device-tinted well (the card behind is already lit). */
  :global(.device-control) .slider-container {
    background: var(--slider-bg-override, color-mix(in oklab, var(--slider-secondary, transparent) 12%, var(--surface-well)));
  }

  /* Ghost: dim only the body (fill / center line / handle), not the label —
     mirrors DeviceXY so the device name rides a single parent dim and stays
     readable on the empty well. */
  .slider-container.ghost .slider-fill,
  .slider-container.ghost .center-line,
  .slider-container.ghost .slider-handle-segment {
    opacity: var(--opacity-ghost);
  }

  .slider-container:focus {
    outline: none;
    box-shadow: inset 0 1px 0 oklch(0 0 0 / 0.5), 0 0 0 2px var(--ring);
  }

  .slider-fill {
    position: absolute;
    transition: height 0.1s ease-out, width 0.1s ease-out;
    pointer-events: none;
  }

  /* Disable transitions during active dragging for instant response */
  .slider-fill.dragging {
    transition: none;
  }

  .slider-fill.vertical {
    width: 100%;
  }

  .slider-fill.horizontal {
    height: 100%;
    top: 0;
  }

  .center-line {
    position: absolute;
    pointer-events: none;
    opacity: 0.5;
  }

  .center-line.vertical {
    width: 100%;
    height: 2px;
    left: 0;
  }

  .center-line.horizontal {
    height: 100%;
    width: 2px;
    top: 0;
  }

  /* Title label — full-size layer that flex-centers its inner text. Kept un-rotated
     so the inverse copy's clip-path is in screen space; the text does the rotating. */
  .slider-label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 10;
  }
  /* Inverse copy sits above the base, clipped to the filled region. */
  .slider-label.slider-label--inverse {
    z-index: 11;
  }

  .slider-label-text {
    text-align: center;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    /* Match the XY center-title — device tint at 70%; reads on the unfilled well. */
    color: color-mix(in oklab, var(--slider-tint, var(--foreground)) 70%, transparent);
  }
  /* On-fill ink — dark, reads on top of the bright device-color fill. */
  .slider-label--inverse .slider-label-text {
    color: var(--card);
  }
  /* Ghost: full device tint, no dim — reads clearly on the empty well (matches XY). */
  .slider-container.ghost .slider-label-text {
    color: var(--slider-tint, var(--foreground));
  }

  /* Vertical label: text runs vertically (bottom to top). */
  .slider-label.label-vertical .slider-label-text {
    writing-mode: vertical-lr;
    transform: rotate(180deg);
  }
  /* Horizontal label: text runs horizontally. */
  .slider-label.label-horizontal .slider-label-text {
    writing-mode: horizontal-tb;
  }

  /* Label sizes — fluid, scaling with the slider like the XY pad's center title.
     The text runs along the slider's long axis, so size off that axis: cqh for a
     vertical label (tall slider), cqw for a horizontal label (wide slider). Bigger
     min/max than the old fixed 18/30px. */
  .slider-label.label-small.label-vertical .slider-label-text {
    font-size: clamp(26px, 10cqh, 60px);
  }
  .slider-label.label-small.label-horizontal .slider-label-text {
    font-size: clamp(26px, 10cqw, 60px);
  }
  .slider-label.label-large.label-vertical .slider-label-text {
    font-size: clamp(38px, 16cqh, 80px);
  }
  .slider-label.label-large.label-horizontal .slider-label-text {
    font-size: clamp(38px, 16cqw, 80px);
  }

  /* White-hot handle line (§5.6) — device ink toward white, no shadow. */
  .slider-handle-segment {
    position: absolute;
    pointer-events: none;
    z-index: 11;
    background-color: color-mix(in oklab, var(--slider-tint, white) 55%, white);
    transition: bottom 0.1s ease-out, left 0.1s ease-out;
  }

  /* Disable transitions during active dragging for instant response */
  .slider-handle-segment.dragging {
    transition: none;
  }

  /* ---- Flat grammar: a flat ControlBackground lane in a 1px dark frame, no
     inset lighting; the value fill keeps the device ink (Live fills its
     ranges in colour), the label is Live's control text — normal case,
     medium weight, light grey — and the handle is ControlFillHandle grey.
     The frame ignores --slider-border (the call site's ink) on purpose. */
  :global([data-grammar="flat"]) .slider-container,
  :global([data-grammar="flat"] .device-control) .slider-container {
    background: var(--slider-bg-override, var(--surface-well));
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    box-shadow: none;
  }
  :global([data-grammar="flat"]) .slider-container:focus {
    box-shadow: 0 0 0 1px var(--flat-selection);
  }
  :global([data-grammar="flat"]) .slider-label-text {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
    color: var(--foreground);
  }
  :global([data-grammar="flat"]) .slider-label--inverse .slider-label-text {
    color: var(--flat-on-fg);
  }
  :global([data-grammar="flat"]) .slider-container.ghost .slider-label-text {
    color: var(--signal-dim);
  }
  :global([data-grammar="flat"]) .slider-label.label-small.label-vertical .slider-label-text {
    font-size: clamp(20px, 8cqh, 40px);
  }
  :global([data-grammar="flat"]) .slider-label.label-small.label-horizontal .slider-label-text {
    font-size: clamp(20px, 8cqw, 40px);
  }
  :global([data-grammar="flat"]) .slider-label.label-large.label-vertical .slider-label-text {
    font-size: clamp(24px, 11cqh, 48px);
  }
  :global([data-grammar="flat"]) .slider-label.label-large.label-horizontal .slider-label-text {
    font-size: clamp(24px, 11cqw, 48px);
  }
  :global([data-grammar="flat"]) .slider-handle-segment {
    background-color: var(--flat-handle);
  }

  /* Hybrid skin: Live's grammar, but the device family keeps its voice —
     label in the device ink (its fill already is), on the flat grey module. */
  :global([data-skin="hybrid"]) .slider-label-text {
    color: var(--slider-tint, var(--foreground));
  }
  /* Light: the fill envelope (L .66–.80) is too pale for TEXT on paper —
     pull the label toward the foreground, hue kept. */
  :global(.light[data-skin="hybrid"]) .slider-label-text {
    color: color-mix(in oklab, var(--slider-tint, var(--foreground)) 55%, var(--foreground));
  }
  :global([data-skin="hybrid"]) .slider-label--inverse .slider-label-text {
    color: var(--flat-on-fg);
  }
  :global([data-skin="hybrid"]) .slider-container.ghost .slider-label-text {
    color: color-mix(in srgb, var(--slider-tint, var(--foreground)) 70%, var(--signal-dim));
  }

  /* Vertical orientation: horizontal line segments (left and right of label) */
  .slider-handle-segment.vertical-left {
    height: 2px;
    left: 0;
    width: 15%; /* Large gap for label */
  }

  .slider-handle-segment.vertical-right {
    height: 2px;
    right: 0;
    width: 15%; /* Large gap for label */
  }

  /* Horizontal orientation: vertical line segments (top and bottom of label) */
  .slider-handle-segment.horizontal-top {
    width: 2px;
    top: 0;
    height: 15%; /* Large gap for label */
  }

  .slider-handle-segment.horizontal-bottom {
    width: 2px;
    bottom: 0;
    height: 15%; /* Large gap for label */
  }
</style>
