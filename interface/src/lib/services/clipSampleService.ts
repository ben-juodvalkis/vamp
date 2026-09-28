/**
 * clipSampleService — ADR-415.
 *
 * Pull endpoint for "what sample is in this slot?". The Python surface
 * owns `/looping/v3/clip/sample/get [requestId, clipPath]` and replies
 * with `/looping/v3/clip/sample [requestId, clipPath, isAudioClip,
 * filePath, fileStartBeats, fileEndBeats]` (or `/looping/v3/error` on
 * failure) — see
 * `ClipsComponent.handle_sample_get`.
 *
 * **Why this exists.** The session clip grid draws a waveform in every
 * audio cell, including slots that have never played. The track strip
 * gets its waveform from `playingClipsStore` ← `track/playing_slot`,
 * which the surface emits from one `playing_slot_index` listener per
 * track — so that channel carries a path for the *playing* slot only.
 * `state/full`'s C record deliberately omits `file_path` (a path per
 * clip would add kilobytes of strings to a bundle that already
 * chunks), and `clip/property` fires only for the focused clip.
 *
 * Deliberately mirrors `clipNotesService`: same request-id plumbing,
 * same single-flight-per-clipPath dedupe, same timeout. The two are
 * the audio and MIDI halves of one question the grid asks per cell, so
 * they should be the same shape.
 *
 * **Results are cached by clipPath, not just deduped in flight.** A
 * slot's sample changes only when its clip is replaced, and the grid
 * re-asks about the same cells constantly as the scene window scrolls
 * back and forth. Without the cache, every scroll would re-query every
 * visible cell.
 *
 * A `clipPath` is a POSITION (`tracks/N/slots/M/clip`), not an
 * identity — it survives the clip in it being replaced, and a track
 * insert slides it onto a different track's clip. Two things keep the
 * cache honest about that:
 *
 *   - `invalidateSample()` drops one entry. `SlotCell` calls it when
 *     the C record for a path changes identity (name or length) while
 *     the path itself stays put, which is exactly the replaced-clip
 *     and shifted-index case.
 *   - `resetClipSampleService()` clears everything on `bridge-resync`,
 *     matching the volatile-state contract `playingClipsStore` and
 *     `sceneWindowStore` already follow.
 *
 * A provisional reply — audio with an empty `filePath`, which Live
 * returns while a recording is still flushing — is deliberately NOT
 * cached, so the cell that gets it will re-ask rather than freeze
 * blank. See `handleSampleReply`.
 */

import { logger } from '$lib/utils/logger';

export interface ClipSample {
	/** False for a MIDI clip — NOT an error; the caller draws notes. */
	isAudioClip: boolean;
	/**
	 * Absolute path of the sample, or `''`. Empty is legitimate: Live
	 * reports no path for a clip whose recording is still flushing to
	 * disk. The caller draws the cell without a waveform.
	 */
	filePath: string;
	/**
	 * Where the file sits in the clip's own time (the span its peaks
	 * cover) — see `PlayingClipEntry.fileStartBeats`. `0, 0` = unknown.
	 */
	fileStartBeats: number;
	fileEndBeats: number;
}

export type SampleSender = (clipPath: string, requestId: string) => void;

interface PendingRequest {
	resolve: (sample: ClipSample) => void;
	reject: (err: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
	clipPath: string;
}

const REQUEST_TIMEOUT_MS = 5000;

const pending = new Map<string, PendingRequest>();
const inflightByClipPath = new Map<string, Promise<ClipSample>>();
const resolvedByClipPath = new Map<string, ClipSample>();

let _sender: SampleSender | null = null;
let _seq = 0;

export function setSampleSender(sender: SampleSender): void {
	_sender = sender;
}

function nextRequestId(): string {
	_seq = (_seq + 1) & 0x7fffffff;
	return `sample-${Date.now().toString(36)}-${_seq}`;
}

/**
 * Synchronous peek at the cache. Returns `undefined` when nothing has
 * resolved for this path yet — lets a cell render its final state on
 * the first frame after a scroll instead of flashing a placeholder.
 */
export function peekSample(clipPath: string): ClipSample | undefined {
	return resolvedByClipPath.get(clipPath);
}

/**
 * Ask what sample `clipPath` holds. Resolves for MIDI clips too
 * (`isAudioClip: false`); rejects only on timeout or a typed surface
 * error such as an unresolvable path.
 *
 * Single-flight per `clipPath`, then cached — see the module note.
 */
export function requestSample(clipPath: string): Promise<ClipSample> {
	if (!_sender) {
		return Promise.reject(new Error('clipSampleService: sender not configured'));
	}
	if (!clipPath) {
		return Promise.reject(new Error('clipSampleService: empty clipPath'));
	}

	const cached = resolvedByClipPath.get(clipPath);
	if (cached !== undefined) return Promise.resolve(cached);

	const existing = inflightByClipPath.get(clipPath);
	if (existing) return existing;

	const requestId = nextRequestId();
	const sender = _sender;
	const promise = new Promise<ClipSample>((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			pending.delete(requestId);
			reject(new Error(`clipSampleService: timed out after ${REQUEST_TIMEOUT_MS}ms`));
		}, REQUEST_TIMEOUT_MS);
		pending.set(requestId, { resolve, reject, timeoutId, clipPath });
		try {
			sender(clipPath, requestId);
		} catch (err) {
			pending.delete(requestId);
			clearTimeout(timeoutId);
			reject(err as Error);
		}
	}).finally(() => {
		// Only clear the slot if it is still ours — a `reset()` between
		// issue and settle could have wiped and repopulated it.
		if (inflightByClipPath.get(clipPath) === promise) {
			inflightByClipPath.delete(clipPath);
		}
	});
	inflightByClipPath.set(clipPath, promise);
	return promise;
}

