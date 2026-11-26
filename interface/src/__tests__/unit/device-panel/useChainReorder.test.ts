/**
 * The chain's drop queue, re-planned on events: a drop sends one move,
 * Live's report of the chain lands it, and a move Live never shows runs
 * out. Before, one `$effect` read and wrote `reorder` and re-armed itself
 * by assigning a copy of it from a timer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { mountRune, stateBox } from '../../helpers/runeHarness.svelte';
import { ChainReorder } from '$lib/components/v6/device-panel/chain/useChainReorder.svelte';
import { moved, type ChainEntry } from '$lib/utils/chainDrop';

const chain = (...sigs: string[]): ChainEntry[] =>
	sigs.map((sig, i) => ({ key: `${sig}|0`, sig, path: `tracks/0/devices/${i}` }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ChainReorder', () => {
	function setup() {
		const cells = stateBox(chain('A', 'B', 'C'));
		const send = vi.fn((_path: string, _to: number) => Promise.resolve());
		const { handle, stop } = mountRune(() => new ChainReorder(() => cells.value, send, 2000));
		flushSync();
		return { cells, send, reorder: handle, stop };
	}

	it('a drop sends one move and holds the order until Live shows it', () => {
		const { cells, send, reorder, stop } = setup();
		reorder.drop(moved(cells.value, 0, 2));
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0].slice(0, 2)).toEqual(['tracks/0/devices/0', 2]);
		expect(reorder.state.desired?.map((d) => d.sig)).toEqual(['B', 'C', 'A']);
		cells.value = chain('B', 'C', 'A');
		flushSync();
		expect(reorder.state.desired).toBeNull();
		expect(send).toHaveBeenCalledTimes(1);
		stop();
	});

	it('a move Live never shows runs out and the order falls back', () => {
		const { cells, reorder, stop } = setup();
		reorder.drop(moved(cells.value, 0, 2));
		expect(reorder.state.inflight).not.toBeNull();
		vi.advanceTimersByTime(2000);
		expect(reorder.state.desired).toBeNull();
		stop();
	});

	it('a refused move resets', async () => {
		const cells = stateBox(chain('A', 'B'));
		const { handle: reorder, stop } = mountRune(
			() => new ChainReorder(() => cells.value, () => Promise.reject(new Error('no')), 2000)
		);
		flushSync();
		reorder.drop(moved(cells.value, 0, 1));
		await Promise.resolve();
		await Promise.resolve();
		expect(reorder.state.desired).toBeNull();
		stop();
	});
});
