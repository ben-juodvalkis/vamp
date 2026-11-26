import { describe, it, expect, vi } from 'vitest';
import { createStepDrag, stepDragValue } from '$lib/actions/stepDrag';
import type { DragInfo } from '$lib/actions/drag';

const move = (dy: number) => ({ dy }) as DragInfo;

describe('stepDragValue', () => {
	it('adds dy × perPx to the start, rounds and clamps a range', () => {
		const c = { read: () => 0, perPx: 0.5, min: 20, max: 999, send: () => {} };
		expect(stepDragValue(c, 120, 0)).toBe(120);
		expect(stepDragValue(c, 120, 3)).toBe(122); // 121.5 rounds up
		expect(stepDragValue(c, 120, -10)).toBe(115);
		expect(stepDragValue(c, 120, -1000)).toBe(20);
		expect(stepDragValue(c, 120, 5000)).toBe(999);
	});

	it('walks a list of allowed values by position', () => {
		const c = { read: () => 0, perPx: 0.05, steps: [1, 2, 4, 8, 16], send: () => {} };
		expect(stepDragValue(c, 4, 0)).toBe(4);
		expect(stepDragValue(c, 4, 20)).toBe(8);
		expect(stepDragValue(c, 4, -20)).toBe(2);
		expect(stepDragValue(c, 4, 1000)).toBe(16);
		expect(stepDragValue(c, 4, -1000)).toBe(1);
	});
});

describe('createStepDrag', () => {
	it('is an immediate, touch-action none drag', () => {
		const opts = createStepDrag({ read: () => 4, perPx: 1, min: 1, max: 32, send: () => {} });
		expect(opts.commit).toBe('immediate');
		expect(opts.touchAction).toBe('none');
	});

	it('reads the value at the press and sends only on a change', () => {
		let value = 4;
		const send = vi.fn((v: number) => (value = v));
		const opts = createStepDrag({ read: () => value, perPx: 0.05, min: 1, max: 32, send });
		opts.onStart!(move(0));
		opts.onMove!(move(5)); // 4.25 → 4: no step crossed, nothing sent
		expect(send).not.toHaveBeenCalled();
		opts.onMove!(move(20)); // 5
		opts.onMove!(move(25)); // 5.25 → 5 again
		expect(send).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenLastCalledWith(5);
		opts.onMove!(move(0)); // back to the start value: that is a change too
		expect(send).toHaveBeenLastCalledWith(4);
		expect(send).toHaveBeenCalledTimes(2);
		opts.onEnd!({ ...move(0), reason: 'up' } as never);
	});

	it('reports active from press to end', () => {
		const active = vi.fn();
		const opts = createStepDrag({
			read: () => 120,
			perPx: 1,
			min: 20,
			max: 999,
			send: () => {},
			onActiveChange: active
		});
		opts.onStart!(move(0));
		expect(active).toHaveBeenLastCalledWith(true);
		opts.onEnd!({ ...move(0), reason: 'cancel' } as never);
		expect(active).toHaveBeenLastCalledWith(false);
	});

	it('starts each drag from the value at its own press', () => {
		let value = 4;
		const send = vi.fn();
		const opts = createStepDrag({ read: () => value, perPx: 1, min: 1, max: 32, send });
		opts.onStart!(move(0));
		opts.onMove!(move(2));
		expect(send).toHaveBeenLastCalledWith(6);
		value = 10;
		opts.onStart!(move(0));
		opts.onMove!(move(1));
		expect(send).toHaveBeenLastCalledWith(11);
	});
});
