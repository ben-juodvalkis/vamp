/**
 * v3 clip-sample reply handler — ADR-415.
 *
 * Routes `/looping/v3/clip/sample [requestId, clipPath, isAudioClip,
 * filePath, fileStartBeats?, fileEndBeats?]` into `clipSampleService`
 * so the matching pending promise can resolve. The file span is
 * trailing and optional — a surface from before it sends four args,
 * and the span then reads as unknown (`0, 0`).
 *
 * `isAudioClip` rides as an int (0/1) rather than a bool because the
 * OSC codec has no boolean type — same convention as `looping` and
 * `isAudioClip` on `track/playing_slot`.
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import { handleSampleReply } from '$lib/services/clipSampleService';
import { toNumber, toString } from './oscTypeHelpers';

export const V3_CLIP_SAMPLE_REPLY_ADDRESS = '/looping/v3/clip/sample';
export const V3_CLIP_SAMPLE_GET_ADDRESS = '/looping/v3/clip/sample/get';

export function handleV3ClipSampleReply(args: OSCArg[]): void {
	if (args.length < 4) {
		logger.warn('v3 clip sample reply wrong arity', { args });
		return;
	}
	handleSampleReply({
		requestId: toString(args[0]),
		clipPath: toString(args[1]),
		isAudioClip: (toNumber(args[2]) | 0) === 1,
		filePath: toString(args[3]),
		fileStartBeats: args.length > 5 ? toNumber(args[4]) : 0,
		fileEndBeats: args.length > 5 ? toNumber(args[5]) : 0
	});
}
