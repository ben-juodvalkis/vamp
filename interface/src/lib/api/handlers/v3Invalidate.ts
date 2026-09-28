/**
 * V3 Invalidate Handler — Phase 2 PR-2a.
 *
 * Consumes `/looping/v3/state/invalidate` per
 * [04 §3.3](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#33-targeted-invalidation-new).
 *
 * ## Wire shape
 *
 * ```
 * /looping/v3/state/invalidate  [generation:int, reason:string, ...paths:string]
 * ```
 *
 * The surface has observed a structural change and already advanced
 * generation to `generation`. `paths` is a variadic tail listing the
 * subtrees that are now dead. The UI should:
 *
 * 1. Update its generation mirror to `generation`.
 * 2. Drop any store entry rooted at each listed path.
 *
 * Compared to the full-tree republish (`state/full`), this path is
 * bandwidth-cheap when only one subtree moved. A single device
 * reorder on one track emits one invalidate with a handful of paths
 * rather than a full re-walk of the LOM. The surface may always
 * choose to emit `state/full` instead; the correctness contract is
 * just that generation advanced.
 *
 * ## Ordering guarantee
 *
 * Per [04 §3.3] and [03 §7.2]: a `state/invalidate` always precedes
 * any `param/value` emission against the post-invalidation tree. That
 * means the UI's normalized store will see the dead paths removed
 * before any new echo tries to land. No defensive "apply echo before
 * it exists" branch is needed — the store's `applyParamValue` already
 * drops on missing path as a belt-and-braces measure.
 *
 * ## PR-2a scope
 *
 * Handler exported, not wired. simpleClient dispatch is PR-2b's job.
 *
 * @see Looping's documentation/archive/m4l-to-python-v3/04-wire-protocol.md §3.3
 */

import { logger } from '$lib/utils/logger';
import { toNumber, toString } from './oscTypeHelpers';
import { invalidatePaths } from '$lib/stores/v3/normalized.svelte';
import { releaseUnderPath } from '$lib/stores/v3/propertySubscriptions.svelte';
import type { OSCArg } from '$lib/types/osc';

export const V3_STATE_INVALIDATE_ADDRESS = '/looping/v3/state/invalidate';

/**
 * Handle an inbound `/looping/v3/state/invalidate`.
 *
 * Args: `[generation:int, reason:string, path_0:string, ..., path_N:string]`.
 *
 * Short args (missing generation or reason) is a surface-side bug;
 * log and drop rather than partially apply. An empty path list is
 * valid — it just carries a generation bump with no subtree change
 * (rare, but e.g. a bookkeeping-only advance could legitimately emit
 * one).
 */
export function handleV3StateInvalidate(args: OSCArg[]): void {
	if (args.length < 2) {
		logger.warn('v3 state/invalidate: short payload', { length: args.length });
		return;
	}
	const generation = toNumber(args[0]);
	const reason = toString(args[1]);

	if (!Number.isFinite(generation) || generation < 1) {
		logger.warn('v3 state/invalidate: invalid generation', { generation });
		return;
	}

	const paths: string[] = [];
	for (let i = 2; i < args.length; i++) {
		const p = toString(args[i]);
		if (p) paths.push(p);
	}

	const removed = invalidatePaths(generation, paths);

	// PR-3.5.7-impl: drop any property subscriptions whose devicePath
	// lives at or under each invalidated path. The surface tore down
	// the listeners on its side per [04 §3.5] before emitting the
	// invalidate, so this is bookkeeping-only — no unsubscribe wires.
	let propertyDropped = 0;
	for (const path of paths) {
		propertyDropped += releaseUnderPath(path);
	}

	logger.info('v3 state/invalidate applied', {
		generation,
		reason,
		pathCount: paths.length,
		removed,
		propertyDropped
	});
}
