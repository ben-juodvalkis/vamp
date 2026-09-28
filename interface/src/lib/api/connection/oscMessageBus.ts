/**
 * The inbound "every message" bus — the Open Channel Architecture channel that
 * `trackPreparation` and `trackOperations` correlate their request/ack pairs on.
 *
 * It used to be a `CustomEvent` on `window`, constructed and dispatched once
 * per inbound message — the batcher's disassembly loop included, so a
 * `/bridge/batch` of twelve meter frames cost twelve of them. Its listener
 * count in the steady state is **zero**: both consumers register inside a
 * per-request Promise and remove on settle, so outside the few hundred
 * milliseconds around a preset load or a track duplicate there is nobody to
 * deliver to. Meters and playheads alone kept that allocation running all set.
 *
 * A plain Set costs an `if (listeners.size === 0) return` instead, and gives
 * the callers a typed handler rather than an `Event` they have to cast and
 * unwrap. The listener signature is the message itself, which is what every
 * handler read out of `detail` anyway.
 *
 * Deliberately import-free. This module sits on the inbound hot path and is
 * reached from `api/`, `services/` and tests; a value import of anything in
 * `stores/` or `services/` would put it inside the 40-module SCC.
 */

export interface OscBusMessage {
	address?: string;
	args?: unknown[];
}

export type OscMessageListener = (message: OscBusMessage) => void;

const listeners = new Set<OscMessageListener>();

/** Register a listener. Registering the same function twice is a no-op. */
export function addOscMessageListener(fn: OscMessageListener): void {
	listeners.add(fn);
}

/** Remove a listener. Removing one that was never added is a no-op. */
export function removeOscMessageListener(fn: OscMessageListener): void {
	listeners.delete(fn);
}

/** How many listeners are registered. Exists so a test can prove a leak. */
export function oscMessageListenerCount(): number {
	return listeners.size;
}

/**
 * Deliver a message to every listener.
 *
 * Returns false when there was nobody to deliver to — the common case, and
 * the reason this exists. A throwing listener must not take the others (or
 * the socket's `onmessage`) down with it, so each call is isolated; the bus
 * has no logger of its own by design, so the error goes to the console the
 * same way an unhandled listener error on `window` used to.
 */
export function dispatchOscMessage(message: OscBusMessage): boolean {
	if (listeners.size === 0) return false;
	// Copy: a listener that removes itself on settle (both real consumers do)
	// would otherwise mutate the Set mid-iteration.
	for (const fn of [...listeners]) {
		try {
			fn(message);
		} catch (err) {
			console.error('[oscMessageBus] listener threw', err);
		}
	}
	return true;
}

/** Drop every listener. Tests only — production removes them by hand. */
export function resetOscMessageBusForTests(): void {
	listeners.clear();
}
