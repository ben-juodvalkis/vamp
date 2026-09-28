/**
 * sliderThrottle.ts - Frame-synchronized throttling for smooth slider interactions
 *
 * Uses requestAnimationFrame to coalesce values and clamps the outbound rate
 * to 60 Hz so ProMotion / 120 Hz displays don't double the OSC traffic per
 * drag (issue #384).
 *
 * Key principles:
 * - Local UI updates happen immediately (no perceived lag)
 * - OSC/network sends are batched to ≤60 Hz regardless of display rate
 * - Only the latest value is sent (intermediate values are dropped)
 * - Final value is always sent on pointer release
 */

type SendCallback = (value: number) => void;

/**
 * Outbound rate ceiling for gestural writes, in milliseconds between sends.
 *
 * Exported because `DeviceXY` cannot use `createSliderThrottle` — X and Y must
 * ship as ONE call, and two independent throttles would emit two — so it
 * hand-rolls the same rAF loop and needs the same ceiling. One constant, so a
 * change to the budget cannot land in only one of them (issue #384).
 */
export const MIN_SEND_INTERVAL_MS = 1000 / 60;

interface ThrottleState {
  pendingValue: number | null;
  lastSentValue: number | null;
  lastSentTs: number;
  rafId: number | null;
  isActive: boolean;
}

/**
 * Creates a frame-synchronized throttle for slider value updates.
 *
 * @example
 * ```ts
 * const throttle = createSliderThrottle((value) => {
 *   selectedTrackStore.setParamValue(
 *     selectedTrackStore.paramPath(device, paramIndex), value
 *   );
 * });
 *
 * // In pointermove handler:
 * localValue = newValue;  // Update UI immediately
 * throttle.push(newValue); // Queue for next frame
 *
 * // In pointerup handler:
 * throttle.flush(); // Send final value immediately
 * ```
 */
export function createSliderThrottle(onSend: SendCallback) {
  const state: ThrottleState = {
    pendingValue: null,
    lastSentValue: null,
    lastSentTs: 0,
    rafId: null,
    isActive: false
  };

  // sendFrame self-terminates each frame after sending; push() re-arms the
  // RAF when new values arrive. This prevents the loop from leaking when
  // pointerup is missed (page hidden, pointer leaves window, component
  // unmounts mid-drag) — see issue #392.
  //
  // Outbound rate is also clamped to 60 Hz: on a 120 Hz ProMotion display
  // rAF fires every ~8 ms, so without this gate every drag would emit at
  // 120 Hz (issue #384). When the gate trips we re-arm rAF for the next
  // frame so the latest pending value still ships promptly.
  function sendFrame(now: number) {
    state.rafId = null;
    if (state.pendingValue === null) return;

    const elapsed = now - state.lastSentTs;
    if (elapsed < MIN_SEND_INTERVAL_MS) {
      schedule();
      return;
    }

    if (state.pendingValue !== state.lastSentValue) {
      onSend(state.pendingValue);
      state.lastSentValue = state.pendingValue;
      state.lastSentTs = now;
    }
    state.pendingValue = null;
  }

  function schedule() {
    if (state.isActive && !state.rafId) {
      state.rafId = requestAnimationFrame(sendFrame);
    }
  }

  return {
    /**
     * Start the throttle (call on pointerdown)
     */
    start() {
      state.isActive = true;
      schedule();
    },

    /**
     * Queue a value for sending on next animation frame
     */
    push(value: number) {
      state.pendingValue = value;
      schedule();
    },

    /**
     * Send any pending value immediately and stop the RAF loop (call on pointerup)
     */
    flush() {
      state.isActive = false;

      // Cancel pending RAF
      if (state.rafId) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }

      // Send final value immediately (skip if identical to last-sent).
      // Final value bypasses the 60 Hz gate — pointerup must always
      // deliver the resting value.
      if (state.pendingValue !== null) {
        if (state.pendingValue !== state.lastSentValue) {
          onSend(state.pendingValue);
        }
        state.pendingValue = null;
      }
      state.lastSentValue = null;
      state.lastSentTs = 0;
    },

    /**
     * Cancel without sending (e.g., on component unmount)
     */
    cancel() {
      state.isActive = false;
      state.pendingValue = null;
      state.lastSentValue = null;
      state.lastSentTs = 0;
      if (state.rafId) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }
    }
  };
}

/**
 * Creates a throttle for discrete/stepped values with minimum interval.
 * Useful for discrete sliders where we don't want to spam on every step.
 *
 * @param onSend - Callback to send the value
 * @param minIntervalMs - Minimum milliseconds between sends (default 50ms = 20fps)
 */
export function createDiscreteThrottle(onSend: SendCallback, minIntervalMs = 50) {
  let lastSentTime = 0;
  let pendingValue: number | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  function sendNow(value: number) {
    onSend(value);
    lastSentTime = Date.now();
    pendingValue = null;
  }

  return {
    push(value: number) {
      const now = Date.now();
      const elapsed = now - lastSentTime;

      if (elapsed >= minIntervalMs) {
        // Enough time has passed, send immediately
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        sendNow(value);
      } else {
        // Too soon, queue for later
        pendingValue = value;
        if (!timeoutId) {
          timeoutId = setTimeout(() => {
            timeoutId = null;
            if (pendingValue !== null) {
              sendNow(pendingValue);
            }
          }, minIntervalMs - elapsed);
        }
      }
    },

    flush() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (pendingValue !== null) {
        onSend(pendingValue);
        pendingValue = null;
      }
    },

    cancel() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      pendingValue = null;
    }
  };
}
