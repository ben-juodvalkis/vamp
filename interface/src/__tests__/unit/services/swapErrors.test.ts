import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	holdSwapError,
	dropSwapError,
	flushSwapErrors,
	SWAP_ERROR_TTL_MS
} from '$lib/services/swapErrors';

describe('swapErrors', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		flushSwapErrors();
		vi.useRealTimers();
	});

	it('clears the error after the TTL, and not before', () => {
		const clear = vi.fn();
		holdSwapError('rack|kit', clear);
		vi.advanceTimersByTime(SWAP_ERROR_TTL_MS - 1);
		expect(clear).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(clear).toHaveBeenCalledTimes(1);
	});

	it('replaces a held error for the same key — the newer reason is the one on screen', () => {
		const first = vi.fn();
		const second = vi.fn();
		holdSwapError('rack|kit', first);
		vi.advanceTimersByTime(SWAP_ERROR_TTL_MS - 100);
		holdSwapError('rack|kit', second);
		vi.advanceTimersByTime(SWAP_ERROR_TTL_MS);
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});

	it('keeps keys apart', () => {
		const kit = vi.fn();
		const pad = vi.fn();
		holdSwapError('rack|kit', kit);
		holdSwapError('rack|pad:38', pad);
		vi.advanceTimersByTime(SWAP_ERROR_TTL_MS);
		expect(kit).toHaveBeenCalledTimes(1);
		expect(pad).toHaveBeenCalledTimes(1);
	});

	it('drops a pending clear without running it — the state moved on by itself', () => {
		const clear = vi.fn();
		holdSwapError('rack|kit', clear);
		dropSwapError('rack|kit');
		vi.advanceTimersByTime(SWAP_ERROR_TTL_MS * 2);
		expect(clear).not.toHaveBeenCalled();
	});

	it('flushes every held error now, running each closure once', () => {
		const a = vi.fn();
		const b = vi.fn();
		holdSwapError('a', a);
		holdSwapError('b', b);
		flushSwapErrors();
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(SWAP_ERROR_TTL_MS * 2);
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(1);
	});

	it('flushes on bridge-resync — a message about a path that may have moved must not survive one', () => {
		const clear = vi.fn();
		holdSwapError('rack|kit', clear);
		window.dispatchEvent(new Event('bridge-resync'));
		expect(clear).toHaveBeenCalledTimes(1);
	});
});
