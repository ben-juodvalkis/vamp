/**
 * The master fader runs the strips' fader (`useStripFader` on `use:drag`):
 * relative, gain 1 over the Card's height, and the handle follows the
 * finger before the store answers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { send } from '$lib/api/simpleClient';
import MasterTrack from '$lib/components/v6/tracks/MasterTrack.svelte';

const HEIGHT = 200;

function pointer(type: string, x: number, y: number): PointerEvent {
	const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
	Object.defineProperty(ev, 'pointerId', { value: 3 });
	Object.defineProperty(ev, 'pointerType', { value: 'touch' });
	return ev as unknown as PointerEvent;
}

function masterWrites(): number[] {
	return vi
		.mocked(send)
		.mock.calls.filter(([address]) => address === '/looping/v3/master/volume')
		.map(([, args]) => (args as number[])[0]);
}

beforeEach(() => vi.mocked(send).mockClear());
afterEach(() => cleanup());

describe('MasterTrack fader', () => {
	it('moves the handle with the finger and writes the resting value', async () => {
		const { container } = render(MasterTrack);
		await tick();
		const overlay = container.querySelector<HTMLElement>('[aria-label="Master volume"]')!;
		overlay.getBoundingClientRect = () =>
			({ height: HEIGHT, width: 80, top: 0, left: 0, right: 80, bottom: HEIGHT, x: 0, y: 0 }) as DOMRect;
		const handle = () => container.querySelector<HTMLElement>('.master-vol-handle')!.style.bottom;
		expect(handle()).toBe('85%');

		overlay.dispatchEvent(pointer('pointerdown', 40, 150));
		window.dispatchEvent(pointer('pointermove', 40, 140));
		window.dispatchEvent(pointer('pointermove', 40, 130)); // 20px up a 200px fader
		await tick();
		expect(parseFloat(handle())).toBeCloseTo(95, 5);

		window.dispatchEvent(pointer('pointerup', 40, 130));
		await tick();
		expect(masterWrites().at(-1)).toBeCloseTo(0.95, 5);
	});

	it('a sideways press is not a fader drag', async () => {
		const { container } = render(MasterTrack);
		await tick();
		const overlay = container.querySelector<HTMLElement>('[aria-label="Master volume"]')!;
		overlay.getBoundingClientRect = () =>
			({ height: HEIGHT, width: 80, top: 0, left: 0, right: 80, bottom: HEIGHT, x: 0, y: 0 }) as DOMRect;
		overlay.dispatchEvent(pointer('pointerdown', 10, 150));
		window.dispatchEvent(pointer('pointermove', 40, 148));
		window.dispatchEvent(pointer('pointermove', 70, 120));
		window.dispatchEvent(pointer('pointerup', 70, 120));
		await tick();
		expect(masterWrites()).toEqual([]);
	});
});
