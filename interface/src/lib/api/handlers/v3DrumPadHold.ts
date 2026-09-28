/**
 * v3DrumPadHold — a Drum Rack pad held on the Move (ADR-432).
 *
 * Surf → /looping/v3/drum/pad_hold  [rackPath:string, note:int, held:0|1]
 *
 * The Max Utility patch times a Move pad held past its threshold and
 * tells the surface; the surface names the pad Live selected — the pad
 * struck — on the selected track's Drum Rack, and this is what it
 * sends. It lands on the pad scope as an EXTERNAL hold: the
 * same store a finger on a pad tile writes, so the FX grid, the Drum
 * Rack view's controls and the pad grid all treat the pad exactly as a
 * held tile — and never as a latch, which is a tap on the glass.
 *
 * Telemetry-shaped: nothing is acknowledged and nothing is written to
 * Live. A malformed message is logged and dropped.
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import { toNumber, toString } from './oscTypeHelpers';
import { drumPadScope } from '$lib/stores/v6/drumPadScope.svelte';
import { onHandshakeAccepted } from './v3Handshake';

export const V3_DRUM_PAD_HOLD_ADDRESS = '/looping/v3/drum/pad_hold';

/** The shape the surface composes a rack's path in: `tracks/<N>/devices/<M>` or `master/devices/<M>`. */
const RACK_PATH = /^(?:tracks\/(?:0|[1-9]\d*)|master)\/devices\/(?:0|[1-9]\d*)$/;

// A fresh session drops every Move pad hold. The surface that announced
// them may have restarted and forgotten them, and a release that fell in
// a reconnect gap would otherwise leave a scope no gesture on the glass
// can clear. Fingers and latches stay. Registered here rather than in
// the handshake module, which must not import a store (see there).
onHandshakeAccepted(() => drumPadScope.releaseExternalHolds());

export function isV3DrumPadHoldAddress(address: string): boolean {
	return address === V3_DRUM_PAD_HOLD_ADDRESS;
}

export function handleV3DrumPadHold(address: string, args: OSCArg[]): void {
	if (args.length < 3) {
		logger.warn('v3 drum/pad_hold: short payload', { address, length: args.length });
		return;
	}
	const rackPath = toString(args[0]);
	const note = toNumber(args[1]);
	const held = toNumber(args[2]);
	// A device path on a track or the master, and nothing else: a hold on
	// a path no rack can sit at would live in the scope store until the
	// next handshake with nothing able to scope through it.
	if (!RACK_PATH.test(rackPath)) {
		logger.warn('v3 drum/pad_hold: not a device path', { rackPath });
		return;
	}
	if (!Number.isInteger(note) || note < 0 || note > 127) {
		logger.warn('v3 drum/pad_hold: bad note', { rackPath, note });
		return;
	}
	if (held !== 0 && held !== 1) {
		logger.warn('v3 drum/pad_hold: bad held flag', { rackPath, note, held });
		return;
	}
	if (held === 1) drumPadScope.pressExternal(rackPath, note);
	else drumPadScope.releaseExternal(rackPath, note);
}
