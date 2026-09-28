/**
 * clipNotesService — ADR-360 (Milestone 3).
 *
 * Pull endpoint for MIDI clip notes. The Python surface owns
 * `/looping/v3/clip/notes/get [requestId, clipPath]` and replies
 * with `/looping/v3/clip/notes [requestId, clipPath, count, blob]`
 * (or `/looping/v3/error` on failure). The blob is a packed
 * float32 array `[pitch, start_beats, duration_beats, velocity] × n`
 * — see `_pack_notes_blob` in ClipNotesComponent. The velocity's sign
 * is the note's mute bit (ADR-444): a muted note arrives as
 * `-velocity`, and `-0` is a muted velocity-0 note. Nothing past the
 * decoder sees the sign — it is folded into `MidiNote.muted`.
 *
 * Also handles surface-pushed `/looping/v3/clip/notes/changed
 * [trackPath, clipPath]` pokes — when the currently-displayed clip
 * matches, we re-issue `notes/get` to refresh the view. That listener
 * is wired by `PlayheadComponent` only on the playing clip, so the
 * fan-out is bounded (+1 listener per playing track, never
 * O(tracks × clips)).
 *
 * No watch/unwatch protocol: notes-changed is a poke, the response
 * is pull-by-clip-path. Components that mount a TrackClipMidiView
 * register a re-fetch callback; unmount unregisters.
 */

import { logger } from '$lib/utils/logger';

export interface MidiNote {
	pitch: number;
	startBeats: number;
	durationBeats: number;
	/** Always ≥ 0 — the wire's sign has been folded into `muted`. */
	velocity: number;
	/** Live's `MidiNote.mute`. The strip draws such a note hollow. */
	muted: boolean;
}

export type NotesSender = (clipPath: string, requestId: string) => void;

