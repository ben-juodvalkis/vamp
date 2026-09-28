/**
 * Simpler Actions Service
 *
 * Side-effect methods on `SimplerDevice` that have no LOM property
 * surface — verified at runtime via `/looping/probe/lom_invoke` against
 * a live Simpler:
 *
 *   reverse()      flips the loaded sample in place (symmetric)
 *   warp_half()    halves the warped tempo; requires sample.warping=true
 *   warp_double()  doubles the warped tempo; requires sample.warping=true
 *
 * Surface-side gate (DeviceCommandsComponent) checks
 * `device.class_name == 'OriginalSimpler'` and surfaces typed errors on
 * `/looping/v3/error`. The UI hides ½×/2× when warping is off, so the
 * "warping required" failure mode shouldn't be reachable from the GUI.
 *
 * Fire-and-forget — `send()` is synchronous and these endpoints have no
 * client-side ack, so wrapping them in async/try-catch would catch
 * nothing. Errors surface via the `/looping/v3/error` bus, handled by
 * the v3Error handler.
 */

import { send } from '$lib/api/simpleClient';

const V3_SIMPLER_REVERSE_ADDRESS = '/looping/v3/simpler/reverse';
const V3_SIMPLER_WARP_HALF_ADDRESS = '/looping/v3/simpler/warp_half';
const V3_SIMPLER_WARP_DOUBLE_ADDRESS = '/looping/v3/simpler/warp_double';

export function simplerReverse(devicePath: string): void {
	send(V3_SIMPLER_REVERSE_ADDRESS, [devicePath]);
}

export function simplerWarpHalf(devicePath: string): void {
	send(V3_SIMPLER_WARP_HALF_ADDRESS, [devicePath]);
}

export function simplerWarpDouble(devicePath: string): void {
	send(V3_SIMPLER_WARP_DOUBLE_ADDRESS, [devicePath]);
}
