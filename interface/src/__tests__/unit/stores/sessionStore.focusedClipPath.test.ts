/**
 * PR-5e1 vitest coverage for `session.focusedClipPath` plumbing.
 *
 * Pairs with the pytest suite
 * `surface/tests/test_clip_properties_component.py`.
 *
 * Covered here:
 *  - empty string ("" wire sentinel) normalizes to null
 *  - real path stores as-is
 *  - idempotent on same path (no redundant clearAll)
 *  - any focus change triggers `clipPropertiesStore.clearAll()`
 *  - `hasFocusedClipPath` tracks null/non-null
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

const { mockClearAll } = vi.hoisted(() => ({ mockClearAll: vi.fn() }));
vi.mock('$lib/stores/v6/clipPropertiesStore.svelte', () => ({
	clipPropertiesStore: {
		clearAll: mockClearAll,
		handleLoopStart: vi.fn(),
		handleLoopEnd: vi.fn(),
		handleStartMarker: vi.fn(),
		handleEndMarker: vi.fn(),
		handleWarpMode: vi.fn(),
		handleLoopEnabled: vi.fn()
	}
}));

vi.mock('$lib/stores/v6/centralDisplayStore.svelte', () => ({
	centralDisplayStore: { setSystemView: vi.fn() }
}));

import { session, handleFocusedClipPath } from '$lib/stores/session.svelte';

async function flushDynamicImport() {
	// `handleFocusedClipPath` fires `import().then(...)`; dynamic
	// import resolution is asynchronous even for mocked modules.
	// A few microtask flushes + a macrotask yield is enough.
	for (let i = 0; i < 10; i++) await Promise.resolve();
	await new Promise(resolve => setTimeout(resolve, 0));
}

describe('session.focusedClipPath (PR-5e1)', () => {
	beforeEach(async () => {
		// Reset state to null between tests. First call from null → null
		// is a no-op, so pre-seed a sentinel and clear back to null —
		// then wait for the dynamic-import resolution before clearing
		// the mock counter.
		handleFocusedClipPath('tracks/99/slots/99/clip');
		await flushDynamicImport();
		handleFocusedClipPath('');
		await flushDynamicImport();
		mockClearAll.mockClear();
	});

	it('stores a real path verbatim', async () => {
		handleFocusedClipPath('tracks/0/slots/0/clip');
		expect(session.focusedClipPath).toBe('tracks/0/slots/0/clip');
		expect(session.hasFocusedClipPath).toBe(true);
		await flushDynamicImport();
	});

	it('normalizes empty string "" to null', async () => {
		handleFocusedClipPath('tracks/1/slots/2/clip');
		handleFocusedClipPath('');
		expect(session.focusedClipPath).toBeNull();
		expect(session.hasFocusedClipPath).toBe(false);
		await flushDynamicImport();
	});

	it('triggers clipPropertiesStore.clearAll on focus change to new path', async () => {
		handleFocusedClipPath('tracks/0/slots/0/clip');
		await flushDynamicImport();
		expect(mockClearAll).toHaveBeenCalledTimes(1);
	});

	it('triggers clearAll on focus change to null (empty string)', async () => {
		handleFocusedClipPath('tracks/0/slots/0/clip');
		await flushDynamicImport();
		mockClearAll.mockClear();

		handleFocusedClipPath('');
		await flushDynamicImport();
		expect(mockClearAll).toHaveBeenCalledTimes(1);
	});

	it('is idempotent — same path twice does not re-clear', async () => {
		handleFocusedClipPath('tracks/0/slots/0/clip');
		await flushDynamicImport();
		mockClearAll.mockClear();

		handleFocusedClipPath('tracks/0/slots/0/clip');
		await flushDynamicImport();
		expect(mockClearAll).not.toHaveBeenCalled();
	});

	it('switching between two real paths clears once per change', async () => {
		handleFocusedClipPath('tracks/0/slots/0/clip');
		await flushDynamicImport();
		mockClearAll.mockClear();

		handleFocusedClipPath('tracks/1/slots/0/clip');
		await flushDynamicImport();
		expect(mockClearAll).toHaveBeenCalledTimes(1);
		expect(session.focusedClipPath).toBe('tracks/1/slots/0/clip');
	});
});
