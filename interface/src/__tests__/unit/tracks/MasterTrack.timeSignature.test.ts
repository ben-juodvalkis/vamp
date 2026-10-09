/**
 * MasterTrack's key band is split in two: the key on the left, the time
 * signature on the right. Dragging the right half sets the numerator
 * (20 px a step, 1–32); the denominator stays in the System view.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import MasterTrack from '$lib/components/v6/tracks/MasterTrack.svelte';
import { send } from '$lib/api/simpleClient';
import { V3_SESSION_SIGNATURE_NUM_ADDRESS } from '$lib/api/handlers/v3Session';

describe('MasterTrack time signature', () => {
	afterEach(() => {
		cleanup();
		vi.mocked(send).mockClear();
	});

	it('shows the time signature beside the key', async () => {
		const { container } = render(MasterTrack);
		await tick();
		expect(container.querySelector('.key-band')).not.toBeNull();
		expect(container.querySelector('.sig-band .sig-num')?.textContent).toBe('4');
		expect(container.querySelector('.sig-band .sig-den')?.textContent).toBe('4');
	});

	it('drags the numerator up a step per 20 px', async () => {
		HTMLElement.prototype.setPointerCapture = vi.fn();
		HTMLElement.prototype.releasePointerCapture = vi.fn();
		const { container } = render(MasterTrack);
		await tick();
		const sig = container.querySelector<HTMLElement>('.sig-band')!;
		const at = (type: string, y: number) =>
			sig.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: 10, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
		at('pointerdown', 200);
		at('pointermove', 180);
		at('pointermove', 160);
		at('pointerup', 160);
		await tick();
		const sent = vi.mocked(send).mock.calls
			.filter(([addr]) => addr === V3_SESSION_SIGNATURE_NUM_ADDRESS)
			.map(([, args]) => (args as number[])[0]);
		expect(sent.at(-1)).toBe(6);
	});
});
