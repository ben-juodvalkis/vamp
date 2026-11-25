/**
 * The pattern grid's length and rate sliders run on `use:drag`, so a
 * `pointercancel` (iOS claiming the gesture) ends the drag. They used to be
 * hand-wired handlers with pointer capture and no cancel: the drag stayed
 * open and a later move went on changing the length.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import SequencerPatternGrid from '$lib/components/v6/clips/SequencerPatternGrid.svelte';

function pointer(type: string, y: number): PointerEvent {
	const ev = new MouseEvent(type, { clientX: 10, clientY: y, bubbles: true, cancelable: true });
	Object.defineProperty(ev, 'pointerId', { value: 5 });
	Object.defineProperty(ev, 'pointerType', { value: 'touch' });
	return ev as unknown as PointerEvent;
}

afterEach(() => cleanup());

function mount(extra: Record<string, unknown> = {}) {
	const onLengthChange = vi.fn();
	const onRateChange = vi.fn();
	const onEnable = vi.fn();
	const { container } = render(SequencerPatternGrid, {
		props: {
			steps: Array(8).fill(false),
			length: 8,
			currentStep: -1,
			playing: false,
			showLengthSlider: true,
			showRateSlider: true,
			rateMode: '16ths',
			rateValue: 4,
			rateDisplayString: '1/4',
			onLengthChange,
			onRateChange,
			onEnable,
			...extra
		}
	});
	const length = container.querySelector<HTMLElement>('[aria-label^="Pattern length slider"]')!;
	const rate = container.querySelector<HTMLElement>('[aria-label^="Rate slider"]')!;
	return { length, rate, onLengthChange, onRateChange, onEnable };
}

describe('SequencerPatternGrid sliders', () => {
	it('length: a step per 20px up, enabling the sequencer at the press', async () => {
		const { length, onLengthChange, onEnable } = mount();
		length.dispatchEvent(pointer('pointerdown', 200));
		expect(onEnable).toHaveBeenCalledTimes(1);
		window.dispatchEvent(pointer('pointermove', 160));
		expect(onLengthChange).toHaveBeenLastCalledWith(10);
		window.dispatchEvent(pointer('pointerup', 160));
		await tick();
	});

	it('length: a cancelled drag is over', async () => {
		const { length, onLengthChange } = mount();
		length.dispatchEvent(pointer('pointerdown', 200));
		window.dispatchEvent(pointer('pointermove', 180));
		expect(onLengthChange).toHaveBeenCalledTimes(1);
		window.dispatchEvent(pointer('pointercancel', 180));
		window.dispatchEvent(pointer('pointermove', 100));
		expect(onLengthChange).toHaveBeenCalledTimes(1);
	});

	it('rate: up is faster, one step per 25px', () => {
		const { rate, onRateChange } = mount();
		rate.dispatchEvent(pointer('pointerdown', 200));
		window.dispatchEvent(pointer('pointermove', 175));
		expect(onRateChange).toHaveBeenLastCalledWith('16ths', 2);
		window.dispatchEvent(pointer('pointercancel', 175));
		window.dispatchEvent(pointer('pointermove', 100));
		expect(onRateChange).toHaveBeenCalledTimes(1);
	});

	it('readonly: no drag at all', () => {
		const { length, onLengthChange, onEnable } = mount({ readonly: true });
		length.dispatchEvent(pointer('pointerdown', 200));
		window.dispatchEvent(pointer('pointermove', 100));
		expect(onEnable).not.toHaveBeenCalled();
		expect(onLengthChange).not.toHaveBeenCalled();
	});
});
