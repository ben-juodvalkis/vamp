/**
 * V3 Simpler-replaced ack handler — 2026-09-17.
 *
 * ```
 * /looping/v3/simpler/replaced  [originAddress:string, devicePath:string, filePath:string]
 * ```
 *
 * Emitted by the surface's `SimplerLoadComponent` once a sample is on
 * the Simpler and its post-load defaults (Loop on, slicing mode,
 * normalization) are written. `originAddress` is the gesture that
 * produced it — `/looping/v3/simpler/replace_sample` for the clip-view
 * convert, `…/replace_sample_onto_track` for the capture flow — stamped
 * first for symmetry with the `/looping/v3/error` envelope.
 *
 * ## Why this address exists
 *
 * Success used to be silent on the wire, so the UI inferred both halves
 * (which device, which file) by watching `sample.file_path` property
 * echoes and accepting the first one from a devicePath that hadn't
 * existed when the gesture started. Two ways that failed: the echo only
 * happens if something on screen is subscribed to that Simpler, and the
 * convert flow's adjacent track insert shifts existing devices into the
 * path the new Simpler lands on, so the "didn't exist before" test threw
 * away the very echo it was waiting for. The ack hands over both halves
 * directly — see `clipOperations.armAutoStartMarker`.
 *
 * Pure side channel: nothing here touches the v3 store. The new track
 * and its device arrive through `state/full` as they always did.
 */

import { logger } from '$lib/utils/logger';
import { toString } from './oscTypeHelpers';
import type { OSCArg } from '$lib/types/osc';

export const V3_SIMPLER_REPLACED_ADDRESS = '/looping/v3/simpler/replaced';

export interface SimplerReplacedAck {
	/** The wire address of the gesture that loaded the sample. */
	originAddress: string;
	/** `tracks/<N>/devices/<M>` of the Simpler that received it. */
	devicePath: string;
	/** Absolute filesystem path of the sample now on that Simpler. */
	filePath: string;
}

export type SimplerReplacedWatcher = (ack: SimplerReplacedAck) => void;

const watchers = new Set<SimplerReplacedWatcher>();

/**
 * Register a watcher; returns a release callback. Mirrors
 * `addPropertyValueWatcher` — one-shot orchestrators only, not
 * steady-state UI binding.
 */
export function addSimplerReplacedWatcher(fn: SimplerReplacedWatcher): () => void {
	watchers.add(fn);
	return () => {
		watchers.delete(fn);
	};
}

export function handleV3SimplerReplaced(args: OSCArg[]): void {
	if (args.length < 3) {
		logger.warn('v3 simpler/replaced: short payload', { length: args.length });
		return;
	}
	const ack: SimplerReplacedAck = {
		originAddress: toString(args[0]),
		devicePath: toString(args[1]),
		filePath: toString(args[2])
	};
	if (!ack.devicePath || !ack.filePath) {
		logger.warn('v3 simpler/replaced: empty devicePath or filePath', { ack });
		return;
	}
	logger.debug('v3 simpler/replaced', ack);
	for (const watcher of watchers) {
		try {
			watcher(ack);
		} catch (e) {
			logger.warn('v3 simpler/replaced: watcher threw', {
				devicePath: ack.devicePath,
				error: String(e)
			});
		}
	}
}
