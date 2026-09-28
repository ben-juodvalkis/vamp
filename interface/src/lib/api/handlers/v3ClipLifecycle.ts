/**
 * `/looping/v3/clip/created` + `/looping/v3/clip/removed` — the surface's
 * per-slot `has_clip` listener reaching the UI at last.
 *
 * Both addresses have been on the wire since PR-7b (`ClipsComponent`
 * attaches one `has_clip` listener per slot and emits here on every
 * flip), but nothing on this side consumed them. The only other signal
 * a clip change produced was a `state/invalidate` carrying a generation
 * and a reason and NO paths — and a path-less invalidate drops nothing
 * from the normalized store by design. So adding or deleting a clip in
 * Live left the session grid painting whatever the last `state/full`
 * said: a deleted clip stayed on screen, a new one never showed up.
 *
 * What lands here is a slotPath and a generation, which is enough to be
 * right about *whether* a slot holds a clip — the thing the grid reads
 * at a glance — but not about what it is called or how long it is (the
 * C record, which only a `state/full` carries). So:
 *
 *   1. apply the has/has-not change locally, immediately, and
 *   2. ask for one `state/resync` to fill in the details.
 *
 * The resync is DEBOUNCED because these fires arrive in bursts: a scene
 * duplicate or a multi-clip delete flips every slot it touches, and one
 * state/full at the end of the burst is the whole point of the surface's
 * generation-coalescing model. It is also why step 1 is not simply "ask
 * for a resync": the round trip is a set-sized payload, and a grid that
 * only updates when it lands feels broken on the gesture that caused it.
 *
 * The cached sample for a removed clip is dropped here too — the service
 * caches by clipPath, and a slot that gets a new recording reuses the
 * path its last take had.
 */

import { logger } from '$lib/utils/logger';
import type { OSCArg } from '$lib/types/osc';
import { applyClipLifecycle } from '$lib/stores/v3/normalized.svelte';
import { invalidateSample } from '$lib/services/clipSampleService';
import { sendStateResync } from './v3Handshake';

export const V3_CLIP_CREATED_ADDRESS = '/looping/v3/clip/created';
export const V3_CLIP_REMOVED_ADDRESS = '/looping/v3/clip/removed';

/**
 * Quiet window before the reconciling resync. Long enough that a scene
 * duplicate's burst of fires costs one state/full rather than one per
 * slot, short enough that a single clip's real name appears while you
 * are still looking at the cell you just made.
 */
const RESYNC_DEBOUNCE_MS = 300;

let resyncTimer: ReturnType<typeof setTimeout> | undefined;

export function isV3ClipLifecycleAddress(address: string): boolean {
	return address === V3_CLIP_CREATED_ADDRESS || address === V3_CLIP_REMOVED_ADDRESS;
}

/** Test seam: drop any pending resync so a suite can't leak one. */
export function _cancelPendingResync(): void {
	if (resyncTimer !== undefined) {
		clearTimeout(resyncTimer);
		resyncTimer = undefined;
	}
}

function scheduleResync(): void {
	if (resyncTimer !== undefined) clearTimeout(resyncTimer);
	resyncTimer = setTimeout(() => {
		resyncTimer = undefined;
		sendStateResync();
	}, RESYNC_DEBOUNCE_MS);
}

/**
 * Handle `/looping/v3/clip/created [slotPath, generation]` and
 * `/looping/v3/clip/removed [slotPath, generation]`.
 *
 * The generation is informational here: the surface has already
 * advanced it and emitted the matching `state/invalidate`, which is
 * what moves the UI's mirror. A malformed or short payload is a
 * surface-side bug — log and drop rather than half-apply.
 */
export function handleV3ClipLifecycle(address: string, args: OSCArg[]): void {
	const created = address === V3_CLIP_CREATED_ADDRESS;
	const slotPath = typeof args[0] === 'string' ? args[0] : '';
	if (!slotPath) {
		logger.warn('v3 clip lifecycle: missing slotPath', { address });
		return;
	}

	const applied = applyClipLifecycle(slotPath, created);

	if (!created) {
		invalidateSample(`${slotPath}/clip`);
	}

	// Resync even when the local apply was a no-op: "already knew" can
	// mean the C record is stale rather than that nothing changed.
	scheduleResync();

	logger.info('v3 clip lifecycle applied', { address, slotPath, applied });
}
