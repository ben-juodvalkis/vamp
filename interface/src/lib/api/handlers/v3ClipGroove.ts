/**
 * v3 Clip Groove handler (PR-5e2)
 *
 * Consumes the two inbound wire addresses owned by the Python Control
 * Surface's `GrooveComponent`:
 *
 *   Surf → UI   /looping/v3/clip/groove/has_groove   [clipPath, bool]
 *   Surf → UI   /looping/v3/clip/groove/property     [clipPath, name, value]
 *
 * `has_groove` flips the scalar `clipGrooveStore.hasGroove` so the UI
 * can distinguish "no groove assigned yet" from "groove at 0". `property`
 * routes `base`/`timing_amount`/`quantization_amount`/`random_amount`/
 * `velocity_amount` into the scalar store.
 *
 * Both addresses are gated by `session.focusedClipPath` — the Python
 * surface's 5 amount listeners are focus-scoped, but a listener firing
 * in flight can still arrive after the UI has advanced focus. See
 * [04-wire-protocol.md §3.6] for the full contract.
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import { session } from '$lib/stores/session.svelte';
import { clipGrooveStore } from '$lib/stores/v6/clipGrooveStore.svelte';
import { toNumber, toString } from './oscTypeHelpers';

export const V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS = '/looping/v3/clip/groove/has_groove';
export const V3_CLIP_GROOVE_PROPERTY_ADDRESS = '/looping/v3/clip/groove/property';

// Write addresses (UI → Surf). Re-exported so senders don't rebuild string literals.
export const V3_CLIP_GROOVE_SET_BASE_ADDRESS = '/looping/v3/clip/groove/set/base';
export const V3_CLIP_GROOVE_SET_TIMING_AMOUNT_ADDRESS =
	'/looping/v3/clip/groove/set/timing_amount';
export const V3_CLIP_GROOVE_SET_QUANTIZATION_AMOUNT_ADDRESS =
	'/looping/v3/clip/groove/set/quantization_amount';
export const V3_CLIP_GROOVE_SET_RANDOM_AMOUNT_ADDRESS =
	'/looping/v3/clip/groove/set/random_amount';
export const V3_CLIP_GROOVE_SET_VELOCITY_AMOUNT_ADDRESS =
	'/looping/v3/clip/groove/set/velocity_amount';

export function isV3ClipGrooveAddress(address: string): boolean {
	return (
		address === V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS ||
		address === V3_CLIP_GROOVE_PROPERTY_ADDRESS
	);
}

export function handleV3ClipGroove(address: string, args: OSCArg[]): void {
	if (address === V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS) {
		// args: [clipPath, bool]
		if (args.length < 2) {
			logger.warn('v3 clip/groove/has_groove wrong arity', { args });
			return;
		}
		const clipPath = toString(args[0]);
		if (clipPath !== session.focusedClipPath) {
			return;
		}
		const value = args[1];
		const hasGroove = value === true || value === 1 || value === '1';
		clipGrooveStore.handleHasGroove(hasGroove);
		return;
	}

	if (address === V3_CLIP_GROOVE_PROPERTY_ADDRESS) {
		// args: [clipPath, name, value]
		if (args.length < 3) {
			logger.warn('v3 clip/groove/property wrong arity', { args });
			return;
		}
		const clipPath = toString(args[0]);
		const name = toString(args[1]);
		const value = toNumber(args[2]);

		if (clipPath !== session.focusedClipPath) {
			return;
		}

		clipGrooveStore.handleGrooveProperty(name, value);
	}
}
