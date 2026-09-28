<script lang="ts">
  import { PITCH_COLOR, MOD_COLOR, type DeviceColorScheme } from '$lib/config/devicePresets';
  import { createSliderThrottle } from '$lib/utils/sliderThrottle';

  interface Props {
    type: 'pitch' | 'modwheel';
    onInteraction?: (value: number) => void;
    color?: DeviceColorScheme;
    height?: string;
    width?: string;
  }

  let {
    type,
    onInteraction,
    color = type === 'pitch' ? PITCH_COLOR : MOD_COLOR,
    height = '100%',
    width = '100%'
  }: Props = $props();

  let isDragging = $state(false);
  let container: HTMLDivElement;
  let lastY = $state(0);

  // Absolute values
  // Pitch: 0-16383, center at 8192
  // Mod: 0-127
  const PITCH_CENTER = 8192;
  const PITCH_MAX = 16383;
  const MOD_MAX = 127;

  let currentValue = $state(type === 'pitch' ? PITCH_CENTER : 0);

  // Frame-synchronized throttle for smooth MIDI updates
  const throttle = createSliderThrottle((value: number) => {
    onInteraction?.(Math.round(value));
  });

  // Display name — authored mixed-case; Graticule upper-cases it in CSS
  // (.wheel-label), the flat grammar shows it as written.
  let displayName = $derived(type === 'pitch' ? 'Pitch' : 'Mod');

  // Calculate position percentage (0-100) for handle and fill
  let positionPercent = $derived(
    type === 'pitch'
      ? (currentValue / PITCH_MAX) * 100
      : (currentValue / MOD_MAX) * 100
  );

  function handlePointerDown(event: PointerEvent) {
    isDragging = true;
    lastY = event.clientY;
    container.setPointerCapture(event.pointerId);
    throttle.start();
  }

  function handlePointerMove(event: PointerEvent) {
    if (!isDragging) return;

    const deltaY = lastY - event.clientY; // Positive = up, negative = down
    lastY = event.clientY;

    // Update value based on drag delta
    const rect = container.getBoundingClientRect();
    const normalizedDelta = deltaY / rect.height;

    if (type === 'pitch') {
      const valueDelta = normalizedDelta * PITCH_MAX;
      currentValue = Math.max(0, Math.min(PITCH_MAX, currentValue + valueDelta));
    } else {
      const valueDelta = normalizedDelta * MOD_MAX;
      currentValue = Math.max(0, Math.min(MOD_MAX, currentValue + valueDelta));
    }

    // Queue for frame-synchronized send
    throttle.push(currentValue);
  }

  // Also the `pointercancel` handler. A cancel is what the browser sends
  // when it takes the gesture away mid-drag — the iPad's system edge swipe,
  // a palm landing on the glass, a scroll the page decides to own. Without
  // this bound, `isDragging` stayed true and a pitch bend stayed bent with
  // no finger on it, until the next pointerdown.
  function handlePointerUp(event: PointerEvent) {
    isDragging = false;

    // `releasePointerCapture` throws if the capture is already gone, which
    // is the normal state on `pointercancel` — the browser releases it
    // before dispatching. Unguarded, that throw skipped the spring-back
    // below and left the wheel stuck.
    if (container?.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId);
    }

    // Flush any pending value first
    throttle.flush();

    // Pitch wheel springs back to center
    if (type === 'pitch') {
      currentValue = PITCH_CENTER;
      onInteraction?.(PITCH_CENTER);
    }
    // Mod wheel stays where it is
  }
</script>

