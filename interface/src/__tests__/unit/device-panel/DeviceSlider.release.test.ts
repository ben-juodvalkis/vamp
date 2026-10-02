/**
 * DeviceSlider's `onRelease`: once, where a drag ended — never on a tap,
 * nor when the drag ends where it began.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';

const HEIGHT = 200;

function pointer(el: HTMLElement, type: string, clientY: number) {
	const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY });
	Object.defineProperty(ev, 'pointerId', { value: 1 });
	el.dispatchEvent(ev);
}

describe('DeviceSlider onRelease', () => {
	beforeEach(() => {
		HTMLElement.prototype.setPointerCapture = vi.fn();
		HTMLElement.prototype.releasePointerCapture = vi.fn();
		vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
			x: 0, y: 0, top: 0, left: 0, right: 40, bottom: HEIGHT, width: 40, height: HEIGHT, toJSON: () => ({})
		} as DOMRect);
	});
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it('fires once, at the end of a drag, with where it ended', async () => {
		const onRelease = vi.fn();
		const { container } = render(DeviceSlider, { props: { value: 0.5, title: 'Size', onRelease } });
		await tick();
		const el = container.querySelector<HTMLElement>('[role="slider"]')!;
		pointer(el, 'pointerdown', 100);
		pointer(el, 'pointermove', 80);
		pointer(el, 'pointermove', 60);
		expect(onRelease).not.toHaveBeenCalled();
		pointer(el, 'pointerup', 60);
		expect(onRelease).toHaveBeenCalledTimes(1);
		expect(onRelease.mock.calls[0][0]).toBeCloseTo(0.7, 9); // 40 px up a 200 px rail
	});

	it('stays quiet for a tap, and for a drag back to where it began', async () => {
		const onRelease = vi.fn();
		const { container } = render(DeviceSlider, { props: { value: 0.5, title: 'Size', onRelease } });
		await tick();
		const el = container.querySelector<HTMLElement>('[role="slider"]')!;
		pointer(el, 'pointerdown', 100);
		pointer(el, 'pointerup', 100);
		pointer(el, 'pointerdown', 100);
		pointer(el, 'pointermove', 70);
		pointer(el, 'pointermove', 100);
		pointer(el, 'pointerup', 100);
		expect(onRelease).not.toHaveBeenCalled();
	});
});
