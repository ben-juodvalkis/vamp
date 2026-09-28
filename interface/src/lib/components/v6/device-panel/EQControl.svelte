<script lang="ts">
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import FilterCurve from './FilterCurve.svelte';
  import DeviceXY from './DeviceXY.svelte';

  interface Props {
    device: DeviceRecord | null;
    position: import('$lib/config/fxGridLayout').PositionKey;
  }

  let { device, position }: Props = $props();

  // Parameter configuration from device-configs.json
  const PARAM_CONFIG = {
    lowGain: {
      index: 2,
      min: 0,
      max: 1,
      type: 'float' as const
    },
    highGain: {
      index: 5,
      min: 0,
      max: 1,
      type: 'float' as const
    },
    midGain: {
      index: 3,
      min: 0,
      max: 1,
      type: 'float' as const
    },
    midFreq: {
      index: 4,
      min: 0,
      max: 1,
      type: 'float' as const
    }
  };

  // Reactive view of armed/store state. Drag handlers route through
  // sendParam/storePendingParam below; the arm in setParamValue keeps
  // the visual consistent during the round-trip.
  let lowGainValue = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.lowGain.index)) ?? 0.5
      : 0.5
  );
  let highGainValue = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.highGain.index)) ?? 0.5
      : 0.5
  );
  let midGainValue = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.midGain.index)) ?? 0.5
      : 0.5
  );
  let midFreqValue = $derived(
    device
      ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, PARAM_CONFIG.midFreq.index)) ?? 0.53
      : 0.625
  );

  // Convert normalized values to frequency bands for curve visualization
  let bands = $derived([
    {
      freq: 120,
      gain: (lowGainValue - 0.5) * 24,
      q: 0.71,
      type: 'lowshelf'
    },
    {
      freq: Math.pow(10, 2 + midFreqValue * 2),
      gain: (midGainValue - 0.5) * 24,
      q: 0.5,
      type: 'peak'
    },
    {
      freq: 4500,
      gain: (highGainValue - 0.5) * 24,
      q: 0.4,
      type: 'highshelf'
    }
  ]);

  // Drag state for bass/treble sliders (with movement tracking for tap detection)
  let lowDragState = $state({ dragging: false, startY: 0, startValue: 0, hasMoved: false });
  let highDragState = $state({ dragging: false, startY: 0, startValue: 0, hasMoved: false });
  const TAP_MOVEMENT_THRESHOLD = 5; // pixels - matches DeviceXY

</script>

