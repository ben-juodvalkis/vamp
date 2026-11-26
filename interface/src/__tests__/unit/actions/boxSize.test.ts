import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { boxSize } from '$lib/actions/boxSize';
import { sessionRowPitch } from '$lib/utils/sessionRowPitch';

type Observer = { cb: () => void; disconnect: ReturnType<typeof vi.fn> };
let observers: Observer[] = [];

beforeEach(() => {
	observers = [];
	vi.stubGlobal(
		'ResizeObserver',
		class {
			cb: () => void;
			disconnect = vi.fn();
			constructor(cb: () => void) {
				this.cb = cb;
				observers.push(this as unknown as Observer);
			}
			observe() {}
		}
	);
});
afterEach(() => vi.unstubAllGlobals());

function box(size: { width: number; height: number }) {
	const node = document.createElement('div');
	node.getBoundingClientRect = () => ({ ...size }) as DOMRect;
	return { node, size };
}

describe('boxSize', () => {
	it('reports the height at once and on every resize', () => {
		const { node, size } = box({ width: 10, height: 200 });
		const onSize = vi.fn();
		boxSize(node, { onSize });
		expect(onSize).toHaveBeenLastCalledWith(200);
		size.height = 300;
		observers[0].cb();
		expect(onSize).toHaveBeenLastCalledWith(300);
	});

	it('reads the width on that axis', () => {
		const { node } = box({ width: 80, height: 200 });
		const onSize = vi.fn();
		boxSize(node, { onSize, axis: 'width' });
		expect(onSize).toHaveBeenLastCalledWith(80);
	});

	it('keepLastNonZero skips a hidden box; without it 0 is reported', () => {
		const { node, size } = box({ width: 10, height: 200 });
		const kept = vi.fn();
		const raw = vi.fn();
		boxSize(node, { onSize: kept, keepLastNonZero: true });
		boxSize(node, { onSize: raw });
		size.height = 0;
		observers.forEach((o) => o.cb());
		expect(kept).toHaveBeenCalledTimes(1);
		expect(kept).toHaveBeenLastCalledWith(200);
		expect(raw).toHaveBeenLastCalledWith(0);
	});

	it('enabled: false measures nothing until it turns on', () => {
		const { node } = box({ width: 10, height: 120 });
		const onSize = vi.fn();
		const action = boxSize(node, { onSize, enabled: false });
		observers[0].cb();
		expect(onSize).not.toHaveBeenCalled();
		action.update({ onSize, enabled: true });
		expect(onSize).toHaveBeenLastCalledWith(120);
	});

	it('destroy disconnects the observer', () => {
		const { node } = box({ width: 10, height: 120 });
		const action = boxSize(node, { onSize: () => {} });
		action.destroy();
		expect(observers[0].disconnect).toHaveBeenCalled();
	});
});

describe('sessionRowPitch', () => {
	it('divides by the rows drawn plus the stop row', () => {
		expect(sessionRowPitch(250, 4)).toBe(50);
		expect(sessionRowPitch(200, 4, 0)).toBe(50);
		expect(sessionRowPitch(250, 0)).toBe(0);
	});
});
