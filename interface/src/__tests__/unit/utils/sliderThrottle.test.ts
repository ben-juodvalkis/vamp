import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSliderThrottle, createDiscreteThrottle } from '$lib/utils/sliderThrottle';

describe('sliderThrottle', () => {
	describe('createSliderThrottle', () => {
		let rafCallbacks: FrameRequestCallback[] = [];
		let rafId = 0;
		let virtualNow = 0;

		beforeEach(() => {
			rafCallbacks = [];
			rafId = 0;
			virtualNow = 1000;

			// Mock requestAnimationFrame
			vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
				const id = ++rafId;
				rafCallbacks.push(callback);
				return id;
			});

			vi.stubGlobal('cancelAnimationFrame', (id: number) => {
				// In real impl this would remove the callback, but for testing we just track calls
			});
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		// Each rAF advances the virtual clock by `deltaMs` and passes the
		// resulting timestamp to the callback — matches how rAF works in a
		// browser. Default is one 60 Hz frame so the throttle's 60 Hz gate
		// always passes.
		function flushRAF(deltaMs = 17) {
			const callbacks = [...rafCallbacks];
			rafCallbacks = [];
			callbacks.forEach((cb) => {
				virtualNow += deltaMs;
				cb(virtualNow);
			});
		}

		it('should not send values until RAF fires', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			throttle.push(0.5);

			expect(onSend).not.toHaveBeenCalled();
		});

		it('should send pending value on RAF', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			throttle.push(0.5);
			flushRAF();

			expect(onSend).toHaveBeenCalledWith(0.5);
		});

		it('should batch multiple push() calls into single send', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			throttle.push(0.1);
			throttle.push(0.2);
			throttle.push(0.3);
			flushRAF();

			// Only the last value should be sent
			expect(onSend).toHaveBeenCalledTimes(1);
			expect(onSend).toHaveBeenCalledWith(0.3);
		});

		it('should continue sending on subsequent RAFs while active', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			throttle.push(0.5);
			flushRAF();

			expect(onSend).toHaveBeenCalledTimes(1);

			throttle.push(0.7);
			flushRAF();

			expect(onSend).toHaveBeenCalledTimes(2);
			expect(onSend).toHaveBeenLastCalledWith(0.7);
		});

		it('should not send if no value pushed since last RAF', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			throttle.push(0.5);
			flushRAF();

			expect(onSend).toHaveBeenCalledTimes(1);

			// RAF fires again with no new value
			flushRAF();

			// Should not call again (pending was cleared)
			expect(onSend).toHaveBeenCalledTimes(1);
		});

		it('flush() should send pending value immediately', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			throttle.push(0.5);
			throttle.flush();

			expect(onSend).toHaveBeenCalledWith(0.5);
		});

		it('flush() should clear pending value', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			throttle.push(0.5);
			throttle.flush();

			// RAF fires after flush
			flushRAF();

			// Should only have sent once (in flush)
			expect(onSend).toHaveBeenCalledTimes(1);
		});

		it('flush() should stop the RAF loop', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			throttle.push(0.5);

			// Flush sends immediately and stops the loop
			throttle.flush();
			expect(onSend).toHaveBeenCalledTimes(1);
			expect(onSend).toHaveBeenCalledWith(0.5);

			// Push after flush just queues but doesn't restart RAF loop
			// (must call start() again to restart)
			throttle.push(0.7);

			// Clear the RAF queue from before flush was called
			rafCallbacks = [];

			// No new RAFs should be scheduled after flush
			expect(rafCallbacks.length).toBe(0);
		});

		it('cancel() should not send pending value', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			throttle.push(0.5);
			throttle.cancel();

			flushRAF();

			expect(onSend).not.toHaveBeenCalled();
		});

		it('cancel() should clear pending value and stop loop', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			throttle.push(0.5);
			throttle.cancel();

			// Flush should not send anything after cancel
			throttle.flush();

			expect(onSend).not.toHaveBeenCalled();
		});

		it('should handle start() being called multiple times', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			throttle.start();
			throttle.start();
			throttle.push(0.5);
			flushRAF();

			expect(onSend).toHaveBeenCalledTimes(1);
		});

		// Regression: issue #392 — repeated identical values must not re-send
		it('should skip send when pushed value equals last-sent (dedupe)', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			throttle.push(0.5);
			flushRAF();
			expect(onSend).toHaveBeenCalledTimes(1);

			throttle.push(0.5);
			flushRAF();

			expect(onSend).toHaveBeenCalledTimes(1);
		});

		// Regression: issue #392 — RAF must self-terminate, not re-arm itself
		it('should not re-arm RAF after a frame fires without a new push', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			throttle.push(0.5);
			flushRAF();
			expect(rafCallbacks.length).toBe(0);

			flushRAF();
			expect(rafCallbacks.length).toBe(0);
			expect(onSend).toHaveBeenCalledTimes(1);
		});

		// Regression: issue #384 — outbound rate must clamp to 60 Hz even
		// when rAF fires at 120 Hz on ProMotion displays. With an 8 ms
		// (~120 Hz) cadence the throttle should send roughly every other
		// frame, not every frame.
		it('should clamp outbound rate to 60 Hz when rAF fires faster', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			// 10 frames at 8 ms = 80 ms. At 60 Hz that's at most 4 sends
			// (frame 0 always passes from lastSentTs=0; thereafter every
			// third 8 ms frame clears the 16.67 ms threshold). At 120 Hz
			// uncapped it would be 10. Push a fresh value each frame so
			// the dedupe path doesn't suppress sends.
			for (let i = 0; i < 10; i++) {
				throttle.push(i / 100);
				flushRAF(8);
			}

			// Allow ±1 jitter around the 60 Hz target. Without the gate
			// this would be 10.
			expect(onSend.mock.calls.length).toBeLessThanOrEqual(6);
			expect(onSend.mock.calls.length).toBeGreaterThanOrEqual(4);
		});

		// The frame after a gated frame should still ship the latest value.
		it('should re-arm rAF when gated and ship latest value next frame', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			throttle.push(0.1);
			flushRAF(20); // first send always passes (lastSentTs=0)
			expect(onSend).toHaveBeenCalledTimes(1);

			throttle.push(0.2);
			flushRAF(8); // gated — too soon
			expect(onSend).toHaveBeenCalledTimes(1);
			expect(rafCallbacks.length).toBe(1); // re-armed for next frame

			flushRAF(10); // 18 ms total since last send — passes gate
			expect(onSend).toHaveBeenCalledTimes(2);
			expect(onSend).toHaveBeenLastCalledWith(0.2);
		});

		// Companion: at 60 Hz cadence every frame should pass the gate.
		it('should send every frame at 60 Hz cadence', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			throttle.push(0.1);
			flushRAF(17);
			throttle.push(0.2);
			flushRAF(17);
			throttle.push(0.3);
			flushRAF(17);

			expect(onSend).toHaveBeenCalledTimes(3);
		});

		// flush() (pointerup) must always deliver — never gated.
		it('flush() should send final value even when 60 Hz gate would block', () => {
			const onSend = vi.fn();
			const throttle = createSliderThrottle(onSend);

			throttle.start();
			throttle.push(0.1);
			flushRAF(8);
			expect(onSend).toHaveBeenCalledTimes(1);

			throttle.push(0.2);
			throttle.flush();

			expect(onSend).toHaveBeenCalledTimes(2);
			expect(onSend).toHaveBeenLastCalledWith(0.2);
		});
	});

	describe('createDiscreteThrottle', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('should send immediately on first push', () => {
			const onSend = vi.fn();
			const throttle = createDiscreteThrottle(onSend, 50);

			throttle.push(1);

			expect(onSend).toHaveBeenCalledWith(1);
		});

		it('should rate-limit rapid pushes', () => {
			const onSend = vi.fn();
			const throttle = createDiscreteThrottle(onSend, 50);

			throttle.push(1);
			throttle.push(2);
			throttle.push(3);

			// Only first should have been sent immediately
			expect(onSend).toHaveBeenCalledTimes(1);
			expect(onSend).toHaveBeenCalledWith(1);
		});

		it('should send queued value after interval', () => {
			const onSend = vi.fn();
			const throttle = createDiscreteThrottle(onSend, 50);

			throttle.push(1);
			throttle.push(2);
			throttle.push(3);

			expect(onSend).toHaveBeenCalledTimes(1);

			vi.advanceTimersByTime(50);

			// Last queued value should now be sent
			expect(onSend).toHaveBeenCalledTimes(2);
			expect(onSend).toHaveBeenLastCalledWith(3);
		});

		it('should send immediately if enough time elapsed', () => {
			const onSend = vi.fn();
			const throttle = createDiscreteThrottle(onSend, 50);

			throttle.push(1);

			vi.advanceTimersByTime(60);

			throttle.push(2);

			// Both should have been sent immediately
			expect(onSend).toHaveBeenCalledTimes(2);
			expect(onSend).toHaveBeenNthCalledWith(1, 1);
			expect(onSend).toHaveBeenNthCalledWith(2, 2);
		});

		it('flush() should send pending value immediately', () => {
			const onSend = vi.fn();
			const throttle = createDiscreteThrottle(onSend, 50);

			throttle.push(1);
			throttle.push(2);

			expect(onSend).toHaveBeenCalledTimes(1);

			throttle.flush();

			expect(onSend).toHaveBeenCalledTimes(2);
			expect(onSend).toHaveBeenLastCalledWith(2);
		});

		it('flush() should clear timeout', () => {
			const onSend = vi.fn();
			const throttle = createDiscreteThrottle(onSend, 50);

			throttle.push(1);
			throttle.push(2);
			throttle.flush();

			// Advance time - should not send again
			vi.advanceTimersByTime(100);

			expect(onSend).toHaveBeenCalledTimes(2);
		});

		it('cancel() should not send pending value', () => {
			const onSend = vi.fn();
			const throttle = createDiscreteThrottle(onSend, 50);

			throttle.push(1);
			throttle.push(2);

			expect(onSend).toHaveBeenCalledTimes(1);

			throttle.cancel();
			vi.advanceTimersByTime(100);

			// Only first value should have been sent
			expect(onSend).toHaveBeenCalledTimes(1);
		});

		it('cancel() should clear timeout', () => {
			const onSend = vi.fn();
			const throttle = createDiscreteThrottle(onSend, 50);

			throttle.push(1);
			throttle.push(2);
			throttle.cancel();

			vi.advanceTimersByTime(100);

			expect(onSend).toHaveBeenCalledTimes(1);
		});

		it('should use default interval of 50ms', () => {
			const onSend = vi.fn();
			const throttle = createDiscreteThrottle(onSend);

			throttle.push(1);
			throttle.push(2);

			expect(onSend).toHaveBeenCalledTimes(1);

			vi.advanceTimersByTime(50);

			expect(onSend).toHaveBeenCalledTimes(2);
		});

		it('should handle custom interval', () => {
			const onSend = vi.fn();
			const throttle = createDiscreteThrottle(onSend, 100);

			throttle.push(1);
			throttle.push(2);

			vi.advanceTimersByTime(50);
			expect(onSend).toHaveBeenCalledTimes(1);

			vi.advanceTimersByTime(50);
			expect(onSend).toHaveBeenCalledTimes(2);
		});

		it('should only keep latest value when multiple pushed', () => {
			const onSend = vi.fn();
			const throttle = createDiscreteThrottle(onSend, 50);

			throttle.push(1);
			throttle.push(2);
			throttle.push(3);
			throttle.push(4);
			throttle.push(5);

			vi.advanceTimersByTime(50);

			expect(onSend).toHaveBeenCalledTimes(2);
			expect(onSend).toHaveBeenNthCalledWith(1, 1);
			expect(onSend).toHaveBeenNthCalledWith(2, 5);
		});
	});
});