<style>
  /* Make DeviceXY border, background, and focus ring transparent in EQ context —
     the mid-band pad rides on the shared curve, so it must have no frame of its own.
     !important: these fight DeviceXY's own scoped rules (higher specificity, other
     file), so ordering/specificity can't be relied on. */
  :global(.eq-xy-invisible .xy-container),
  :global(.eq-xy-invisible .xy-container:focus),
  :global(.eq-xy-invisible .xy-container:hover) {
    border-color: transparent !important;
    background: transparent !important;
    box-shadow: none !important;
  }

  /* EQ title — mirrors DeviceXY's .center-title so the FX-grid labels match:
     same fluid size, weight, casing, spacing. Color (device tint) is set inline
     from `color.primary`. Rides full brightness even in ghost mode — the ghost
     dim is applied to the filter-curve body, not the label (matches XY/slider). */
  .eq-title {
    font-size: clamp(26px, 10cqw, 64px);
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

<BaseDeviceControl {position} {device} title="EQ" showMoveToTop={true} showMoveToEnd={true}>
  {#snippet children({ sendParam, storePendingParam, triggerLoad, isGhost, isLoading, color, openView })}
    <div
      class="eq-panel relative w-full h-full glass-panel-subtle rounded-lg overflow-hidden"
      role="group"
      aria-label="EQ controls"
      onclick={() => {
        // Tap only previews central view - does NOT load device (ADR-167)
        openView();
      }}
    >
      <!-- Title overlay - matches DeviceXY .center-title (fluid size, device tint).
           Full brightness in ghost mode; only the curve body below dims. -->
      <div
        class="eq-title absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none select-none"
        style="color: {isGhost ? color.primary : `color-mix(in oklab, ${color.primary} 70%, transparent)`};"
      >EQ</div>

      <!-- Background: Filter curve visualization (full screen) -->
      <div class="absolute inset-0 pointer-events-none z-0" class:opacity-60={isGhost}>
        <FilterCurve
          curveType="eq"
          bands={bands}
          width={200}
          height={200}
        />
      </div>

      <!-- Foreground: Controls overlay (full screen) -->
      <div class="absolute inset-0 flex gap-1 p-1 z-10">
        <!-- Bass slider (left) - invisible container, label only -->
        <div class="flex-1 relative">
          <div class="h-full w-full flex items-center justify-center cursor-ns-resize"
            onpointerdown={(e) => {
              lowDragState.dragging = true;
              lowDragState.startY = e.clientY;
              lowDragState.startValue = lowGainValue;
              lowDragState.hasMoved = false;
              (e.target as Element).setPointerCapture(e.pointerId);
              // DON'T triggerLoad here - wait for intentional movement (ADR-167)
            }}
            onpointermove={(e) => {
              if (!lowDragState.dragging || !e.buttons) return;
              const deltaY = lowDragState.startY - e.clientY;

              // Only treat as intentional drag if movement exceeds threshold
              if (!lowDragState.hasMoved) {
                if (Math.abs(deltaY) < TAP_MOVEMENT_THRESHOLD) {
                  return; // Ignore micro-movements
                }
                lowDragState.hasMoved = true;
                // Trigger load on first intentional movement
                if (isGhost && !isLoading) {
                  triggerLoad();
                }
              }

              const newValue = Math.max(0, Math.min(1, lowDragState.startValue + deltaY / 100));
              if (isGhost || isLoading) {
                storePendingParam(PARAM_CONFIG.lowGain.index, newValue);
              } else if (device) {
                sendParam(PARAM_CONFIG.lowGain.index, newValue);
              }
            }}
            onpointerup={(e) => {
              lowDragState.dragging = false;
              (e.target as Element).releasePointerCapture(e.pointerId);
            }}
          >
          </div>
        </div>

        <!-- Mid XY (center) - invisible border -->
        <div class="flex-1 eq-xy-invisible">
          <DeviceXY
            xValue={midFreqValue}
            yValue={midGainValue}
            title=""
            isGhost={false}
            showCurve={false}
            {color}
            onInteraction={(x, y) => {
              if (isGhost || isLoading) {
                // Trigger load on first ghost interaction
                if (isGhost) {
                  triggerLoad();
                }
                storePendingParam(PARAM_CONFIG.midFreq.index, x);
                storePendingParam(PARAM_CONFIG.midGain.index, y);
              } else if (device) {
                sendParam(PARAM_CONFIG.midFreq.index, x);
                sendParam(PARAM_CONFIG.midGain.index, y);
              }
            }}
          />
        </div>

        <!-- Treble slider (right) - invisible container, label only -->
        <div class="flex-1 relative">
          <div class="h-full w-full flex items-center justify-center cursor-ns-resize"
            onpointerdown={(e) => {
              highDragState.dragging = true;
              highDragState.startY = e.clientY;
              highDragState.startValue = highGainValue;
              highDragState.hasMoved = false;
              (e.target as Element).setPointerCapture(e.pointerId);
              // DON'T triggerLoad here - wait for intentional movement (ADR-167)
            }}
            onpointermove={(e) => {
              if (!highDragState.dragging || !e.buttons) return;
              const deltaY = highDragState.startY - e.clientY;

              // Only treat as intentional drag if movement exceeds threshold
              if (!highDragState.hasMoved) {
                if (Math.abs(deltaY) < TAP_MOVEMENT_THRESHOLD) {
                  return; // Ignore micro-movements
                }
                highDragState.hasMoved = true;
                // Trigger load on first intentional movement
                if (isGhost && !isLoading) {
                  triggerLoad();
                }
              }

              const newValue = Math.max(0, Math.min(1, highDragState.startValue + deltaY / 100));
              if (isGhost || isLoading) {
                storePendingParam(PARAM_CONFIG.highGain.index, newValue);
              } else if (device) {
                sendParam(PARAM_CONFIG.highGain.index, newValue);
              }
            }}
            onpointerup={(e) => {
              highDragState.dragging = false;
              (e.target as Element).releasePointerCapture(e.pointerId);
            }}
          >
          </div>
        </div>
      </div>
    </div>
  {/snippet}
</BaseDeviceControl>
