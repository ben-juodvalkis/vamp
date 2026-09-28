<script lang="ts">
  /**
   * SequencerPatternGrid - EXACT copy of V5's BaseSequencerPattern
   *
   * Provides the exact same segmented rectangle pattern display with
   * length slider on left and rate slider on right.
   */
  import { PERMUTE_MAX_STEPS } from '$lib/config/permuteLayout';

  interface Props {
    steps: boolean[];
    length: number;
    currentStep: number;
    playing: boolean;
    readonly?: boolean;
    variant?: 'mute' | 'pitch';
    /** Track color for the mute row; falls back to orange. Greyed when dimmed. */
    muteColor?: string;
    dimmed?: boolean;
    showLengthSlider?: boolean;
    showRateSlider?: boolean;
    rateMode?: string;
    rateValue?: number;
    rateDisplayString?: string;
    onStepToggle?: (index: number) => void;
    onStepSet?: (index: number, value: boolean) => void;
    onLengthChange?: (length: number) => void;
    onRateChange?: (mode: string, value: number) => void;
    onEnable?: () => void;
  }

  let {
    steps,
    length,
    currentStep,
    playing,
    readonly = false,
    variant = 'mute',
    muteColor,
    dimmed = false,
    showLengthSlider = true,
    showRateSlider = true,
    rateMode = '16ths',
    rateValue = 1,
    rateDisplayString = '1/16',
    onStepToggle,
    onStepSet,
    onLengthChange,
    onRateChange,
    onEnable
  }: Props = $props();

  // Drag interaction state for pattern
  let isDragging = $state(false);
  let lastDraggedStep = $state<number | null>(null);

  // Drag state for length slider
  let isDraggingLength = $state(false);
  let startLengthY = $state(0);
  let startLengthValue = $state(0);

  // Drag state for rate slider
  let isDraggingRate = $state(false);
  let startRateY = $state(0);
  let startRateIndex = $state(0);

  // Constants
  const MIN_LENGTH = 2;
  const MAX_LENGTH = PERMUTE_MAX_STEPS;
  const LENGTH_DRAG_SENSITIVITY = 20; // pixels per step
  const RATE_DRAG_SENSITIVITY = 25; // pixels per rate step

  // Rate progression: drag down = slower, drag up = faster
  const rateProgression = [
    { mode: 'bars', value: 8, display: '8 bars' },
    { mode: 'bars', value: 4, display: '4 bars' },
    { mode: 'bars', value: 2, display: '2 bars' },
    { mode: 'bars', value: 1, display: '1 bar' },
    { mode: '16ths', value: 8, display: '1/2' },
    { mode: '16ths', value: 4, display: '1/4' },
    { mode: '16ths', value: 2, display: '1/8' },
    { mode: '16ths', value: 1, display: '1/16' }
  ];

  // Find current rate index in progression
  let currentRateIndex = $derived(
    rateProgression.findIndex(rate =>
      rate.mode === rateMode && rate.value === rateValue
    )
  );

  // Get abbreviated display for the rate box
  let shortRateDisplay = $derived(
    currentRateIndex >= 0 ? rateProgression[currentRateIndex].display : '1/16'
  );

  // Size configuration - using 'large' size from V5
  const currentSize = {
    height: 'h-16',
    heightPx: 64,
    border: 'border-2',
    rounded: 'rounded-lg'
  };

  // Variant color schemes.
  // Current-step styling: bright inset border in a lighter shade of
  // the variant hue, plus a colored glow on the playing step. (ADR-360
  // retired the TrackStrip MiniSequencer that previously shared this
  // styling; the look is preserved here for the Central-View grid.)
  // Mute row takes the track color (greyed when dimmed); falls back to the
  // original orange when no color is supplied. Drives both the inline step
  // fill and the --mute-color var the current-step glow rules read.
  // Mute row takes the (trackInk) track color; greys to signal-dim when dimmed.
  let resolvedMuteColor = $derived(dimmed ? 'var(--signal-dim)' : (muteColor ?? 'var(--signal-dim)'));

  // §5.7: ONE knob (--seq-color) drives every step grid — mute rides the track
  // ink, pitch rides --act-pitch. The shared step classes consume --seq-color.
  let seqColor = $derived(variant === 'mute' ? resolvedMuteColor : 'var(--act-pitch)');

  const colors = {
    enabled: 'seq-enabled-step',
    enabledHover: '',
    disabled: 'bg-muted/40',
    disabledHover: 'hover:bg-muted/60',
    currentEnabledPlaying: 'current-enabled-playing',
    currentDisabledPlaying: 'current-disabled-playing',
    currentEnabledStopped: 'current-enabled-stopped',
    currentDisabledStopped: 'current-disabled-stopped',
    inactive: 'bg-muted/20'
  };

  // Helper functions
  function isStepActive(stepIndex: number): boolean {
    return stepIndex < length;
  }

  function isCurrentStep(stepIndex: number): boolean {
    return currentStep === stepIndex && isStepActive(stepIndex);
  }

  function isStepEnabled(stepIndex: number): boolean {
    return steps[stepIndex] || false;
  }

  // Get step segment class for styling
  function getStepSegmentClass(stepIndex: number): string {
    const base = `flex-1 h-full transition-colors duration-150 ${readonly ? 'cursor-default' : 'cursor-pointer'} select-none`;

    if (!isStepActive(stepIndex)) {
      // Inactive step (beyond pattern length)
      return `${base} ${colors.inactive}`;
    }

    if (isCurrentStep(stepIndex)) {
      // Current step (playing or stopped)
      if (isStepEnabled(stepIndex)) {
        const currentStyle = playing ? colors.currentEnabledPlaying : colors.currentEnabledStopped;
        return `${base} ${currentStyle}`;
      } else {
        const currentStyle = playing ? colors.currentDisabledPlaying : colors.currentDisabledStopped;
        return `${base} ${currentStyle}`;
      }
    }

    if (isStepEnabled(stepIndex)) {
      // Enabled step
      return `${base} ${colors.enabled} ${readonly ? '' : colors.enabledHover}`;
    } else {
      // Disabled step
      return `${base} ${colors.disabled} ${readonly ? '' : colors.disabledHover}`;
    }
  }

  // Pattern interaction handlers
  function handleStepPointerDown(event: PointerEvent, stepIndex: number) {
    if (readonly || !isStepActive(stepIndex)) return;

    event.preventDefault();
    isDragging = true;
    lastDraggedStep = stepIndex;

    // Auto-enable sequencer on first touch
    if (onEnable) {
      onEnable();
    }

    // Toggle the initial step immediately
    if (onStepToggle) {
      onStepToggle(stepIndex);
    }

    // Capture pointer for drag continuation
    const target = event.target as Element;
    target.setPointerCapture(event.pointerId);
  }

  // Global pointer move handler when dragging pattern
  function handleGlobalPointerMove(event: PointerEvent) {
    if (!isDragging) return;

    // Find which step we're over by using elementFromPoint
    const point = document.elementFromPoint(event.clientX, event.clientY);
    if (!point) return;

    // Find the step index from the element
    const stepElement = point.closest('[data-step-index]');
    if (!stepElement) return;

    const stepIndex = parseInt(stepElement.getAttribute('data-step-index') || '-1');
    if (stepIndex === -1 || !isStepActive(stepIndex)) return;

    // Only toggle if we've moved to a different step
    if (lastDraggedStep !== stepIndex) {
      lastDraggedStep = stepIndex;
      if (onStepToggle) {
        onStepToggle(stepIndex);
      }
    }
  }

  // Also the `pointercancel` handler — see the binding below.
  function handleStepPointerUp(event: PointerEvent) {
    if (!isDragging) return;

    event.preventDefault();

    // Reset drag state
    isDragging = false;
    lastDraggedStep = null;

    // Remove global event listener
    document.removeEventListener('pointermove', handleGlobalPointerMove);

    // Release pointer capture. Guarded: `releasePointerCapture` throws when
    // the capture is already gone, which is the normal state on
    // `pointercancel` (the browser releases before dispatching) and also
    // when the pointer ended over a different cell than it started on.
    const target = event.target as Element;
    if (target?.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  }

  // Length slider handlers
  function handleLengthPointerDown(event: PointerEvent) {
    if (readonly) return;

    event.preventDefault();
    isDraggingLength = true;
    startLengthY = event.clientY;
    startLengthValue = length;

    // Auto-enable sequencer
    if (onEnable) {
      onEnable();
    }

    // Capture pointer
    const target = event.target as Element;
    target.setPointerCapture(event.pointerId);
  }

  function handleLengthPointerMove(event: PointerEvent) {
    if (!isDraggingLength) return;

    event.preventDefault();

    // Calculate length change based on vertical movement
    const deltaY = startLengthY - event.clientY; // Negative Y = up = increase
    const stepsChanged = Math.round(deltaY / LENGTH_DRAG_SENSITIVITY);

    // Calculate new length
    const newLength = Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, startLengthValue + stepsChanged));

    // Only update if length actually changed
    if (newLength !== length && onLengthChange) {
      onLengthChange(newLength);
    }
  }

  function handleLengthPointerUp(event: PointerEvent) {
    if (!isDraggingLength) return;

    event.preventDefault();
    isDraggingLength = false;
    startLengthY = 0;
    startLengthValue = 0;
  }

  // Rate slider handlers
  function handleRatePointerDown(event: PointerEvent) {
    if (readonly) return;

    event.preventDefault();
    isDraggingRate = true;
    startRateY = event.clientY;
    startRateIndex = currentRateIndex;

    // Auto-enable sequencer
    if (onEnable) {
      onEnable();
    }

    // Capture pointer
    const target = event.target as Element;
    target.setPointerCapture(event.pointerId);
  }

  function handleRatePointerMove(event: PointerEvent) {
    if (!isDraggingRate) return;

    event.preventDefault();

    // Calculate rate change based on vertical movement
    const deltaY = startRateY - event.clientY; // Negative Y = up = faster
    const stepsChanged = Math.round(deltaY / RATE_DRAG_SENSITIVITY);

    // Calculate new rate index (clamped to valid range)
    const newRateIndex = Math.max(0, Math.min(rateProgression.length - 1, startRateIndex + stepsChanged));

    // Only update if rate actually changed
    if (newRateIndex !== currentRateIndex && onRateChange) {
      const newRate = rateProgression[newRateIndex];
      onRateChange(newRate.mode, newRate.value);
    }
  }

  function handleRatePointerUp(event: PointerEvent) {
    if (!isDraggingRate) return;

    event.preventDefault();
    isDraggingRate = false;
    startRateY = 0;
    startRateIndex = 0;
  }

  // Set up global event listener when dragging starts.
  //
  // The teardown is unconditional on purpose. It used to be wrapped in
  // `if (isDragging)`, but a cleanup closure reads the *current* value of a
  // `$state` rune, not the value from the run that registered it — and the
  // only thing that re-runs this effect is `isDragging` going true → false.
  // So the guard was false exactly when the listener needed removing, and
  // every completed pattern drag leaked a document-level `pointermove`
  // listener for the life of the view. `removeEventListener` with a
  // never-registered handler is a no-op, so dropping the guard is free.
  $effect(() => {
    if (isDragging) {
      document.addEventListener('pointermove', handleGlobalPointerMove);
    }

    return () => {
      document.removeEventListener('pointermove', handleGlobalPointerMove);
    };
  });
