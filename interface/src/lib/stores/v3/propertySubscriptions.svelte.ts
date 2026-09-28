/**
 * V3 Property Subscription Manager — PR-3.5.7.
 *
 * Reference-counted bookkeeping for `/looping/v3/property/{subscribe,
 * unsubscribe}` per [03 §5.2.1] and [ADR-002].
 *
 * The contract: components read `selectedTrackStore.propertyValue(...)`
 * inside `$derived` views. The store's getter calls `acquire(devicePath,
 * propertyName)` on every read; refcount goes 0 → 1 fires the
 * subscribe wire, 1 → 0 fires the unsubscribe. Components never call
 * the wire directly. Mirrors the ergonomics of `paramValue(path)`: a
 * call site can't forget to unsubscribe because it never saw a
 * subscribe.
 *
 * ## Why a manager, not just send-on-read
 *
 * Two reasons:
 *
 * 1. The surface side [PR-3.5.7-impl Python] enforces idempotent
 *    subscribe but charges no cycles to receive a second
 *    `/looping/v3/property/subscribe` for an already-subscribed pair.
 *    Refcounting on our side keeps the wire quieter and makes
 *    "second consumer added" / "first consumer left" precise events
 *    we can log.
 *
 * 2. `$derived` views can re-evaluate any number of times per tick
 *    when the store mutates. Without refcount-on-distinct-keys we'd
 *    fire a wire subscribe on every $derived re-run for the same
 *    `(devicePath, propertyName)` pair.
 *
 * ## Lifecycle of a single key
 *
 * - `acquire(key)` from a $derived view: refcount++. If new (0 → 1),
 *   send `/looping/v3/property/subscribe`.
 * - `release(key)`: refcount--. If reached 0, send
 *   `/looping/v3/property/unsubscribe`.
 * - `releaseAll(devicePath)` from `state/invalidate` for a removed
 *   device: drops every key under that devicePath without sending
 *   unsubscribes (the surface tore them down on its side per
 *   [04 §3.5]).
 * - `resetAll()` from full-tree replacement / surface-restart: drops
 *   the whole table without sending — symmetric to `resetTree()` in
 *   the normalized store.
 *
 * ## Refcounting in a $derived world
 *
 * Svelte 5's `$derived` doesn't expose a direct teardown signal we can
 * hook to "consumer left." We solve this with a per-component
 * acquire/release pattern: components that read `propertyValue` mount
 * an `$effect` that calls `acquire` on attach and returns `release` as
 * its cleanup callback. The store helper exposes a `subscribe(key)`
 * helper that wraps both for the common case.
 *
 * Refcount table is module-scoped (one per UI instance), like the v3
 * normalized store — there's only ever one of each in a session.
 */

import { logger } from '$lib/utils/logger';
import type { OSCArg } from '$lib/types/osc';

export const V3_PROPERTY_SUBSCRIBE_ADDRESS = '/looping/v3/property/subscribe';
export const V3_PROPERTY_UNSUBSCRIBE_ADDRESS = '/looping/v3/property/unsubscribe';

/**
 * The OSC sender. Set once at app start by simpleClient via
 * `setPropertySender`. Kept module-private so consumers can't
 * accidentally bypass the refcount and write to the wire directly.
 */
type Sender = (address: string, args?: OSCArg[]) => void;
let sender: Sender = () => {
	logger.warn('propertySubscriptions: send before sender wired (drop)');
};

/**
 * `(devicePath, propertyName)` joined with a `\u0000` separator into a
 * single string key. Pair coordinates the wire's two-arg shape; a
 * separator that can't appear in a path or property name keeps the
 * key reversible and lookup O(1).
 */
type Key = string;

function makeKey(devicePath: string, propertyName: string): Key {
	return `${devicePath}\u0000${propertyName}`;
}

function splitKey(key: Key): { devicePath: string; propertyName: string } {
	const idx = key.indexOf('\u0000');
	return {
		devicePath: key.slice(0, idx),
		propertyName: key.slice(idx + 1)
	};
}

/** Refcount table. Insertion order is debug-meaningful only. */
const refcounts = new Map<Key, number>();

/**
 * Register the sender. Called once by simpleClient after the WebSocket
 * is wired and a `send` function is available.
 */