/** Inbound `/looping/v3/clip/sample` reply. Routed from simpleClient. */
export function handleSampleReply(args: {
	requestId: string;
	clipPath: string;
	isAudioClip: boolean;
	filePath: string;
	fileStartBeats?: number;
	fileEndBeats?: number;
}): void {
	const sample: ClipSample = {
		isAudioClip: args.isAudioClip,
		filePath: args.filePath,
		fileStartBeats: args.fileStartBeats ?? 0,
		fileEndBeats: args.fileEndBeats ?? 0
	};

	// An audio clip with no path is a PROVISIONAL answer, not a final
	// one — Live reports it while a recording is still flushing to
	// disk. Caching it would freeze the cell blank forever, because
	// `requestSample` and `peekSample` both short-circuit on the cache
	// and the take never changes its clipPath. Resolve the waiting
	// promise (the cell draws a chip now) but leave the cache empty so
	// the next ask actually re-queries. MIDI replies and audio replies
	// that carry a path are final and do get cached.
	if (isFinalAnswer(sample)) {
		resolvedByClipPath.set(args.clipPath, sample);
	}

	const entry = pending.get(args.requestId);
	if (!entry) {
		// Late reply after a timeout, or a retransmit the surface's LRU
		// replayed. The answer is still correct and now cached above; a
		// cell that timed out will ask again.
		return;
	}
	pending.delete(args.requestId);
	clearTimeout(entry.timeoutId);
	entry.resolve(sample);
}

/**
 * Whether a reply is worth caching. False for an audio clip with no
 * path — see `handleSampleReply`.
 */
function isFinalAnswer(sample: ClipSample): boolean {
	return !sample.isAudioClip || sample.filePath !== '';
}

/** Inbound `/looping/v3/error` for a `sample/get`. Routed from simpleClient. */
export function handleSampleError(args: {
	requestId?: string;
	clipPath: string;
	code: string;
	detail?: string;
}): void {
	logger.debug('clipSampleService: sample/get error', {
		clipPath: args.clipPath,
		code: args.code,
		detail: args.detail
	});
	// The surface's error payload is `[address, code, path, detail]` —
	// it carries no requestId, so reject by clipPath. There is at most
	// one in-flight request per path (single-flight), so the match is
	// exact WHEN the surface sent a path. Arg-count rejections don't:
	// `_check_arg_count` emits `path=""`, which can never match (empty
	// paths are refused up front in `requestSample`). Nothing to reject
	// then — the request falls back to its own timeout — so say so
	// rather than failing silently.
	if (!args.clipPath) {
		logger.warn('clipSampleService: sample/get error carries no clipPath', {
			code: args.code,
			detail: args.detail,
			pendingCount: pending.size
		});
		return;
	}
	for (const [requestId, entry] of pending) {
		if (entry.clipPath !== args.clipPath) continue;
		pending.delete(requestId);
		clearTimeout(entry.timeoutId);
		entry.reject(new Error(`clipSampleService: ${args.code}`));
		return;
	}
}

/**
 * Drop the cached answer for a path whose clip may have changed — a
 * replaced clip keeps its slot, and therefore its clipPath.
 */
export function invalidateSample(clipPath: string): void {
	resolvedByClipPath.delete(clipPath);
}

/**
 * Drop everything. Fired on `bridge-resync`; also the test reset.
 *
 * Pending requests are **rejected**, not merely dropped. Clearing the
 * timeout removes the only other path that could ever settle them, so
 * dropping the entry would strand every waiting caller on a promise
 * that never resolves or rejects — and a `SlotCell` awaiting one would
 * sit previewless for the rest of the session, since its effect has no
 * dependency that changes across a resync.
 */
export function resetClipSampleService(): void {
	for (const entry of pending.values()) {
		clearTimeout(entry.timeoutId);
		entry.reject(new Error('clipSampleService: reset before reply'));
	}
	pending.clear();
	inflightByClipPath.clear();
	resolvedByClipPath.clear();
}

// A resync re-rides `state/full`, which can restructure the whole grid
// (different set, different clips in the same slot paths). Same
// contract playingClipsStore and sceneWindowStore use: drop volatile
// state and let the fresh snapshot rehydrate it. Guarded for SSR.
if (typeof window !== 'undefined') {
	window.addEventListener('bridge-resync', () => {
		logger.debug('clipSampleService: clearing cache on bridge-resync');
		resetClipSampleService();
	});
}
