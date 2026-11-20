/**
 * OrbControl — the drag is relative (2026-11-20): touch-down never jumps the
 * dot, the finger's travel moves it from where it was, one to one with the
 * drawn disc, and a tap writes nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import OrbControl from '$lib/components/v6/device-panel/OrbControl.svelte';

const BOX = 200; // the handle rides 0.4 of the box out at radius 1: 80 px

function pointer(el: Element, type: string, clientX: number, clientY: number) {
	const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
	Object.defineProperty(ev, 'pointerId', { value: 1 });
	el.dispatchEvent(ev);
}

function orb(container: HTMLElement): Element {
	const el = container.querySelector('.orb-container');
	if (!el) throw new Error('no .orb-container');
	return el;
}

describe('OrbControl — relative drag', () => {
	beforeEach(() => {
		vi.stubGlobal('requestAnimationFrame', () => 1);
		vi.stubGlobal('cancelAnimationFrame', () => {});
		HTMLElement.prototype.setPointerCapture = vi.fn();
		HTMLElement.prototype.releasePointerCapture = vi.fn();
		HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
		vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
			x: 0, y: 0, top: 0, left: 0, right: BOX, bottom: BOX,
			width: BOX, height: BOX, toJSON: () => ({})
		} as DOMRect);
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('a tap anywhere writes nothing', () => {
		const onInteraction = vi.fn();
		const { container } = render(OrbControl, { props: { angle: 0.5, radius: 0.5, onInteraction } });
		pointer(orb(container), 'pointerdown', 10, 10);
		pointer(orb(container), 'pointerup', 10, 10);
		expect(onInteraction).not.toHaveBeenCalled();
	});

	it('moves the dot by the finger travel, wherever the finger lands', () => {
		const onInteraction = vi.fn();
		const { container } = render(OrbControl, { props: { angle: 0.5, radius: 0.5, onInteraction } });
		// The dot is straight down at half radius. Land at the top-left
		// corner and slide 40 px right: half a radius right of the dot.
		pointer(orb(container), 'pointerdown', 10, 10);
		pointer(orb(container), 'pointermove', 50, 10);
		pointer(orb(container), 'pointerup', 50, 10);
		const [angle, radius] = onInteraction.mock.calls.at(-1)!;
		expect(angle).toBeCloseTo(0.375, 5);
		expect(radius).toBeCloseTo(Math.SQRT1_2, 5);
	});

	it('clamps at the rim', () => {
		const onInteraction = vi.fn();
		const { container } = render(OrbControl, { props: { angle: 0.5, radius: 0.5, onInteraction } });
		pointer(orb(container), 'pointerdown', 100, 100);
		pointer(orb(container), 'pointermove', 100, 400);
		pointer(orb(container), 'pointerup', 100, 400);
		const [angle, radius] = onInteraction.mock.calls.at(-1)!;
		expect(angle).toBeCloseTo(0.5, 5);
		expect(radius).toBe(1);
	});
});
