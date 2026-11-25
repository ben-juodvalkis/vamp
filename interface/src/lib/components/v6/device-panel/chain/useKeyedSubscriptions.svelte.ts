/**
 * Hold one subscription per key for as long as the key is wanted: diffed
 * by key, so a key that stays keeps its subscription and only keys that
 * come or go acquire or release. Everything still held is released when
 * the component goes. Call during component initialisation.
 *
 * ```ts
 * useKeyedSubscriptions(
 *   () => openRacks,
 *   (path) => subscribeAll(path, [CHAIN_DEVICES, SELECTED_CHAIN])
 * );
 * ```
 */
import { untrack } from 'svelte';

export function useKeyedSubscriptions(
	getKeys: () => Iterable<string>,
	acquire: (key: string) => () => void
): void {
	const held = new Map<string, () => void>();
	$effect(() => {
		const want = new Set(getKeys());
		untrack(() => {
			for (const [key, release] of [...held]) {
				if (want.has(key)) continue;
				release();
				held.delete(key);
			}
			for (const key of want) {
				if (!held.has(key)) held.set(key, acquire(key));
			}
		});
	});
	// Tracks nothing, so its teardown runs once: when the owner goes.
	$effect(() => () => {
		for (const release of held.values()) release();
		held.clear();
	});
}
