/**
 * v3DeviceAppointed — where Live's blue hand is.
 *
 * Surf → /looping/v3/device/appointed  [devicePath:string]
 *
 * Live's appointed device, the one a controller following "the selected
 * device" controls, wherever it moves: a tap here, a click in Live, a
 * controller's own move. `""` when there is none, or it sits somewhere the
 * wire has no path for. Seeded on every handshake accept. Lands on
 * `fxChainStore` as the device the hand is on, without sending anything
 * back — the chain overview marks it, and a tile gesture re-appoints only
 * when the hand is somewhere else.
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import { toString } from './oscTypeHelpers';
import { fxChainStore } from '$lib/stores/v6/fxChainStore.svelte';

export const V3_DEVICE_APPOINTED_ADDRESS = '/looping/v3/device/appointed';

export function isV3DeviceAppointedAddress(address: string): boolean {
	return address === V3_DEVICE_APPOINTED_ADDRESS;
}

export function handleV3DeviceAppointed(address: string, args: OSCArg[]): void {
	if (args.length < 1) {
		logger.warn('v3 device/appointed: empty payload', { address });
		return;
	}
	const path = toString(args[0]);
	fxChainStore.observeAppointed(path === '' ? null : path);
}
