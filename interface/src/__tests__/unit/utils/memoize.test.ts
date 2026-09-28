import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { memoize, weakMemoize } from '$lib/utils/performance/memoize';

describe('memoize', () => {
	describe('basic caching', () => {
		it('should cache function results', () => {
			const fn = vi.fn((x: number) => x * 2);
			const memoized = memoize(fn);

			expect(memoized(5)).toBe(10);
			expect(memoized(5)).toBe(10);

			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('should cache based on all arguments', () => {
			const fn = vi.fn((a: number, b: number) => a + b);
			const memoized = memoize(fn);

			expect(memoized(1, 2)).toBe(3);
			expect(memoized(1, 2)).toBe(3);
			expect(memoized(1, 3)).toBe(4);

			expect(fn).toHaveBeenCalledTimes(2);
		});

		it('should handle different argument types', () => {
			const fn = vi.fn((obj: { a: number }) => obj.a * 2);
			const memoized = memoize(fn);

			expect(memoized({ a: 5 })).toBe(10);
			expect(memoized({ a: 5 })).toBe(10); // Same structure = same key

			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('should handle string arguments', () => {
			const fn = vi.fn((s: string) => s.toUpperCase());
			const memoized = memoize(fn);

			expect(memoized('hello')).toBe('HELLO');
			expect(memoized('hello')).toBe('HELLO');
			expect(memoized('world')).toBe('WORLD');

			expect(fn).toHaveBeenCalledTimes(2);
		});

		it('should handle null and undefined arguments', () => {
			const fn = vi.fn((x: number | null | undefined) => x ?? 0);
			const memoized = memoize(fn);

			expect(memoized(null)).toBe(0);
			expect(memoized(null)).toBe(0);
			expect(memoized(undefined)).toBe(0);
			expect(memoized(undefined)).toBe(0);

			// JSON.stringify treats null and undefined differently in arrays:
			// JSON.stringify([null]) = "[null]"
			// JSON.stringify([undefined]) = "[null]" (undefined becomes null in JSON)
			// So both null and undefined result in the same cache key "[null]"
			expect(fn).toHaveBeenCalledTimes(1);
		});
	});

	describe('maxSize option', () => {
		it('should evict oldest entry when maxSize exceeded', () => {
			const fn = vi.fn((x: number) => x * 2);
			const memoized = memoize(fn, { maxSize: 2 });

			memoized(1);
			memoized(2);
			memoized(3); // Should evict cache for 1

			expect(fn).toHaveBeenCalledTimes(3);

			memoized(1); // Should call fn again since it was evicted
			expect(fn).toHaveBeenCalledTimes(4);

			memoized(3); // Should still be cached
			expect(fn).toHaveBeenCalledTimes(4);
		});

		it('should use default maxSize of 100', () => {
			const fn = vi.fn((x: number) => x * 2);
			const memoized = memoize(fn);

			// Call with 100 different values
			for (let i = 0; i < 100; i++) {
				memoized(i);
			}

			expect(fn).toHaveBeenCalledTimes(100);

			// All should still be cached
			for (let i = 0; i < 100; i++) {
				memoized(i);
			}

			expect(fn).toHaveBeenCalledTimes(100);
		});
	});

	describe('getKey option', () => {
		it('should use custom key function', () => {
			const fn = vi.fn((obj: { id: number; name: string }) => obj.name.toUpperCase());
			const memoized = memoize(fn, {
				getKey: (obj) => obj.id.toString()
			});

			expect(memoized({ id: 1, name: 'hello' })).toBe('HELLO');
			expect(memoized({ id: 1, name: 'world' })).toBe('HELLO'); // Same id = cache hit

			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('should differentiate based on custom key', () => {
			const fn = vi.fn((x: number, y: number) => x + y);
			const memoized = memoize(fn, {
				getKey: (x) => x.toString() // Only use first arg as key
			});

			expect(memoized(1, 2)).toBe(3);
			expect(memoized(1, 5)).toBe(3); // Same first arg = cache hit

			expect(fn).toHaveBeenCalledTimes(1);
		});
	});

	describe('ttl option', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('should return cached value before TTL expires', () => {
			const fn = vi.fn((x: number) => x * 2);
			const memoized = memoize(fn, { ttl: 1000 });

			expect(memoized(5)).toBe(10);

			vi.advanceTimersByTime(500);

			expect(memoized(5)).toBe(10);
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('should recalculate after TTL expires', () => {
			const fn = vi.fn((x: number) => x * 2);
			const memoized = memoize(fn, { ttl: 1000 });

			expect(memoized(5)).toBe(10);

			vi.advanceTimersByTime(1001);

			expect(memoized(5)).toBe(10);
			expect(fn).toHaveBeenCalledTimes(2);
		});

		it('should handle TTL with different keys', () => {
			const fn = vi.fn((x: number) => x * 2);
			const memoized = memoize(fn, { ttl: 1000 });

			memoized(1);
			vi.advanceTimersByTime(500);
			memoized(2);

			expect(fn).toHaveBeenCalledTimes(2);

			vi.advanceTimersByTime(501);

			// Key 1 expired, key 2 still valid
			memoized(1);
			memoized(2);

			expect(fn).toHaveBeenCalledTimes(3); // Only key 1 recalculated
		});
	});

	describe('edge cases', () => {
		it('should handle functions that return undefined', () => {
			const fn = vi.fn(() => undefined);
			const memoized = memoize(fn);

			expect(memoized()).toBeUndefined();
			expect(memoized()).toBeUndefined();

			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('should handle functions that return null', () => {
			const fn = vi.fn(() => null);
			const memoized = memoize(fn);

			expect(memoized()).toBeNull();
			expect(memoized()).toBeNull();

			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('should handle functions with no arguments', () => {
			let counter = 0;
			const fn = vi.fn(() => ++counter);
			const memoized = memoize(fn);

			expect(memoized()).toBe(1);
			expect(memoized()).toBe(1); // Cached

			expect(fn).toHaveBeenCalledTimes(1);
		});
	});
});

describe('weakMemoize', () => {
	it('should cache based on object reference', () => {
		const fn = vi.fn((obj: { value: number }) => obj.value * 2);
		const memoized = weakMemoize(fn);

		const obj1 = { value: 5 };
		const obj2 = { value: 5 };

		expect(memoized(obj1)).toBe(10);
		expect(memoized(obj1)).toBe(10);
		expect(memoized(obj2)).toBe(10);

		// Different object references = different cache entries
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('should cache with additional arguments', () => {
		const fn = vi.fn((obj: { base: number }, multiplier: number) => obj.base * multiplier);
		const memoized = weakMemoize(fn);

		const obj = { base: 5 };

		expect(memoized(obj, 2)).toBe(10);
		expect(memoized(obj, 2)).toBe(10);
		expect(memoized(obj, 3)).toBe(15);

		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('should use separate cache per object', () => {
		const fn = vi.fn((obj: { id: number }, suffix: string) => `${obj.id}-${suffix}`);
		const memoized = weakMemoize(fn);

		const obj1 = { id: 1 };
		const obj2 = { id: 2 };

		expect(memoized(obj1, 'a')).toBe('1-a');
		expect(memoized(obj2, 'a')).toBe('2-a');
		expect(memoized(obj1, 'a')).toBe('1-a');
		expect(memoized(obj2, 'a')).toBe('2-a');

		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('should handle objects with no additional args', () => {
		const fn = vi.fn((obj: { x: number }) => obj.x * 2);
		const memoized = weakMemoize(fn);

		const obj = { x: 5 };

		expect(memoized(obj)).toBe(10);
		expect(memoized(obj)).toBe(10);

		expect(fn).toHaveBeenCalledTimes(1);
	});
});
