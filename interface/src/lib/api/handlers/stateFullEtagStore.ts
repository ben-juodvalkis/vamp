/**
 * Held-ETag store — what tree this client currently has.
 *
 * Protocol 3.5.0. The surface used to decide whether to re-ship the
 * tree from what *it* last sent, which is the wrong question on a
 * reconnect (this client may have dropped state) and wrong again with
 * two UIs connected (a Mac and an iPad hold independently-aged trees,
 * and one client's history cannot answer the other's question).
 *
 * So the client declares what it holds. This module is that memory:
 * the checksum of the last bundle successfully applied, per scope.
 * `sendHandshakeHello` and `sendStateResync` read it; if the surface
 * recomputes the same value it answers with a small
 * `state/full/unchanged` marker instead of the whole tree.
 *
 * Missing beats wrong: an entry only ever means "the last bundle I
 * applied for this scope hashed to X". It is recorded after the apply,
 * never before, so a bundle that failed its checksum or failed to
 * parse leaves no entry — and a client with no entry gets the full
 * tree, which is always correct if slower.
 *
 * Bounded, because scope keys are track paths (`tracks/<N>`,
 * `master`) and a long session that adds and deletes tracks keeps
 * minting them. Eviction only costs a full send next time; the store
 * is an optimisation, never a source of truth.
 *
 * Deliberately in memory only. Persisting across reloads would let a
 * client claim a tree it no longer has in its store, which is exactly
 * the failure the ETag exists to prevent.
 */

import { logger } from '$lib/utils/logger';

/** Key for the whole-song bundle, which has no scope on the wire. */
const WHOLE_SONG_KEY = ' whole-song';

/**
 * Max scopes retained. A real set is a few dozen tracks and only the
 * selected one gets scoped bundles, so this is generous; the cap
 * exists to bound a long session's churn, not to ration normal use.
 */
export const MAX_HELD_ETAGS = 32;

/** Prefix that namespaces an ETag inside a variadic argument list. */
export const ETAG_PREFIX = 'etag:';

/**
 * Insertion-ordered, oldest evicted first. A `Map` preserves insertion
 * order, and re-inserting on read is all the recency tracking an LRU
 * of this size needs.
 */
const heldEtags = new Map<string, string>();

function keyFor(scope: string | null | undefined): string {
	return scope === null || scope === undefined ? WHOLE_SONG_KEY : scope;
}

/** Format a checksum the way the wire carries it. */
export function formatEtag(checksum: number): string {
	// The unsigned shift keeps a value that arrived as a signed int32
	// from rendering with a minus sign, which would never match the
	// surface's `"0x%08x"`.
	const unsigned = checksum >>> 0;
	return `0x${unsigned.toString(16).padStart(8, '0')}`;
}

/**
 * Record the checksum of a bundle this client has actually applied.
 *
 * Call **after** the store is updated, never before — see the module
 * docstring on why a failed apply must leave no entry.
 */
export function recordAppliedEtag(
	scope: string | null | undefined,
	checksum: number
): void {
	const key = keyFor(scope);
	// Delete-then-set so re-recording refreshes recency rather than
	// leaving the entry at its original insertion position.
	heldEtags.delete(key);
	heldEtags.set(key, formatEtag(checksum));

	while (heldEtags.size > MAX_HELD_ETAGS) {
		const oldest = heldEtags.keys().next();
		if (oldest.done) break;
		heldEtags.delete(oldest.value);
	}
}

/**
 * The ETag this client holds for `scope`, or `null` if it holds none.
 *
 * `null` is the honest answer for a cold start and must produce a full
 * send — callers should omit the declaration entirely rather than
 * inventing a value.
 */
export function getHeldEtag(scope: string | null = null): string | null {
	const key = keyFor(scope);
	const value = heldEtags.get(key);
	if (value === undefined) return null;
	// Touch for recency.
	heldEtags.delete(key);
	heldEtags.set(key, value);
	return value;
}

/** The wire token for `scope`, or `null` if nothing is held. */
export function heldEtagToken(scope: string | null = null): string | null {
	const etag = getHeldEtag(scope);
	return etag === null ? null : `${ETAG_PREFIX}${etag}`;
}

/**
 * Forget everything.
 *
 * Called on surface restart and on tree reset: a client that just
 * dropped its tree must not go on claiming to hold it, or the surface
 * will answer "unchanged" and leave the UI permanently empty. This is
 * the one way this module can cause real damage, so every call site
 * that clears the tree must clear this too.
 */
export function clearHeldEtags(): void {
	if (heldEtags.size > 0) {
		logger.debug('v3 ETag store cleared', { held: heldEtags.size });
	}
	heldEtags.clear();
}

/** Diagnostics and tests. */
export function heldEtagCount(): number {
	return heldEtags.size;
}
