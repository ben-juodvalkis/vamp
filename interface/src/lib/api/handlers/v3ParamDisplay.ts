/**
 * V3 Param Display handler.
 *
 * Consumes `/looping/v3/param/display`:
 *
 * ```
 * /looping/v3/param/display  [path:string, displayValue:string]
 * ```
 *
 * Surface emits this *only while a path is "hot"* — meaning the UI has
 * sent a `param/set` for it within the last `HOT_TTL_SEC`. The string
 * is Live's GUI-formatted value ("440 Hz", "-12.0 dB", "1/4", "On"),
 * computed via `str(parameter)` on the surface side. The UI cannot
 * compute these locally because the format curves (Hz log, dB log,
 * time-with-tempo-sync) are baked into Live's C code and not exposed.
 *
 * Drop-on-missing follows the same discipline as `param/value`: a path
 * that doesn't resolve in the store is silently dropped (race window
 * between structural invalidation and the next state/full).
 */

import { logger } from '$lib/utils/logger';
import { toString } from './oscTypeHelpers';
import { applyParamDisplay } from '$lib/stores/v3/normalized.svelte';
import type { OSCArg } from '$lib/types/osc';

export const V3_PARAM_DISPLAY_ADDRESS = '/looping/v3/param/display';

export function handleV3ParamDisplay(args: OSCArg[]): void {
	if (args.length < 2) {
		logger.warn('v3 param/display: short payload', { length: args.length });
		return;
	}
	const path = toString(args[0]);
	const displayValue = toString(args[1]);
	if (!path) {
		logger.warn('v3 param/display: empty path', { raw: args[0] });
		return;
	}

	const applied = applyParamDisplay(path, displayValue);
	if (!applied) {
		logger.debug('v3 param/display: path not in store, dropped', { path });
	} else {
		logger.debug('v3 param/display: applied', { path, displayValue });
	}
}