</script>

<div class="h-full flex items-center" style="gap: var(--spacing-sm); --seq-color: {seqColor};">
  <!-- Length Slider (if enabled) -->
  {#if showLengthSlider}
    <div
      class="seq-ctrl glass-panel h-full border-2 flex items-center justify-center cursor-ns-resize select-none transition-colors duration-150 relative overflow-hidden {readonly ? 'cursor-default opacity-50' : 'hover:bg-accent/20 active:bg-accent/40'}"
      style="aspect-ratio: 1; border-radius: var(--radius-sm);"
      onpointerdown={handleLengthPointerDown}
      onpointermove={handleLengthPointerMove}
      onpointerup={handleLengthPointerUp}
      title="Pattern Length: {length} steps (drag up/down to change)"
      aria-label="Pattern length slider: {length} steps"
      role="slider"
      aria-valuemin={MIN_LENGTH}
      aria-valuemax={MAX_LENGTH}
      aria-valuenow={length}
      tabindex={readonly ? -1 : 0}
    >
      <!-- Fill indicator (bottom to top based on length) -->
      <div
        class="seq-fill absolute inset-x-0 bottom-0 pointer-events-none"
        style="height: {(length / MAX_LENGTH) * 100}%;"
      ></div>
      <span class="seq-value text-2xl font-bold text-foreground relative z-10">
        {length}
      </span>
    </div>
  {/if}

  <!-- Pattern Segments -->
  <div
    class="seq-grid glass-panel flex-1 h-full {currentSize.border} {currentSize.rounded} overflow-hidden"
    title="Sequencer Pattern - {length} steps"
  >
    <div class="h-full flex touch-manipulation">
      {#each Array(length) as _, stepIndex}
        <div
          class="step-cell {getStepSegmentClass(stepIndex)}"
          data-step-index={stepIndex}
          onpointerdown={(e) => handleStepPointerDown(e, stepIndex)}
          onpointerup={handleStepPointerUp}
          onpointercancel={handleStepPointerUp}
          title="Step {stepIndex + 1}: {isStepEnabled(stepIndex) ? 'Enabled' : 'Disabled'}"
          aria-label="Step {stepIndex + 1}"
          role="button"
          tabindex={readonly ? -1 : 0}
        ></div>
        <!-- Separator between segments (not after last one) -->
        {#if stepIndex < length - 1}
          <div class="w-px bg-border"></div>
        {/if}
      {/each}
    </div>
  </div>

  <!-- Rate Slider (if enabled) -->
  <!-- (see <style> below for current-step playhead styling) -->
  {#if showRateSlider}
    <div
      class="seq-ctrl glass-panel h-full border-2 flex items-center justify-center cursor-ns-resize select-none transition-colors duration-150 relative overflow-hidden {readonly ? 'cursor-default opacity-50' : 'hover:bg-accent/20 active:bg-accent/40'}"
      style="aspect-ratio: 1; border-radius: var(--radius-sm);"
      onpointerdown={handleRatePointerDown}
      onpointermove={handleRatePointerMove}
      onpointerup={handleRatePointerUp}
      title="Rate: {rateDisplayString} (drag up/down to change)"
      aria-label="Rate slider: {rateDisplayString}"
      role="slider"
      aria-valuemin={0}
      aria-valuemax={rateProgression.length - 1}
      aria-valuenow={currentRateIndex}
      tabindex={readonly ? -1 : 0}
    >
      <!-- Fill indicator (bottom to top based on rate) -->
      <div
        class="seq-fill absolute inset-x-0 bottom-0 pointer-events-none"
        style="height: {(currentRateIndex / (rateProgression.length - 1)) * 100}%;"
      ></div>
      <span class="seq-value text-2xl font-bold text-foreground relative z-10">
        {shortRateDisplay}
      </span>
    </div>
  {/if}
</div>

<style>
  /* Current-step playhead — base variant color as the fill (so it
     doesn't read paler than neighbors), a thin brighter inset border,
     and a very subtle glow only on the playing state. The bg is set
     here rather than via a Tailwind class so the inset border + bg
     render together. ADR-360 retired the TrackStrip MiniSequencer that
     used to share these tones; the look is preserved here as the
     authoritative grid. */

  /* Unified current-step playhead (§5.7) — base seq color fill + a brighter
     inset border, NO glow. Mute rides the track ink, pitch rides --act-pitch;
     both flow through the single --seq-color set on the container. */
  :global(.seq-enabled-step) {
    background: var(--seq-color);
  }
  :global(.current-enabled-stopped) {
    background: color-mix(in srgb, var(--seq-color), white 30%);
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--seq-color), black 20%);
  }
  :global(.current-enabled-playing) {
    background: color-mix(in srgb, var(--seq-color), white 40%);
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--seq-color), black 10%);
  }
  :global(.current-disabled-stopped) {
    background: color-mix(in srgb, var(--muted), transparent 40%);
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--seq-color), black 25%);
  }
  :global(.current-disabled-playing) {
    background: color-mix(in srgb, var(--muted), transparent 30%);
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--seq-color), black 15%);
  }

  /* Length / rate boxes and the step row: a recessed well; the box frames
     take a 70% ink mix, the row a plain hairline. Class-owned (rather than
     inline) so the flat block below can re-skin them by specificity —
     `.seq-ctrl` / `.seq-grid` (scoped) out-rank app.css's `.glass-panel`. */
  .seq-ctrl {
    background: var(--surface-well);
    border-color: color-mix(in oklab, var(--seq-color) 70%, transparent);
  }
  .seq-grid {
    background: var(--surface-well);
    border-color: var(--line);
  }
  .seq-fill {
    background-color: color-mix(in oklab, var(--seq-color) 70%, transparent);
  }

  /* Respect the outer container's rounded corners on the first and
     last step cells, so the inset border doesn't square off past the
     container's curve. Matches rounded-lg (var(--radius-lg)). */
  .step-cell:first-child {
    border-top-left-radius: calc(var(--radius-lg) - 2px);
    border-bottom-left-radius: calc(var(--radius-lg) - 2px);
  }
  .step-cell:last-child {
    border-top-right-radius: calc(var(--radius-lg) - 2px);
    border-bottom-right-radius: calc(var(--radius-lg) - 2px);
  }

  /* ---- Live skin: the step row is a ControlBackground well in a 1px dark
     frame; an OFF step is the bare well, an ON step a SOLID block of the
     row ink (track colour / FreezeColor blue), and the current step wears a
     crisp 1px SelectionBackground frame instead of the whitened fill + dark
     inset ring. Length / rate boxes are the same field with a solid value
     fill; the inline ink-mix frames give way to the dark control frame. */
  :global([data-grammar="flat"]) .seq-ctrl,
  :global([data-grammar="flat"]) .seq-grid {
    background: var(--surface-well); /* app.css's flat .glass-panel says --card */
    border-color: var(--line-strong); /* ink-mix / var(--line) */
    box-shadow: none;
  }
  :global([data-grammar="flat"]) .seq-fill {
    background-color: var(--seq-color); /* 70% wash → solid ink */
  }
  :global([data-grammar="flat"]) .seq-value {
    font-weight: var(--font-weight-medium);
  }
  /* OFF step: the well itself (Tailwind's bg-muted/40 wash is a layered
     utility, so this unlayered rule wins); hover = SurfaceHighlight. The ON
     and current rules below out-rank these by order + specificity. */
  :global([data-grammar="flat"]) .step-cell {
    background: var(--surface-well);
  }
  :global([data-grammar="flat"]) .step-cell:hover {
    background: var(--secondary);
  }
  :global([data-grammar="flat"]) .step-cell.seq-enabled-step {
    background: var(--seq-color);
  }
  :global([data-grammar="flat"]) .step-cell.current-enabled-stopped,
  :global([data-grammar="flat"]) .step-cell.current-enabled-playing {
    background: var(--seq-color);
    box-shadow: inset 0 0 0 1px var(--flat-selection);
  }
  :global([data-grammar="flat"]) .step-cell.current-disabled-stopped,
  :global([data-grammar="flat"]) .step-cell.current-disabled-playing {
    background: var(--surface-well);
    box-shadow: inset 0 0 0 1px var(--flat-selection);
  }
</style>
