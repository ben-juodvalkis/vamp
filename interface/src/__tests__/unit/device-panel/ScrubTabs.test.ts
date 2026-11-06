/**
 * ScrubTabs: a press picks the option under the finger, and a drag
 * carries the choice across the options it passes, once per change.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';

afterEach(cleanup);

function setup(cols: number) {
	const onSelect = vi.fn();
	const { container } = render(ScrubTabs, {
		props: {
			options: ['+2', '+1', '0', '-1', '-2'],
			selected: 2,
			onSelect,
			cols,
			label: (o: unknown) => `octave ${o}`
		}
	});
	const frame = container.querySelector('.scrub-tabs') as HTMLElement;
	// A column 40 px wide, 500 px tall: 100 px an option.
	frame.getBoundingClientRect = () =>
		({ left: 0, top: 0, width: cols === 1 ? 40 : 500, height: cols === 1 ? 500 : 40, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
	const at = (type: string, x: number, y: number) =>
		(type === 'pointerdown' ? frame : window).dispatchEvent(
			new PointerEvent(type, { bubbles: true, pointerId: 3, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 })
		);
	return { onSelect, at };
}

describe('ScrubTabs', () => {
	it('a column scrubs top to bottom', () => {
		const { onSelect, at } = setup(1);
		at('pointerdown', 20, 50); // +2
		at('pointermove', 20, 60); // still +2: no second write
		at('pointermove', 20, 150); // +1
		at('pointermove', 20, 250); // back onto 0, the starting value: sent
		at('pointermove', 20, 450); // -2
		at('pointerup', 20, 450);
		expect(onSelect.mock.calls.map((c) => c[1])).toEqual(['+2', '+1', '0', '-2']);
	});

	it('a press on the chosen option sends nothing', () => {
		const { onSelect, at } = setup(1);
		at('pointerdown', 20, 250);
		at('pointerup', 20, 250);
		expect(onSelect).not.toHaveBeenCalled();
	});

	it('a finger past the end keeps the end option', () => {
		const { onSelect, at } = setup(1);
		at('pointerdown', 20, 450);
		at('pointermove', 20, 900);
		at('pointerup', 20, 900);
		expect(onSelect.mock.calls.map((c) => c[1])).toEqual(['-2']);
	});

	it('a row scrubs across', () => {
		const { onSelect, at } = setup(5);
		at('pointerdown', 10, 20);
		at('pointermove', 490, 20);
		at('pointerup', 490, 20);
		expect(onSelect.mock.calls.map((c) => c[0])).toEqual([0, 4]);
	});
});
