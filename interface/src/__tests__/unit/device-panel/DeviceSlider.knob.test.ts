/**
 * DeviceSlider `face="knob"` (ADR-508): a value box drawn as an arc. The
 * gesture is the box's — relative, over the value-box travel — and either
 * axis turns it: up or right raises it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
import { VALUE_BOX_TRAVEL } from '$lib/components/v6/central/valueBox';

function pointer(el: HTMLElement, type: string, clientX: number, clientY: number) {
	const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
	Object.defineProperty(ev, 'pointerId', { value: 1 });
	el.dispatchEvent(ev);
}

// Mounted as a central view mounts it: over the value-box travel, longer
// than the 160 px cell below.
async function knob(props: Record<string, unknown>) {
	const { container } = render(DeviceSlider, { props: { face: 'knob', title: 'Res', travel: VALUE_BOX_TRAVEL, ...props } });
	await tick();
	return { container, el: container.querySelector<HTMLElement>('[role="slider"]')! };
}

describe('DeviceSlider face="knob"', () => {
	beforeEach(() => {
		HTMLElement.prototype.setPointerCapture = vi.fn();
		HTMLElement.prototype.releasePointerCapture = vi.fn();
		vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
			x: 0, y: 0, top: 0, left: 0, right: 120, bottom: 160, width: 120, height: 160, toJSON: () => ({})
		} as DOMRect);
	});
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it('draws an arc, not a fill, and is still one slider', async () => {
		const { container, el } = await knob({ value: 0.5 });
		expect(el.dataset.face).toBe('knob');
		expect(container.querySelector('.knob-value')).not.toBeNull();
		expect(container.querySelector('.slider-fill')).toBeNull();
		expect(el.getAttribute('aria-valuenow')).toBe('0.5');
	});

	it('sweeps its range over the value-box travel, up raising it', async () => {
		const onRelease = vi.fn();
		const { el } = await knob({ value: 0.5, onRelease });
		const quarter = VALUE_BOX_TRAVEL / 4;
		pointer(el, 'pointerdown', 50, 100);
		pointer(el, 'pointermove', 50, 100 - quarter);
		pointer(el, 'pointerup', 50, 100 - quarter);
		expect(onRelease.mock.calls[0][0]).toBeCloseTo(0.75, 9);
	});

	it('turns on a sideways drag too: right raises, left lowers', async () => {
		const onRelease = vi.fn();
		const { el } = await knob({ value: 0.5, onRelease });
		const quarter = VALUE_BOX_TRAVEL / 4;
		pointer(el, 'pointerdown', 50, 100);
		pointer(el, 'pointermove', 50 - quarter, 100);
		pointer(el, 'pointerup', 50 - quarter, 100);
		expect(onRelease.mock.calls[0][0]).toBeCloseTo(0.25, 9);
	});

	it('names itself at rest with its value under it, and shows Live’s value in the middle while dragged', async () => {
		const { container, el } = await knob({ value: 0.5, title: 'Decay', valueText: '1.2 s', readout: '1.25 s' });
		expect(el.textContent).toContain('Decay');
		expect(el.textContent).toContain('1.2 s');
		expect(container.querySelector('.knob-readout')).toBeNull();
		pointer(el, 'pointerdown', 50, 100);
		await tick();
		expect(container.querySelector('.knob-readout')?.textContent).toBe('1.25 s');
		pointer(el, 'pointerup', 50, 100);
		await tick();
		expect(container.querySelector('.knob-readout')).toBeNull();
	});

	it('marks zero at the top of a bipolar arc, and fills nothing there', async () => {
		const { container } = await knob({ value: 0, min: -1, max: 1, centerOrigin: true });
		expect(container.querySelector('.knob-value')?.getAttribute('d')).toBe('');
		const zero = container.querySelector('.knob-zero')!;
		// The top of the arc: straight up from the centre.
		expect(Number(zero.getAttribute('x1'))).toBeCloseTo(50, 6);
		expect(Number(zero.getAttribute('y1'))).toBeLessThan(50);
	});
});
