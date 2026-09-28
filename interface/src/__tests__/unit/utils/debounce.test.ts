import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce, throttle } from '$lib/utils/performance/debounce';

describe('debounce', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('basic debounce behavior', () => {
		it('should delay function execution by wait time', () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100);

			debounced();
			expect(fn).not.toHaveBeenCalled();

			vi.advanceTimersByTime(50);
			expect(fn).not.toHaveBeenCalled();

			vi.advanceTimersByTime(50);
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('should call with latest args when called multiple times within wait period', () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100);

			debounced('first');
			vi.advanceTimersByTime(50);

			debounced('second'); // Updates args for the pending call

			vi.advanceTimersByTime(50);
			// Timer fires, trailing edge uses the latest args
			expect(fn).toHaveBeenCalledTimes(1);
			expect(fn).toHaveBeenCalledWith('second');
		});

		it('should pass arguments to the debounced function', () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100);

			debounced('arg1', 'arg2');
			vi.advanceTimersByTime(100);

			expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
		});

		it('should use the last arguments when called multiple times', () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100);

			debounced('first');
			debounced('second');
			debounced('third');

			vi.advanceTimersByTime(100);

			expect(fn).toHaveBeenCalledTimes(1);
			expect(fn).toHaveBeenCalledWith('third');
		});

		it('should preserve this context', () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100);
			const obj = { debounced };

			obj.debounced();
			vi.advanceTimersByTime(100);

			expect(fn.mock.instances[0]).toBe(obj);
		});
	});

	describe('leading option', () => {
		it('should invoke immediately on leading edge when leading=true', () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100, { leading: true });

			debounced();
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('should not invoke on trailing edge when trailing=false and leading=true', () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100, { leading: true, trailing: false });

			debounced();
			expect(fn).toHaveBeenCalledTimes(1);

			debounced();
			vi.advanceTimersByTime(100);

			// Should still only be 1 call (the leading one)
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('should invoke on both edges when leading=true and trailing=true', () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100, { leading: true, trailing: true });

			debounced();
			expect(fn).toHaveBeenCalledTimes(1); // Leading

			debounced();
			vi.advanceTimersByTime(100);

			expect(fn).toHaveBeenCalledTimes(2); // Trailing
		});
	});

	describe('cancel method', () => {
		it('should cancel pending invocations', () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100);

			debounced();
			debounced.cancel();
			vi.advanceTimersByTime(100);

			expect(fn).not.toHaveBeenCalled();
		});

		it('should reset state after cancel', () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100);

			debounced('first');
			debounced.cancel();

			debounced('second');
			vi.advanceTimersByTime(100);

			expect(fn).toHaveBeenCalledTimes(1);
			expect(fn).toHaveBeenCalledWith('second');
		});
	});

	describe('flush method', () => {
		it('should invoke pending function immediately', () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100);

			debounced('arg');
			debounced.flush();

			expect(fn).toHaveBeenCalledTimes(1);
			expect(fn).toHaveBeenCalledWith('arg');
		});

		it('should return undefined when no pending invocation', () => {
			const fn = vi.fn().mockReturnValue('result');
			const debounced = debounce(fn, 100);

			const result = debounced.flush();
			expect(result).toBeUndefined();
			expect(fn).not.toHaveBeenCalled();
		});

		it('should not double-invoke after flush', () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100);

			debounced();
			debounced.flush();
			vi.advanceTimersByTime(100);

			expect(fn).toHaveBeenCalledTimes(1);
		});
	});

	describe('multiple calls with time gaps', () => {
		it('should allow new invocations after wait period', () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100);

			debounced('first');
			vi.advanceTimersByTime(100);
			expect(fn).toHaveBeenCalledTimes(1);

			debounced('second');
			vi.advanceTimersByTime(100);
			expect(fn).toHaveBeenCalledTimes(2);
		});
	});
});

describe('throttle', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should invoke immediately on first call (leading=true by default)', () => {
		const fn = vi.fn();
		const throttled = throttle(fn, 100);

		throttled();
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('should throttle subsequent calls', () => {
		const fn = vi.fn();
		const throttled = throttle(fn, 100);

		throttled();
		throttled();
		throttled();

		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('should invoke trailing call after wait period', () => {
		const fn = vi.fn();
		const throttled = throttle(fn, 100);

		throttled('first');
		throttled('second');
		throttled('third');

		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith('first');

		vi.advanceTimersByTime(100);

		expect(fn).toHaveBeenCalledTimes(2);
		expect(fn).toHaveBeenLastCalledWith('third');
	});

	it('should not invoke trailing when trailing=false', () => {
		const fn = vi.fn();
		const throttled = throttle(fn, 100, { trailing: false });

		throttled();
		throttled();
		throttled();

		vi.advanceTimersByTime(100);

		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('should not invoke leading when leading=false', () => {
		const fn = vi.fn();
		const throttled = throttle(fn, 100, { leading: false });

		throttled();
		expect(fn).not.toHaveBeenCalled();

		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
