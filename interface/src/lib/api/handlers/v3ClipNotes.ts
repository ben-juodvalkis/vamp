/**
 * v3 Clip-notes reply handler — ADR-360 (Milestone 3).
 *
 * Routes `/looping/v3/clip/notes
 *   [requestId, clipPath, count, blob]` into `clipNotesService` so
 * the matching pending promise can resolve.
 *
 * The blob arrives over WebSocket as a JSON-encoded Buffer
 * (`{type: "Buffer", data: [byte0, ...]}`) because the bridge
 * JSON.stringify's the osc.js-decoded args. `toUint8Array` normalises.
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import { handleNotesReply, toUint8Array } from '$lib/services/clipNotesService';
import { toNumber, toString } from './oscTypeHelpers';

export const V3_CLIP_NOTES_REPLY_ADDRESS = '/looping/v3/clip/notes';

export function handleV3ClipNotesReply(args: OSCArg[]): void {
	if (args.length < 4) {
		logger.warn('v3 clip notes reply wrong arity', { args });
		return;
	}
	const requestId = toString(args[0]);
	const clipPath = toString(args[1]);
	const count = toNumber(args[2]) | 0;
	const blob = toUint8Array(args[3]);
	handleNotesReply({ requestId, clipPath, count, blob });
}
