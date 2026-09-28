/**
 * PR-5c — v3 output meter handler.
 *
 * Consumes `/looping/v3/track/meter` and `/looping/v3/master/meter`
 * fires from `MetersComponent` (Python surface) and writes them into
 * the v3 meter store. Meter consumers (TrackVolumeMeter, MasterTrack,
 * SelectedTrackMeter, MeterVisualizationV6) read via `$derived` off
 * `meterStore.get(path)` — no CustomEvent re-dispatch.
 *
 * Wire (see Looping's documentation/archive/m4l-to-python-v3/04-wire-protocol.md
 * and phase-5-pr5c-meters-design.md §3.2):
 *   /looping/v3/track/meter  [trackPath:string, left:float, right:float]
 *   /looping/v3/master/meter [left:float, right:float]
 *
 * No generation arg (meters don't advance generation; design §3.5).
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import { applyTrackMeter, applyMasterMeter } from '$lib/stores/v3/meters.svelte';

export const V3_TRACK_METER_ADDRESS = '/looping/v3/track/meter';
export const V3_MASTER_METER_ADDRESS = '/looping/v3/master/meter';

export function isV3MeterAddress(address: string): boolean {
	return (
		address === V3_TRACK_METER_ADDRESS ||
		address === V3_MASTER_METER_ADDRESS
	);
}

export function handleV3Meter(address: string, args: OSCArg[]): void {
	if (address === V3_TRACK_METER_ADDRESS) {
		if (args.length < 3) {
			logger.warn('v3 track meter missing args', { address, args });
			return;
		}
		const trackPath = typeof args[0] === 'string' ? args[0] : String(args[0]);
		const left = toNumber(args[1]);
		const right = toNumber(args[2]);
		if (left === null || right === null) {
			logger.warn('v3 track meter non-numeric L/R', { trackPath, args });
			return;
		}
		applyTrackMeter(trackPath, left, right);
		return;
	}
	if (address === V3_MASTER_METER_ADDRESS) {
		if (args.length < 2) {
			logger.warn('v3 master meter missing args', { address, args });
			return;
		}
		const left = toNumber(args[0]);
		const right = toNumber(args[1]);
		if (left === null || right === null) {
			logger.warn('v3 master meter non-numeric L/R', { args });
			return;
		}
		applyMasterMeter(left, right);
	}
}

function toNumber(v: OSCArg): number | null {
	if (typeof v === 'number') return v;
	if (typeof v === 'string') {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}
