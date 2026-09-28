/**
 * V3 Param Value handler — Phase 2 PR-2b.
 *
 * Consumes `/looping/v3/param/value` per
 * [04 wire-protocol §6](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md):
 *
 * ```
 * /looping/v3/param/value  [path:string, value:float]
 * ```
 *
 * Both the listener fire path (surface-driven, Live-originated) and
 * the param-query reply path (UI-requested probe) land here.
 *
 * ## Drop-on-missing
 *
 * Echoes that arrive for paths the UI hasn't seen yet are silently
 * dropped by `applyParamValue` — expected during the race window
 * between a structural change and the next state/full landing. Per
 * [04 §3.3] the surface guarantees `state/invalidate` precedes any
 * `param/value` against a changed tree, so this drop branch only
 * fires at cold-start before the first state/full, when there's no
 * store entry to update anyway.
 */

import { logger } from '$lib/utils/logger';
import { toNumber, toString } from './oscTypeHelpers';
import { applyParamValue } from '$lib/stores/v3/normalized.svelte';
import type { OSCArg } from '$lib/types/osc';

export const V3_PARAM_VALUE_ADDRESS = '/looping/v3/param/value';

/**
 * Handle `/looping/v3/param/value [path, value]`.
 *
 * Short payload or non-string path is a surface-side bug; log and
 * drop. Value is coerced via `toNumber` — a non-numeric value would
 * itself be a surface bug but `applyParamValue` guards against NaN
 * by silently no-opping (float NaN writes to `param.value` would
 * poison $derived consumers).
 */
export function handleV3ParamValue(args: OSCArg[]): void {
	if (args.length < 2) {
		logger.warn('v3 param/value: short payload', { length: args.length });
		return;
	}
	const path = toString(args[0]);
	const value = toNumber(args[1]);
	if (!path) {
		logger.warn('v3 param/value: empty path', { raw: args[0] });
		return;
	}
	if (!Number.isFinite(value)) {
		logger.warn('v3 param/value: non-finite value', { path, raw: args[1] });
		return;
	}

	const applied = applyParamValue(path, value);
	if (!applied) {
		// Don't warn — this is the documented drop-on-missing branch,
		// expected during cold-start and during structural-change races.
		logger.debug('v3 param/value: path not in store, dropped', { path });
	} else {
		logger.debug('v3 param/value: applied', { path, value });
	}
}
