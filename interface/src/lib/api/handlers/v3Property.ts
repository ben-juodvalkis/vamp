/**
 * V3 Property Value handler — PR-3.5.7.
 *
 * Consumes `/looping/v3/property/value` per
 * [04 §3.5](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#35-device-property-operations).
 *
 * ```
 * /looping/v3/property/value  [devicePath:string, propertyName:string, value:any]
 * ```
 *
 * Lands both the cold-read echo (response to subscribe) and the
 * listener-fire echo (response to LOM change). Same handler for both;
 * the surface side doesn't distinguish on the wire.
 *
 * ## Drop-on-missing
 *
 * `applyPropertyValue` no-ops when the devicePath isn't in the v3
 * tree — expected during the race window between a structural change
 * and the next state/full landing. Per [04 §3.5] "no cross-address
 * ordering" notes, the UI drops these the same way it drops
 * `param/value` for dead paths.
 *
 * ## Why no type narrowing
 *
 * Property values carry whatever OSC type Live exposes (int for
 * `playback_mode`, float for `sample.gain`, int-coerced bool for
 * `sample.warping`). We pass the raw OSCArg through to the store
 * leaf; component-side readers cast to the expected type. Mirrors
 * `ClipRecord.properties` which has the same shape.
 */

import { logger } from '$lib/utils/logger';
import { toString } from './oscTypeHelpers';
import { applyPropertyValue } from '$lib/stores/v3/normalized.svelte';
import type { OSCArg } from '$lib/types/osc';

export const V3_PROPERTY_VALUE_ADDRESS = '/looping/v3/property/value';

/**
 * Listener fired for every `/looping/v3/property/value` echo —
 * post-store-apply so observers can react to the same canonical
 * value the rest of the app sees. Side channel for one-shot
 * orchestrators (e.g. clipOperations' auto-trim flow waits for the
 * `sample.file_path` echo to confirm a sample loaded). Don't use it
 * for steady-state UI binding — go through the store / `$derived`
 * for that path.
 */
export type PropertyValueWatcher = (
	devicePath: string,
	propertyName: string,
	value: OSCArg
) => void;

const watchers = new Set<PropertyValueWatcher>();

/**
 * Register a watcher; returns a release callback.
 */
export function addPropertyValueWatcher(fn: PropertyValueWatcher): () => void {
	watchers.add(fn);
	return () => {
		watchers.delete(fn);
	};
}

/**
 * Handle `/looping/v3/property/value [devicePath, propertyName, value]`.
 *
 * Short payload or non-string keys are surface-side bugs; log and
 * drop. The value rides through unchanged — type coercion belongs in
 * the consuming component.
 */
export function handleV3PropertyValue(args: OSCArg[]): void {
	if (args.length < 3) {
		logger.warn('v3 property/value: short payload', { length: args.length });
		return;
	}
	const devicePath = toString(args[0]);
	const propertyName = toString(args[1]);
	const value = args[2];
	if (!devicePath) {
		logger.warn('v3 property/value: empty devicePath', { raw: args[0] });
		return;
	}
	if (!propertyName) {
		logger.warn('v3 property/value: empty propertyName', { raw: args[1] });
		return;
	}

	const applied = applyPropertyValue(devicePath, propertyName, value);
	if (!applied) {
		// Documented drop-on-missing branch: the device went away
		// between the listener fire and the echo arrival. The
		// subscription manager's `releaseAll(devicePath)` from the
		// invalidate handler dropped the refcount; the device record
		// is gone from the store. Log at debug for diagnostics.
		logger.debug('v3 property/value: device not in store, dropped', {
			devicePath,
			propertyName
		});
	}

	// Side-channel watchers run AFTER the store apply so observers see
	// store-consistent state. A throwing watcher is logged and skipped
	// — it can't poison the next watcher in the iteration.
	for (const watcher of watchers) {
		try {
			watcher(devicePath, propertyName, value);
		} catch (e) {
			logger.warn('v3 property/value: watcher threw', {
				devicePath,
				propertyName,
				error: String(e)
			});
		}
	}
}