<div class="midi-wheel" style="width: {width}; height: {height};">
  <div
    class="wheel-container"
    class:dragging={isDragging}
    bind:this={container}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
    role="slider"
    tabindex="0"
    aria-label="{displayName} wheel"
    aria-valuenow={currentValue}
    aria-valuemin={0}
    aria-valuemax={type === 'pitch' ? PITCH_MAX : MOD_MAX}
    style="--wheel-ink: {color.primary};"
  >
    <!-- Wheel label inside container -->
    <div class="wheel-label">
      {displayName}
    </div>

    <!-- Center line (only for pitch bend) -->
    {#if type === 'pitch'}
      <div class="center-line" style="background: {color.primary};"></div>
    {/if}

    <!-- Fill bar -->
    {#if type === 'pitch'}
      <!-- Pitch: Fill from center (50%) -->
      {#if positionPercent >= 50}
        <!-- Up from center -->
        <div
          class="wheel-fill"
          style="
            bottom: 50%;
            height: {positionPercent - 50}%;
            background: {color.primary};
          "
        ></div>
      {:else}
        <!-- Down from center -->
        <div
          class="wheel-fill"
          style="
            bottom: {positionPercent}%;
            height: {50 - positionPercent}%;
            background: {color.primary};
          "
        ></div>
      {/if}
    {:else}
      <!-- Mod: Fill from bottom -->
      <div
        class="wheel-fill"
        style="
          bottom: 0;
          height: {positionPercent}%;
          background: {color.primary};
        "
      ></div>
    {/if}

    <!-- Handle -->
    <div
      class="wheel-handle"
      class:dragging={isDragging}
      style="bottom: {positionPercent}%;"
    ></div>
  </div>
</div>

<style>
  .midi-wheel {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    user-select: none;
    font-family: var(--font-sans);
  }

  /* --wheel-ink (set inline on .wheel-container by the call site's colour) is
     the wheel's ink: hairline, 12% well wash, label, and handle all read it. */
  .wheel-label {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 10px;
    font-weight: bold;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--wheel-ink);
    z-index: 2;
    pointer-events: none;
  }

  /* Inset WELL + hairline (§5.6 family) — blur/filter-free; the fill carries the ink. */
  .wheel-container {
    position: relative;
    flex: 1;
    width: 100%;
    height: 100%;
    background: color-mix(in oklab, var(--wheel-ink, var(--surface-well)) 12%, var(--surface-well));
    box-shadow: var(--well-shadow); /* = inset 0 1px 0 oklch(0 0 0 / 0.5) in Graticule; none under flat */
    border: 1px solid var(--wheel-ink, var(--line));
    border-radius: var(--radius-md);
    cursor: ns-resize;
    overflow: hidden;
    transition: border-color 0.15s ease, background-color 0.15s ease;
    touch-action: none;
  }

  .wheel-container.dragging {
    cursor: grabbing;
  }

  .wheel-container:focus {
    outline: none;
    box-shadow: var(--well-shadow), 0 0 0 2px var(--ring);
  }

  /* Center line for pitch bend (50% mark) */
  .center-line {
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 2px;
    opacity: 0.5;
    pointer-events: none;
    transform: translateY(-50%);
  }

  /* Fill bar from bottom */
  .wheel-fill {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    opacity: 0.3;
    pointer-events: none;
  }

  /* Draggable handle — ink toward white. */
  .wheel-handle {
    position: absolute;
    left: 50%;
    width: 90%;
    height: 12px;
    border-radius: 6px;
    transform: translate(-50%, 50%);
    background: color-mix(in oklab, var(--wheel-ink, white) 55%, white);
    pointer-events: none;
  }

  .wheel-handle.dragging {
    height: 16px;
    transform: translate(-50%, 50%) scale(1.05);
  }

  /* ---- Flat grammar (cookbook §8.1): each wheel is a flat
     ControlBackground lane in a 1px dark frame, 2px radius — no ink wash
     on the well, no inset lip. The fill KEEPS the track ink (the wheels are
     the track's voice, ADR-402 — a performance control, not a device range,
     so no RangeDefault swap) but goes solid instead of a 30% tint; the grip
     is a square ControlFillHandle bar; Pitch/Mod is control text — as
     written, medium, no tracking, foreground. Focus is Live's 1px selection
     ring (the Graticule `var(--well-shadow), ring` pair collapses to none
     under flat because --well-shadow is `none` there). Graticule is
     untouched — every rule sits under [data-grammar="flat"]. */
  :global([data-grammar="flat"]) .wheel-container {
    background: var(--surface-well);
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    box-shadow: none;
  }
  :global([data-grammar="flat"]) .wheel-container:focus {
    box-shadow: 0 0 0 1px var(--flat-selection);
  }
  :global([data-grammar="flat"]) .wheel-label {
    text-transform: none;
    letter-spacing: 0;
    font-weight: var(--font-weight-medium);
    color: var(--foreground);
  }
  :global([data-grammar="flat"]) .wheel-fill {
    opacity: 1;
  }
  :global([data-grammar="flat"]) .wheel-handle {
    background: var(--flat-handle);
    border-radius: 0;
  }
</style>