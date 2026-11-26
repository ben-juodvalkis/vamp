/**
 * The device panel's continuous controls belong to the finger that started
 * the gesture (ADR-427): a second finger landing on the same control
 * neither drives it nor ends the first finger's drag. Before they moved
 * onto `use:drag`, each hand-rolled its own pointer handlers with no
 * pointer-id check, so the second finger did both.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';

function pointer(el: HTMLElement, type: string, id: number, clientX: number, clientY: number) {
	const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
	Object.defineProperty(ev, 'pointerId', { value: id });
	el.dispatchEvent(ev);
}

beforeEach(() => {
	HTMLElement.prototype.setPointerCapture = vi.fn();
	HTMLElement.prototype.releasePointerCapture = vi.fn();
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
		x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 200, width: 200, height: 200, toJSON: () => ({})
	} as DOMRect);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('one finger per control', () => {
	it('DeviceSlider: a second finger neither moves nor releases it', async () => {
		const onRelease = vi.fn();
		const onTap = vi.fn();
		const { container } = render(DeviceSlider, { props: { value: 0.5, title: 'Size', onRelease, onTap } });
		await tick();
		const el = container.querySelector<HTMLElement>('[role="slider"]')!;
		pointer(el, 'pointerdown', 1, 10, 100);
		pointer(el, 'pointermove', 1, 10, 60);
		pointer(el, 'pointerdown', 2, 10, 150);
		pointer(el, 'pointermove', 2, 10, 0);
		pointer(el, 'pointerup', 2, 10, 0);
		expect(onRelease).not.toHaveBeenCalled();
		expect(onTap).not.toHaveBeenCalled();
		pointer(el, 'pointerup', 1, 10, 60);
		expect(onRelease).toHaveBeenCalledTimes(1);
		expect(onRelease.mock.calls[0][0]).toBeCloseTo(0.7, 9); // finger 1's 40 px of a 200 px rail
	});

	it('DeviceXY: a second finger neither drives the dot nor ends the drag', async () => {
		const onRelease = vi.fn();
		const { container } = render(DeviceXY, { props: { xValue: 0.5, yValue: 0.5, title: 'XY', onRelease } });
		await tick();
		const el = container.querySelector<HTMLElement>('[role="slider"]')!;
		pointer(el, 'pointerdown', 1, 100, 100);
		pointer(el, 'pointermove', 1, 140, 100);
		pointer(el, 'pointerdown', 2, 10, 10);
		pointer(el, 'pointermove', 2, 0, 0);
		pointer(el, 'pointerup', 2, 0, 0);
		expect(onRelease).not.toHaveBeenCalled();
		pointer(el, 'pointerup', 1, 140, 100);
		expect(onRelease).toHaveBeenCalledTimes(1);
		const [x, y] = onRelease.mock.calls[0];
		expect(x).toBeCloseTo(0.7, 9);
		expect(y).toBeCloseTo(0.5, 9);
	});
});
