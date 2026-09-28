/**
 * DeviceXY — the outbound gesture rate is clamped to 60 Hz (issue #384).
 *
 * DeviceXY cannot use `createSliderThrottle`: X and Y have to ship as ONE
 * `onInteraction(x, y)` call, and two independent throttles would emit two
 * writes per frame with no ordering guarantee. So it hand-rolls the same rAF
 * loop — and the hand-rolled copy was missing the one thing the shared
 * throttle has that rAF does not give you for free: a time gate.
 *
 * rAF is a *frame* synchronizer, not a rate limit. On the iPad's 120 Hz
 * ProMotion panel it fires every ~8 ms, and this control writes two Live
 * parameters per send, so an ungated drag emits ~240 messages/second against
 * a 60 Hz budget.
 *
 * These tests drive the real component through real pointer events with a
 * controllable rAF clock. The 120 Hz case is the regression: 12 frames at 8 ms
 * produce 4 sends here and 12 against the pre-fix loop.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';

// --- controllable rAF -------------------------------------------------------
// Each flush advances a virtual clock by `deltaMs` and hands the callback the
// resulting timestamp, which is what a browser does and what the gate reads.
let rafCallbacks: FrameRequestCallback[] = [];
let rafSeq = 0;
let virtualNow = 0;

function flushRAF(deltaMs: number) {
	const callbacks = [...rafCallbacks];
	rafCallbacks = [];
	callbacks.forEach((cb) => {
		virtualNow += deltaMs;
		cb(virtualNow);
	});
}

const PAD = 200;

function pointer(el: Element, type: string, clientX: number, clientY: number) {
	const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
	Object.defineProperty(ev, 'pointerId', { value: 1 });
	el.dispatchEvent(ev);
}

function pad(container: HTMLElement): Element {
	const el = container.querySelector('.xy-container');
	if (!el) throw new Error('no .xy-container');
	return el;
}

/**
 * One drag: press, then `frames` move/rAF pairs `deltaMs` apart, each moving
 * the finger far enough that the pending pair is genuinely new (so the
 * dedupe branch can never be what suppresses a send).
 */
function drag(
	container: HTMLElement,
	{ frames, deltaMs, release = true }: { frames: number; deltaMs: number; release?: boolean }
) {
	const el = pad(container);
	pointer(el, 'pointerdown', 100, 100);
	// 8 px a step, so even the first move clears DeviceXY's 5 px tap threshold
	// and the throttle starts on frame 1.
	for (let i = 1; i <= frames; i++) {
		pointer(el, 'pointermove', 100 + i * 8, 100 - i * 8);
		flushRAF(deltaMs);
	}
	if (release) pointer(el, 'pointerup', 100 + frames * 8, 100 - frames * 8);
}

describe('DeviceXY — outbound rate', () => {
	beforeEach(() => {
		rafCallbacks = [];
		rafSeq = 0;
		virtualNow = 1000;

		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			rafCallbacks.push(cb);
			return ++rafSeq;
		});
		vi.stubGlobal('cancelAnimationFrame', () => {});

		HTMLElement.prototype.setPointerCapture = vi.fn();
		HTMLElement.prototype.releasePointerCapture = vi.fn();
		vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
			x: 0, y: 0, top: 0, left: 0, right: PAD, bottom: PAD,
			width: PAD, height: PAD, toJSON: () => ({})
		} as DOMRect);
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('sends once per frame at 60 Hz', () => {
		const onInteraction = vi.fn();
		const { container } = render(DeviceXY, { props: { onInteraction } });

		// 6 frames at 17 ms — every frame clears the 16.67 ms ceiling.
		drag(container, { frames: 6, deltaMs: 17, release: false });

		expect(onInteraction).toHaveBeenCalledTimes(6);
	});

	it('cuts the send rate to a third on a 120 Hz display', () => {
		const onInteraction = vi.fn();
		const { container } = render(DeviceXY, { props: { onInteraction } });

		// 12 frames at 8 ms = 96 ms of dragging on ProMotion. Ungated that is
		// 12 sends — 24 parameter writes, 125 Hz.
		//
		// Gated it is 4, and 4 is the honest number rather than 6: an 8 ms
		// frame cannot land exactly on a 16.67 ms ceiling, so it takes three
		// of them (24 ms) to clear it. createSliderThrottle behaves the same
		// way on the same hardware — the ceiling is shared deliberately, and
		// a drag that lands under 60 Hz is the safe side of the budget.
		drag(container, { frames: 12, deltaMs: 8, release: false });

		expect(onInteraction).toHaveBeenCalledTimes(4);
	});

	it('ships the latest pair when a frame is gated, not a stale one', () => {
		const onInteraction = vi.fn();
		const { container } = render(DeviceXY, { props: { onInteraction } });
		const el = pad(container);

		pointer(el, 'pointerdown', 100, 100);
		pointer(el, 'pointermove', 120, 80);
		flushRAF(17); // first send, clock now open

		onInteraction.mockClear();
		pointer(el, 'pointermove', 124, 76);
		flushRAF(8); // gated — re-arms rather than dropping
		expect(onInteraction).not.toHaveBeenCalled();

		pointer(el, 'pointermove', 140, 60);
		flushRAF(9); // 17 ms since the last send: the NEWEST pair goes
		expect(onInteraction).toHaveBeenCalledTimes(1);

		const [x, y] = onInteraction.mock.calls[0];
		// clientX 140 is +40 px from the 100 px press on a 200 px pad → +0.2
		expect(x).toBeCloseTo(0.7, 5);
		expect(y).toBeCloseTo(0.7, 5);
	});

	it('pointerup delivers the resting value even when the gate would block it', () => {
		const onInteraction = vi.fn();
		const { container } = render(DeviceXY, { props: { onInteraction } });
		const el = pad(container);

		pointer(el, 'pointerdown', 100, 100);
		pointer(el, 'pointermove', 120, 80);
		flushRAF(17);
		onInteraction.mockClear();

		// Move and lift inside the ceiling — the frame is gated, the flush is not.
		pointer(el, 'pointermove', 160, 40);
		flushRAF(4);
		expect(onInteraction).not.toHaveBeenCalled();

		pointer(el, 'pointerup', 160, 40);
		expect(onInteraction).toHaveBeenCalledTimes(1);
		const [x, y] = onInteraction.mock.calls[0];
		expect(x).toBeCloseTo(0.8, 5);
		expect(y).toBeCloseTo(0.8, 5);
	});

	it('does not carry the gate across gestures', () => {
		const onInteraction = vi.fn();
		const { container } = render(DeviceXY, { props: { onInteraction } });

		drag(container, { frames: 2, deltaMs: 17 });
		onInteraction.mockClear();

		// A second drag's first frame must send immediately, however soon it
		// follows the last one — flush() resets the clock.
		const el = pad(container);
		pointer(el, 'pointerdown', 100, 100);
		pointer(el, 'pointermove', 130, 70);
		flushRAF(1);

		expect(onInteraction).toHaveBeenCalledTimes(1);
	});
});
