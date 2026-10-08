/**
 * `/toneshaper/frame [devicePath, levels×59, gains×59]` from a Tone Shaper
 * device, through the bridge (`handlers/toneShaper.js`), into the frame
 * store. The graph in the EQ view reads it through `toneShaperStore.get`.
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import {
	applyToneShaperFrame,
	TONE_SHAPER_BANDS,
	TONE_SHAPER_FRAME_ADDRESS
} from '$lib/stores/v3/toneShaper.svelte';

export { TONE_SHAPER_FRAME_ADDRESS, TONE_SHAPER_WATCH_ADDRESS } from '$lib/stores/v3/toneShaper.svelte';

export function isToneShaperAddress(address: string): boolean {
	return address.startsWith('/toneshaper/');
}

export function handleToneShaperFrame(address: string, args: OSCArg[]): void {
	if (address !== TONE_SHAPER_FRAME_ADDRESS) return;
	if (args.length !== 1 + 2 * TONE_SHAPER_BANDS || typeof args[0] !== 'string') {
		logger.warn('toneshaper frame of the wrong shape', { address, length: args.length });
		return;
	}
	const numbers = args.slice(1).map(toNumber);
	if (numbers.some((n) => n === null)) {
		logger.warn('toneshaper frame with a non-numeric band', { address });
		return;
	}
	const values = numbers as number[];
	applyToneShaperFrame(args[0], values.slice(0, TONE_SHAPER_BANDS), values.slice(TONE_SHAPER_BANDS));
}

function toNumber(v: OSCArg): number | null {
	if (typeof v === 'number') return v;
	if (typeof v === 'string') {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}
