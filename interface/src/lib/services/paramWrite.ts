/**
 * paramWrite.ts — the one sender of `/looping/v3/param/set`.
 *
 * Every parameter write goes through `writeParam` (re-exported from
 * `services/deviceParams.ts`, the module components import): the FX
 * controls through `selectedTrackStore.setParamValue`, the FX grid's
 * landing-device seed, the sequencer's step and reset writes. One guard,
 * one echo policy:
 *
 * - **No generation yet, no write.** Before the first `state/full` the
 *   store's generation is `UNSET_GENERATION` (0) and the surface would
 *   refuse the path anyway; the write is dropped and the next state/full
 *   reconciles.
 * - **`arm`** (default on) records the value in `paramArming`, so an echo
 *   or state/full that disagrees during the round trip does not snap the
 *   control back; the confirming echo (or the arm's TTL) releases it. See
 *   the note in `writeParam` on how the optimistic apply interacts.
 * - **`optimistic`** (default on) applies the value to the v3 store at
 *   once. Off only where the record is not yet in the store (a device the
 *   new-device hook is seeding, which supplies its own value).
 *
 * A leaf module on purpose: the stores that write params import it, and
 * `deviceParams.ts` imports those stores, so the writer itself must not
 * import back (an import cycle here once read `selectedTrackStore` before
 * it was initialized and failed every page load, 2026-09-30).
 */

import { send } from '$lib/api/simpleClient';
import { v3Store, UNSET_GENERATION, applyParamValue } from '$lib/stores/v3/normalized.svelte';
import { armParam } from '$lib/stores/v3/paramArming.svelte';
import { logger } from '$lib/utils/logger';

export const PARAM_SET_ADDRESS = '/looping/v3/param/set';

export interface WriteParamOptions {
	/** Apply to the v3 store before the echo (default true). */
	optimistic?: boolean;
	/** Arm the value against disagreeing echoes (default true). */
	arm?: boolean;
}

/** The store's generation, or null while none has been accepted. */
export function acceptedGeneration(): number | null {
	const generation = v3Store.generation;
	return generation === UNSET_GENERATION ? null : generation;
}

/** Write one parameter. Returns false when dropped for want of a generation. */
export function writeParam(paramPath: string, value: number, options: WriteParamOptions = {}): boolean {
	const generation = acceptedGeneration();
	if (generation === null) {
		logger.debug('param/set dropped — v3 generation still UNSET', { paramPath });
		return false;
	}
	const { optimistic = true, arm = true } = options;
	// Arm, then apply — the order every writer has used. Note what it does
	// when the record is in the store: the optimistic apply goes through
	// the echo reconciler, matches the arm and clears it, so the arm only
	// outlives the write when the apply cannot land (`optimistic: false`,
	// or a record not yet in the store). Making it survive would change how
	// every control treats echoes during a drag; that is a decision of its
	// own, not this module's.
	if (arm) armParam(paramPath, value);
	if (optimistic) applyParamValue(paramPath, value);
	send(PARAM_SET_ADDRESS, [paramPath, value, generation]);
	return true;
}