export function setPropertySender(s: Sender): void {
	sender = s;
}

/**
 * Bump refcount; on transition 0 → 1, fire
 * `/looping/v3/property/subscribe` to the surface. Returns the new
 * count for log/debug observability.
 */
export function acquire(devicePath: string, propertyName: string): number {
	const key = makeKey(devicePath, propertyName);
	const next = (refcounts.get(key) ?? 0) + 1;
	refcounts.set(key, next);
	if (next === 1) {
		sender(V3_PROPERTY_SUBSCRIBE_ADDRESS, [devicePath, propertyName]);
		logger.debug('property subscribe', { devicePath, propertyName });
	}
	return next;
}

/**
 * Drop refcount; on transition 1 → 0, fire
 * `/looping/v3/property/unsubscribe`. Returns the new count.
 *
 * Releasing an unknown key is a debug-level no-op — it can happen if
 * `releaseAll(devicePath)` fired (state/invalidate) before a $effect
 * cleanup ran. Not an error.
 */
export function release(devicePath: string, propertyName: string): number {
	const key = makeKey(devicePath, propertyName);
	const cur = refcounts.get(key);
	if (cur === undefined) {
		logger.debug('property release: unknown key (likely after invalidate)', {
			devicePath,
			propertyName
		});
		return 0;
	}
	const next = cur - 1;
	if (next <= 0) {
		refcounts.delete(key);
		sender(V3_PROPERTY_UNSUBSCRIBE_ADDRESS, [devicePath, propertyName]);
		logger.debug('property unsubscribe', { devicePath, propertyName });
		return 0;
	}
	refcounts.set(key, next);
	return next;
}

/**
 * Drop every subscription whose devicePath matches `devicePath`,
 * **without sending unsubscribes**. Called by the v3Invalidate
 * handler when a device path goes dead — the surface has already
 * torn down its side per [04 §3.5] "no UI round-trip needed."
 *
 * Returns the count of keys dropped, for log observability.
 */
export function releaseAll(devicePath: string): number {
	const prefix = `${devicePath}\u0000`;
	let dropped = 0;
	for (const key of refcounts.keys()) {
		if (key.startsWith(prefix)) {
			refcounts.delete(key);
			dropped += 1;
		}
	}
	return dropped;
}

/**
 * Drop every subscription whose devicePath equals `path` *or* lives
 * underneath it (i.e. devicePath starts with `${path}/`). Used by the
 * v3Invalidate handler, which receives paths at any granularity:
 * whole-track (`tracks/3`), single-device (`tracks/3/devices/0`), or
 * subtree below the device (`tracks/3/devices/0/params/...`). All
 * three should drop the device's property subs — the surface has
 * torn them down on its side per [04 §3.5].
 *
 * No wire emission. Returns count of keys dropped.
 */
export function releaseUnderPath(path: string): number {
	const subtreePrefix = `${path}/`;
	let dropped = 0;
	for (const key of refcounts.keys()) {
		const sep = key.indexOf('\u0000');
		const devicePath = sep < 0 ? key : key.slice(0, sep);
		if (devicePath === path || devicePath.startsWith(subtreePrefix)) {
			refcounts.delete(key);
			dropped += 1;
		}
	}
	return dropped;
}

/**
 * Drop the whole table without sending. Used by:
 *
 * - Tree-replacement from a fresh `state/full` — the new tree has its
 *   own device records and the old subscriptions are no longer load-
 *   bearing.
 * - Surface restart — see `resetForSurfaceRestart` in the normalized
 *   store; the new surface instance has no record of the old subs.
 * - Test reset.
 */
export function resetAll(): void {
	refcounts.clear();
}

/** Read the current refcount for a key — test helper. */
export function _refcountForTest(devicePath: string, propertyName: string): number {
	return refcounts.get(makeKey(devicePath, propertyName)) ?? 0;
}

/** Iterate keys — test helper for inspecting state. */
export function _allKeysForTest(): Array<{ devicePath: string; propertyName: string; count: number }> {
	const out: Array<{ devicePath: string; propertyName: string; count: number }> = [];
	for (const [key, count] of refcounts.entries()) {
		const { devicePath, propertyName } = splitKey(key);
		out.push({ devicePath, propertyName, count });
	}
	return out;
}
