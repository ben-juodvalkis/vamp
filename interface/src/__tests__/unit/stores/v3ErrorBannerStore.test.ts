/**
 * vitest coverage for the PR-5e2 v3 error banner store.
 *
 * Scalar pattern: `show(code, path, detail)` populates the banner,
 * `clear()` removes it, and a fake-timer run auto-dismisses after
 * `AUTO_DISMISS_MS` (6s).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { v3ErrorBannerStore } from '$lib/stores/v6/v3ErrorBannerStore.svelte';

describe('v3ErrorBannerStore', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		v3ErrorBannerStore.clear();
	});

	afterEach(() => {
		v3ErrorBannerStore.clear();
		vi.useRealTimers();
	});

	it('starts with a null banner', () => {
		expect(v3ErrorBannerStore.banner).toBeNull();
	});

	it('show() populates code/path/detail and timestamp', () => {
		v3ErrorBannerStore.show(
			'pool-exhausted',
			'tracks/0/slots/1/clip',
			'Pool has 0 unassigned grooves'
		);
		const b = v3ErrorBannerStore.banner;
		expect(b).not.toBeNull();
		expect(b!.code).toBe('pool-exhausted');
		expect(b!.path).toBe('tracks/0/slots/1/clip');
		expect(b!.detail).toBe('Pool has 0 unassigned grooves');
		expect(typeof b!.timestamp).toBe('number');
	});

	it('auto-dismisses after 6s', () => {
		v3ErrorBannerStore.show('pool-exhausted', 'path', 'detail');
		expect(v3ErrorBannerStore.banner).not.toBeNull();
		vi.advanceTimersByTime(5999);
		expect(v3ErrorBannerStore.banner).not.toBeNull();
		vi.advanceTimersByTime(2);
		expect(v3ErrorBannerStore.banner).toBeNull();
	});

	it('clear() dismisses immediately', () => {
		v3ErrorBannerStore.show('pool-exhausted', 'path', 'detail');
		v3ErrorBannerStore.clear();
		expect(v3ErrorBannerStore.banner).toBeNull();
	});

	it('re-show() replaces the banner and restarts the timer', () => {
		v3ErrorBannerStore.show('pool-exhausted', 'a', 'first');
		vi.advanceTimersByTime(4000);
		v3ErrorBannerStore.show('pool-exhausted', 'b', 'second');
		expect(v3ErrorBannerStore.banner!.path).toBe('b');
		// The first banner's auto-dismiss (+ 2000ms from show #1) must not
		// zero-out the second banner — we should still be live.
		vi.advanceTimersByTime(2001);
		expect(v3ErrorBannerStore.banner).not.toBeNull();
		expect(v3ErrorBannerStore.banner!.path).toBe('b');
		// Finish the second banner's own 6s window.
		vi.advanceTimersByTime(4000);
		expect(v3ErrorBannerStore.banner).toBeNull();
	});
});
