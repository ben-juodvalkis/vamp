/**
 * groupGestureStore — the "hold Group, tap track strips, release" gesture's
 * local state.
 *
 * **Nothing touches Live until `commit`** (2026-09-20 rewrite) — `start` and
 * `tap` are now pure local bookkeeping (an id in a `Set`), not a real click
 * per tap. The earlier version clicked each tap into Live's real selection
 * live and reverted it optimistically on a refusal; that made every tap a
 * real Accessibility round trip racing whatever the *next* tap or a
 * concurrent commit/cancel did on the bridge, and it crashed there for real
 * (see `liveGroupTracks.test.ts`'s module docstring). So this file tests
 * exactly what the store now does: latch/active bookkeeping, the tapped set,
 * and that `commit` is the one and only point a wire call happens, carrying
 * the whole finished member list.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const commitGroupGesture = vi.fn();
vi.mock('$lib/services/trackOperations', () => ({
	commitGroupGesture: (...args: unknown[]) => commitGroupGesture(...args)
}));

vi.mock('$lib/utils/logger', () => ({
	logger: { debug() {}, info() {}, warn() {}, error() {} }
}));

import { groupGestureStore } from '$lib/stores/v6/groupGestureStore.svelte';

describe('groupGestureStore', () => {
	beforeEach(() => {
		commitGroupGesture.mockReset().mockResolvedValue(undefined);
	});

	it('start opens the gesture with the anchor as its sole member, not latched -- no wire call', () => {
		groupGestureStore.start('tracks/0', 'Shaker');
		expect(groupGestureStore.active).toBe(true);
		expect(groupGestureStore.latched).toBe(false);
		expect(groupGestureStore.memberPaths).toEqual(new Set(['tracks/0']));
		expect(commitGroupGesture).not.toHaveBeenCalled();
	});

	it('start resets to a clean, unlatched gesture even if one was already latched', () => {
		groupGestureStore.start('tracks/0', 'Shaker');
		groupGestureStore.tap('tracks/1', 'Drive 2');
		groupGestureStore.latch();
		groupGestureStore.start('tracks/2', 'Guitar');
		expect(groupGestureStore.latched).toBe(false);
		expect(groupGestureStore.memberPaths).toEqual(new Set(['tracks/2']));
	});

	it('latch marks the gesture open with no pointer required', () => {
		groupGestureStore.start('tracks/0', 'Shaker');
		groupGestureStore.latch();
		expect(groupGestureStore.active).toBe(true);
		expect(groupGestureStore.latched).toBe(true);
	});

	it('tap adds a track locally -- no wire call', () => {
		groupGestureStore.start('tracks/0', 'Shaker');
		groupGestureStore.tap('tracks/1', 'Drive 2');
		expect(groupGestureStore.memberPaths).toEqual(new Set(['tracks/0', 'tracks/1']));
		expect(commitGroupGesture).not.toHaveBeenCalled();
	});

	it('tap toggles an already-tapped track back out', () => {
		groupGestureStore.start('tracks/0', 'Shaker');
		groupGestureStore.tap('tracks/1', 'Drive 2');
		groupGestureStore.tap('tracks/1', 'Drive 2');
		expect(groupGestureStore.memberPaths.has('tracks/1')).toBe(false);
	});

	it('tap ignores the anchor itself and does nothing with no gesture open', () => {
		groupGestureStore.start('tracks/0', 'Shaker');
		groupGestureStore.tap('tracks/0', 'Shaker');
		expect(groupGestureStore.memberPaths).toEqual(new Set(['tracks/0']));

		groupGestureStore.cancel();
		groupGestureStore.tap('tracks/1', 'Drive 2');
		expect(groupGestureStore.memberPaths.size).toBe(0);
	});

	it('commit sends the anchor plus every tap that stuck, in order, once', async () => {
		groupGestureStore.start('tracks/0', 'Shaker');
		groupGestureStore.tap('tracks/1', 'Drive 2');
		groupGestureStore.tap('tracks/2', 'Guitar');
		await groupGestureStore.commit();
		expect(commitGroupGesture).toHaveBeenCalledTimes(1);
		expect(commitGroupGesture).toHaveBeenCalledWith([
			{ path: 'tracks/0', name: 'Shaker' },
			{ path: 'tracks/1', name: 'Drive 2' },
			{ path: 'tracks/2', name: 'Guitar' }
		]);
	});

	it('commit excludes a tap that was toggled back out', async () => {
		groupGestureStore.start('tracks/0', 'Shaker');
		groupGestureStore.tap('tracks/1', 'Drive 2');
		groupGestureStore.tap('tracks/1', 'Drive 2'); // toggled back out
		await groupGestureStore.commit();
		expect(commitGroupGesture).toHaveBeenCalledWith([{ path: 'tracks/0', name: 'Shaker' }]);
	});

	it('commit resets the gesture whether it succeeds or fails', async () => {
		groupGestureStore.start('tracks/0', 'Shaker');
		await groupGestureStore.commit();
		expect(groupGestureStore.active).toBe(false);
		expect(groupGestureStore.latched).toBe(false);

		groupGestureStore.start('tracks/0', 'Shaker');
		commitGroupGesture.mockRejectedValueOnce(new Error('already-grouped'));
		await groupGestureStore.commit();
		expect(groupGestureStore.active).toBe(false);
	});

	it('cancel resets the gesture with no wire call at all -- nothing happened on Live yet', () => {
		groupGestureStore.start('tracks/0', 'Shaker');
		groupGestureStore.tap('tracks/1', 'Drive 2');
		groupGestureStore.cancel();
		expect(groupGestureStore.active).toBe(false);
		expect(groupGestureStore.memberPaths.size).toBe(0);
		expect(commitGroupGesture).not.toHaveBeenCalled();
	});

	it('commit is a no-op with no gesture open', async () => {
		await groupGestureStore.commit();
		expect(commitGroupGesture).not.toHaveBeenCalled();
	});
});
