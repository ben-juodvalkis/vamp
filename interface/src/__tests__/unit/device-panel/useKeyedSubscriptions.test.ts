import { describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountRune, stateBox } from '../../helpers/runeHarness.svelte';
import { useKeyedSubscriptions } from '$lib/components/v6/device-panel/chain/useKeyedSubscriptions.svelte';

describe('useKeyedSubscriptions', () => {
	it('acquires each new key once, releases a dropped one, and releases all on teardown', () => {
		const keys = stateBox(['a', 'b']);
		const released: string[] = [];
		const acquire = vi.fn((key: string) => () => released.push(key));
		const { stop } = mountRune(() => useKeyedSubscriptions(() => keys.value, acquire));
		flushSync();
		expect(acquire.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);

		keys.value = ['b', 'c'];
		flushSync();
		expect(acquire.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c']);
		expect(released).toEqual(['a']);

		stop();
		expect(released.sort()).toEqual(['a', 'b', 'c']);
	});
});