interface PendingRequest {
	resolve: (notes: MidiNote[]) => void;
	reject: (err: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
	clipPath: string;
}

const REQUEST_TIMEOUT_MS = 5000;
const NOTE_FLOAT_STRIDE = 16; // 4 floats × 4 bytes

const pending = new Map<string, PendingRequest>();
// `clipPath → in-flight Promise` so concurrent callers asking for the
// same clip's notes share one round-trip. The Python LRU is keyed on
// `request_id`, so without this dedupe a flurry of `notes/changed`
// pokes during MIDI editing would force the surface to re-read the LOM
// for each request — the dedupe collapses that into a single read.
const inflightByClipPath = new Map<string, Promise<MidiNote[]>>();
// Resolved notes, kept past the round-trip — the audio half of this
// question (`clipSampleService`) caches for exactly the same reason.
// The session grid keys its cells on scene index, so scrolling the
// scene window destroys and recreates them continuously and each
// remount re-issues `notes/get`; with in-flight dedupe alone a drag
// across a MIDI-heavy set is dozens of full blob pulls off Live's
// thread, competing with the 30 Hz playhead stream. Correctness comes
// from the existing poke: `handleClipNotesChanged` drops the entry
// before it fans out to subscribers, so an edited clip always re-pulls.
const resolvedByClipPath = new Map<string, MidiNote[]>();
// One clipPath can have multiple `notes/changed` subscribers (e.g. a
// strip view + a central detail view both rendering the same clip).
// Set semantics: register-then-deregister is safe under concurrent
// mounts; firing iterates a snapshot so callbacks that re-register
// inside their own handler don't loop.
const subscribers = new Map<string, Set<() => void>>();

let _sender: NotesSender | null = null;
let _seq = 0;

export function setNotesSender(sender: NotesSender): void {
	_sender = sender;
}

function nextRequestId(): string {
	_seq = (_seq + 1) & 0x7fffffff;
	return `notes-${Date.now().toString(36)}-${_seq}`;
}

/**
 * Request notes for `clipPath`. Resolves with the parsed note array
 * once the surface replies, rejects on timeout / typed error.
 *
 * Single-flight per `clipPath`: concurrent calls share one round-trip
 * and one `request_id`. The shared promise is dropped on settle so a
 * later call after resolution issues a fresh request. The Python LRU
 * still covers WS-flap retransmit idempotency.
 */
export function requestNotes(clipPath: string): Promise<MidiNote[]> {
	if (!_sender) {
		return Promise.reject(new Error('clipNotesService: sender not configured'));
	}
	if (!clipPath) {
		return Promise.reject(new Error('clipNotesService: empty clipPath'));
	}
	const cached = resolvedByClipPath.get(clipPath);
	if (cached !== undefined) return Promise.resolve(cached);

	const existing = inflightByClipPath.get(clipPath);
	if (existing) return existing;

	const requestId = nextRequestId();
	const sender = _sender;
	const promise = new Promise<MidiNote[]>((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			pending.delete(requestId);
			reject(new Error(`clipNotesService: timed out after ${REQUEST_TIMEOUT_MS}ms`));
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
		// Guard: only clear the inflight slot if it's still ours. A
		// `__resetClipNotesServiceForTests` between issue and settle could
		// have wiped + repopulated the entry; don't clobber that.
		if (inflightByClipPath.get(clipPath) === promise) {
			inflightByClipPath.delete(clipPath);
		}
	});
	inflightByClipPath.set(clipPath, promise);
	return promise;
}

/**
 * Inbound `/looping/v3/clip/notes` reply handler. Called from
 * `simpleClient.ts` routing.
 */
export function handleNotesReply(args: {
	requestId: string;
	clipPath: string;
	count: number;
	blob: Uint8Array;
}): void {
	const entry = pending.get(args.requestId);
	if (!entry) return;
	pending.delete(args.requestId);
	clearTimeout(entry.timeoutId);
	try {
		const notes = decodeNotesBlob(args.blob, args.count);
		resolvedByClipPath.set(args.clipPath, notes);
		entry.resolve(notes);
	} catch (err) {
		entry.reject(err as Error);
	}
}

/**
 * Inbound `/looping/v3/error` handler — called from `v3Handshake.ts`'s
 * error router with the originating address. Resolves a pending
 * request with `[]` if the error is a benign "not MIDI" or
 * "not found"; rejects otherwise so the UI can surface the failure.
 *
 * The error wire shape doesn't carry `requestId`, so we resolve by
 * matching `clipPath` — there's typically only one in-flight notes/get
 * per clip, and the request_id mismatch means rejected requests stay
 * pending until their own timeout fires (acceptable: 5s ceiling).
 */
export function handleNotesError(args: {
	originatingAddress: string;
	code: string;
	clipPath: string;
}): void {
	if (args.originatingAddress !== '/looping/v3/clip/notes/get') return;
	for (const [requestId, entry] of pending) {
		if (entry.clipPath !== args.clipPath) continue;
		pending.delete(requestId);
		clearTimeout(entry.timeoutId);
		// `clip-not-midi` and `clip-not-found` resolve with empty
		// notes (the UI shows a ghost / placeholder). Other codes
		// reject with the typed error string for the caller to log.
		if (args.code === 'clip-not-midi' || args.code === 'clip-not-found') {
			entry.resolve([]);
		} else {
			entry.reject(new Error(`clipNotesService: ${args.code}`));
		}
		return;
	}
}

/**
 * Subscribe a callback to fire when the surface emits
 * `notes/changed` for `clipPath`. The callback should re-issue
 * `requestNotes` if the consumer is still showing that clip.
 *
 * Multi-subscriber: every registered callback fires on each poke, so
 * a strip view + a detail view rendering the same clip both update.
 * Returns an unregister function specific to this callback.
 */
export function subscribeNotesChanged(clipPath: string, cb: () => void): () => void {
	let set = subscribers.get(clipPath);
	if (set === undefined) {
		set = new Set();
		subscribers.set(clipPath, set);
	}
	set.add(cb);
	return () => {
		const current = subscribers.get(clipPath);
		if (current === undefined) return;
		current.delete(cb);
		if (current.size === 0) subscribers.delete(clipPath);
	};
}

/** Inbound `/looping/v3/clip/notes/changed` handler. */
export function handleClipNotesChanged(_trackPath: string, clipPath: string): void {
	// Drop the cached notes BEFORE fanning out — a subscriber's callback
	// re-issues `requestNotes` synchronously, and a stale entry would
	// hand it back the notes the poke just invalidated. Unconditional,
	// ahead of the subscriber check: a clip can change while nothing is
	// mounted on it (scrolled out of the scene window), and the next
	// mount must not read the pre-edit notes out of the cache.
	resolvedByClipPath.delete(clipPath);

	const set = subscribers.get(clipPath);
	if (set === undefined || set.size === 0) return;
	// Iterate a snapshot so a callback that registers/unregisters
	// during fire doesn't mutate the set we're walking.
	for (const cb of Array.from(set)) {
		try {
			cb();
		} catch (err) {
			logger.warn('clipNotesService: subscriber threw', {
				clipPath,
				error: (err as Error).message
			});
		}
	}
}

/**
 * Decode the float32 blob into typed notes.
 *
 * The blob is little-endian (matches Python's `struct.pack('<ffff')`).
 * Uint8Array → DataView → 4 floats per stride. A negative velocity is a
 * muted note (ADR-444); `Object.is(v, -0)` catches the velocity-0 case,
 * which `< 0` alone would miss because `-0 < 0` is false.
 */
export function decodeNotesBlob(blob: Uint8Array, expectedCount: number): MidiNote[] {
	if (blob.length === 0) return [];
	if (blob.length !== expectedCount * NOTE_FLOAT_STRIDE) {
		// Tolerate but log — over-the-wire truncation is theoretically
		// possible if a kernel UDP fragmentation issue dropped tail
		// padding. Decode what we can.
		logger.warn('clipNotesService: blob length mismatch', {
			expectedCount,
			actualBytes: blob.length,
			expectedBytes: expectedCount * NOTE_FLOAT_STRIDE
		});
	}
	const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
	const usableNotes = Math.floor(blob.length / NOTE_FLOAT_STRIDE);
	const out: MidiNote[] = new Array(usableNotes);
	for (let i = 0; i < usableNotes; i++) {
		const off = i * NOTE_FLOAT_STRIDE;
		const rawVelocity = view.getFloat32(off + 12, true);
		const muted = rawVelocity < 0 || Object.is(rawVelocity, -0);
		out[i] = {
			pitch: view.getFloat32(off, true),
			startBeats: view.getFloat32(off + 4, true),
			durationBeats: view.getFloat32(off + 8, true),
			velocity: Math.abs(rawVelocity),
			muted
		};
	}
	return out;
}

/**
 * The bridge JSON-stringifies osc.js Buffer args as
 * `{"type":"Buffer","data":[byte0,byte1,...]}`. The browser's JSON
 * parser hands it back as a plain object, not a Uint8Array. This
 * helper accepts every reasonable shape and returns a Uint8Array
 * view ready for `decodeNotesBlob`.
 */
export function toUint8Array(arg: unknown): Uint8Array {
	if (arg instanceof Uint8Array) return arg;
	if (
		arg &&
		typeof arg === 'object' &&
		'data' in arg &&
		Array.isArray((arg as { data: unknown }).data)
	) {
		return new Uint8Array((arg as { data: number[] }).data);
	}
	if (Array.isArray(arg)) {
		return new Uint8Array(arg as number[]);
	}
	// The bridge does plain `JSON.stringify(message)`; if the OSC parser
	// hands back a raw Uint8Array (no `Buffer.toJSON()`), it round-trips
	// as `{ "0": b0, "1": b1, ... "length": n }` — integer-keyed object.
	if (arg && typeof arg === 'object') {
		const obj = arg as Record<string, unknown>;
		const keys = Object.keys(obj);
		const numericKeys = keys.filter((k) => /^\d+$/.test(k));
		if (numericKeys.length > 0 && numericKeys.length === keys.length) {
			const out = new Uint8Array(numericKeys.length);
			for (const k of numericKeys) {
				const v = obj[k];
				if (typeof v !== 'number') return new Uint8Array(0);
				out[Number(k)] = v;
			}
			return out;
		}
	}
	logger.warn('clipNotesService: unrecognised blob shape', {
		type: typeof arg,
		keys: arg && typeof arg === 'object' ? Object.keys(arg) : undefined
	});
	return new Uint8Array(0);
}

/** Test helper — clear pending + subscribers + cached notes. */
export function __resetClipNotesServiceForTests(): void {
	for (const [, entry] of pending) clearTimeout(entry.timeoutId);
	pending.clear();
	subscribers.clear();
	inflightByClipPath.clear();
	resolvedByClipPath.clear();
	_seq = 0;
}

// A resync re-rides `state/full`, which can put different clips behind
// the same paths — so the notes cache has to go with it, the same
// volatile-state contract `clipSampleService` and `playingClipsStore`
// follow. Pending requests are left alone: they carry their own
// timeouts and their replies are still addressed to real callers.
// Guarded for SSR.
if (typeof window !== 'undefined') {
	window.addEventListener('bridge-resync', () => {
		resolvedByClipPath.clear();
	});
}
