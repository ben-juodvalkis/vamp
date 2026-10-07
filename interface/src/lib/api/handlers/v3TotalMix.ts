/**
 * TotalMix monitor-level handler.
 *
 * Consumes `/looping/v3/totalmix/<channel>` fires from the bridge, which
 * owns the UDP link to the RME mixer and filters its state dump down to
 * these five channels (ADR-423), and writes them into the TotalMix store.
 *
 * Values are **dB**, the unit the whole path speaks. Writes go back out
 * on `/totalmix/<channel>`; `main` is read-only.
 *
 * Wire:
 *   /looping/v3/totalmix/<channel>  [db:float]
 *   <channel> ∈ { room, playback, click, phones, main }
 *
 * Mirrors `v3Meter.ts` — same parse/guard shape, same store-write idiom.
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import { applyTotalMix, applyTotalMixMeters } from '$lib/stores/v3/totalmix.svelte';

const V3_TOTALMIX_PREFIX = '/looping/v3/totalmix/';

/** The five live signal meters as one frame, in channel order (dB). */
export const V3_TOTALMIX_METERS_ADDRESS = '/looping/v3/totalmix_meters';

export function handleV3TotalMixMeters(args: OSCArg[]): void {
	const frame = args.map(toNumber);
	if (frame.some((db) => db === null)) {
		logger.warn('v3 totalmix meters non-numeric frame', { args });
		return;
	}
	applyTotalMixMeters(frame as number[]);
}

export function isV3TotalMixAddress(address: string): boolean {
	return address.startsWith(V3_TOTALMIX_PREFIX);
}

export function handleV3TotalMix(address: string, args: OSCArg[]): void {
	const channel = address.slice(V3_TOTALMIX_PREFIX.length);
	if (!channel) {
		logger.warn('v3 totalmix missing channel', { address });
		return;
	}
	const db = toNumber(args[0]);
	if (db === null) {
		logger.warn('v3 totalmix non-numeric level', { channel, args });
		return;
	}
	applyTotalMix(channel, db);
}

function toNumber(v: OSCArg): number | null {
	if (typeof v === 'number') return v;
	if (typeof v === 'string') {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}
