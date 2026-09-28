/**
 * How long a refused swap wears its reason (2026-09-15).
 *
 * The swap pill shows a failure in place of the name — `ax-helper-down`,
 * `swap-not-rankable`, a surface code — which is the right thing for a
 * performer who just pressed it and needs to know why nothing moved. What was
 * wrong is that the reason never left: the three swap stores each keep their
 * state in a map keyed by path, nothing cleared an error but a later
 * *successful* step on the same key, and `similarSwap`'s key is positional
 * (`tracks/1/devices/0|kit`), so deleting a track above a rack handed a
 * different rack the previous one's failure as its label. A pill that says
 * `ax-control-disabled` about a kit that is perfectly swappable is worse than
 * one that says nothing.
 *
 * So an error is transient: it is shown, and then it is dropped and the pill
 * goes back to naming what is loaded. The store keeps the shape of its own
 * state — each caller passes the closure that clears its own field — and this
 * module owns only the timing, so all three stores behave the same way and
 * only one of them has to be reasoned about.
 *
 * A `bridge-resync` drops every pending reason at once: a resync re-rides
 * `state/full` and can restructure the whole set, so a message about a path
 * that may no longer mean the same thing is exactly what should not survive
 * it. Same contract `clipSampleService`, `playingClipsStore` and
 * `sceneWindowStore` follow.
 */

/** Long enough to read, short enough that the next glance shows the name. */
export const SWAP_ERROR_TTL_MS = 6_000;

const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; clear: () => void }>();

/**
 * Show this key's error for `ttlMs`, then run `clear`. A second call for the
 * same key replaces the first (its clear never runs, because the newer error
 * is the one on screen).
 */
export function holdSwapError(key: string, clear: () => void, ttlMs: number = SWAP_ERROR_TTL_MS): void {
	dropSwapError(key);
	const timer = setTimeout(() => {
		pending.delete(key);
		clear();
	}, ttlMs);
	// A harness that runs fake timers in Node must not be kept alive by this.
	if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref: () => void }).unref();
	pending.set(key, { timer, clear });
}

/**
 * Cancel a pending clear without running it — the key has moved on under its
 * own steam (a new step started, or the state was replaced).
 */
export function dropSwapError(key: string): void {
	const held = pending.get(key);
	if (!held) return;
	clearTimeout(held.timer);
	pending.delete(key);
}

/** Clear every held error NOW, running each store's own closure. */
export function flushSwapErrors(): void {
	const held = [...pending.values()];
	pending.clear();
	for (const h of held) {
		clearTimeout(h.timer);
		h.clear();
	}
}

if (typeof window !== 'undefined') {
	window.addEventListener('bridge-resync', () => flushSwapErrors());
}
