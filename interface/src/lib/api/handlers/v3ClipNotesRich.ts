/**
 * v3 rich clip-notes handlers — clip-view-mirror M3 + M4.
 *
 * Routes the chunked rich-note read sequence and the add-reply into
 * `clipRichNotesService`:
 *
 *   /looping/v3/clip/notes/rich/begin [requestId, clipPath, count, totalChunks]
 *   /looping/v3/clip/notes/rich/chunk [requestId, chunkIndex, blob]
 *   /looping/v3/clip/notes/rich/end   [requestId, checksum:string]
 *   /looping/v3/clip/notes/added      [requestId, clipPath, newIds:int[]]
 *
 * Blobs arrive as the bridge's JSON-encoded Buffer shape; `toUint8Array`
 * (shared with clipNotesService) normalises. The checksum is a hex
 * string ("0x........") — parsed to an int31 here.
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import {
	handleRichBegin,
	handleRichChunk,
	handleRichEnd,
	handleNotesAdded,
	decodeIdBlob,
	toUint8Array
} from '$lib/services/clipRichNotesService';
import { toNumber, toString } from './oscTypeHelpers';

export const V3_CLIP_NOTES_RICH_BEGIN_ADDRESS = '/looping/v3/clip/notes/rich/begin';
export const V3_CLIP_NOTES_RICH_CHUNK_ADDRESS = '/looping/v3/clip/notes/rich/chunk';
export const V3_CLIP_NOTES_RICH_END_ADDRESS = '/looping/v3/clip/notes/rich/end';
export const V3_CLIP_NOTES_ADDED_ADDRESS = '/looping/v3/clip/notes/added';

const RICH_ADDRESSES = new Set([
	V3_CLIP_NOTES_RICH_BEGIN_ADDRESS,
	V3_CLIP_NOTES_RICH_CHUNK_ADDRESS,
	V3_CLIP_NOTES_RICH_END_ADDRESS,
	V3_CLIP_NOTES_ADDED_ADDRESS
]);

export function isV3ClipNotesRichAddress(address: string): boolean {
	return RICH_ADDRESSES.has(address);
}

function parseChecksumHex(s: string): number {
	// "0x1a2b3c4d" → int31. parseInt tolerates the 0x prefix.
	const n = parseInt(s, 16);
	return Number.isFinite(n) ? n & 0x7fffffff : -1;
}

/** Coerce the notes/added id arg (int32 blob) into number[]. */
function toIntArray(arg: OSCArg): number[] {
	// Spread-int fallback (osc.js could deliver a JS array) kept for
	// robustness, but the surface sends a little-endian int32 blob.
	if (Array.isArray(arg)) return arg.map((x) => toNumber(x) | 0);
	return decodeIdBlob(toUint8Array(arg));
}

export function handleV3ClipNotesRich(address: string, args: OSCArg[]): void {
	if (address === V3_CLIP_NOTES_RICH_BEGIN_ADDRESS) {
		if (args.length < 4) {
			logger.warn('v3 rich begin wrong arity', { args });
			return;
		}
		handleRichBegin({
			requestId: toString(args[0]),
			clipPath: toString(args[1]),
			count: toNumber(args[2]) | 0,
			totalChunks: toNumber(args[3]) | 0
		});
		return;
	}
	if (address === V3_CLIP_NOTES_RICH_CHUNK_ADDRESS) {
		if (args.length < 3) {
			logger.warn('v3 rich chunk wrong arity', { args });
			return;
		}
		handleRichChunk({
			requestId: toString(args[0]),
			chunkIndex: toNumber(args[1]) | 0,
			blob: toUint8Array(args[2])
		});
		return;
	}
	if (address === V3_CLIP_NOTES_RICH_END_ADDRESS) {
		if (args.length < 2) {
			logger.warn('v3 rich end wrong arity', { args });
			return;
		}
		handleRichEnd({
			requestId: toString(args[0]),
			checksum: parseChecksumHex(toString(args[1]))
		});
		return;
	}
	if (address === V3_CLIP_NOTES_ADDED_ADDRESS) {
		if (args.length < 3) {
			logger.warn('v3 notes/added wrong arity', { args });
			return;
		}
		handleNotesAdded({
			requestId: toString(args[0]),
			clipPath: toString(args[1]),
			newIds: toIntArray(args[2])
		});
		return;
	}
}
