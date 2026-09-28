/**
 * Outbound Batcher — coalesces UI→Surf WebSocket frames.
 *
 * The mirror of the bridge's `utils/broadcastBatcher.js`, and
 * deliberately shaped like it: same envelope address, same
 * single-item passthrough, opposite direction. A reader who knows one
 * should not have to learn a second grammar for the other.
 *
 * The problem
 * -----------
 *
 * `WebSocketConnection.send` emitted one frame per call. Anything that
 * writes in a loop therefore produced a burst — the canonical case is
 * `trackColoring.applyAutoColorOnPrepareAck`, which sends the track
 * colour plus one message per clip, so a preset load onto an 8-clip
 * track was 9 frames that were always going to leave together anyway.
 *
 * Why a microtask, not a window
 * -----------------------------
 *
 * `broadcastBatcher` uses a 10 ms timed window, and its own docstring
 * explains why that is safe there and not here: it batches Surf→UI
 * meter fan-out, whereas this direction carries click input, and
 * "adding window latency to click input would be a regression."
 *
 * A microtask adds **zero** latency. It runs at the end of the current
 * synchronous turn, before the browser renders, times out, or does
 * I/O. Nothing that was going to happen sooner now happens later; the
 * batcher only merges writes that had already been issued together.
 *
 * Why the batcher doesn't know about the socket
 * ---------------------------------------------
 *
 * `deliver` receives the drained array and decides what to do with it.
 * That keeps the "is the socket open, and if not where do these go"
 * question in `WebSocketConnection`, which owns the connection
 * lifecycle, and leaves this module as pure queue mechanics — which is
 * what makes it testable without a WebSocket at all.
 */

import type { OSCArg } from '$lib/types/osc';

export interface OutboundMessage {
	address: string;
	args: OSCArg[];
}

export interface OutboundBatcher {
	/** Queue one message for the current turn. */
	enqueue(message: OutboundMessage): void;
	/** Drain now rather than waiting for the scheduled flush. */
	flush(): void;
	/** How many messages are waiting. Diagnostics and tests. */
	pending(): number;
}

export interface OutboundBatcherOptions {
	/**
	 * Called with every message queued during one turn, in FIFO order.
	 * Never called with an empty array.
	 */
	deliver: (messages: OutboundMessage[]) => void;
	/**
	 * Defers the flush. Defaults to `queueMicrotask`. Injectable so
	 * tests can drive the boundary deterministically instead of
	 * awaiting real microtasks.
	 */
	schedule?: (flush: () => void) => void;
}

export function createOutboundBatcher(
	options: OutboundBatcherOptions
): OutboundBatcher {
	const { deliver } = options;
	const schedule = options.schedule ?? queueMicrotask;

	let queue: OutboundMessage[] = [];
	let scheduled = false;

	function flush(): void {
		// Cleared before delivering, not after: `deliver` can re-enter
		// via a send triggered downstream, and that send must be able to
		// schedule a fresh flush rather than being swallowed into the
		// batch currently being drained.
		scheduled = false;
		if (queue.length === 0) return;
		const drained = queue;
		queue = [];
		deliver(drained);
	}

	return {
		enqueue(message: OutboundMessage): void {
			queue.push(message);
			if (!scheduled) {
				scheduled = true;
				schedule(flush);
			}
		},
		flush,
		pending: () => queue.length
	};
}
