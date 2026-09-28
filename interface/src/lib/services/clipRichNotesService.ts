/**
 * clipRichNotesService — clip-view-mirror M3 + M4.
 *
 * The rich, identity-carrying note channel for the ONE focused clip
 * (the editor source). Separate from `clipNotesService` (the cheap,
 * identity-blind blob that feeds strip thumbnails — plan decision 1):
 *
 *   M3 (read):
 *     UI →  /looping/v3/clip/notes/rich/get   [requestId, clipPath]
 *     ← /looping/v3/clip/notes/rich/begin     [requestId, clipPath, count, totalChunks]
 *     ← /looping/v3/clip/notes/rich/chunk     [requestId, chunkIndex, blob]   × N
 *     ← /looping/v3/clip/notes/rich/end       [requestId, checksum]
 *
 *   M4 (write):
 *     UI →  /looping/v3/clip/notes/remove     [clipPath, noteIds:int[]]
 *     UI →  /looping/v3/clip/notes/modify     [clipPath, modsBlob]
 *     UI →  /looping/v3/clip/notes/add        [requestId, clipPath, notesBlob]
 *     ← /looping/v3/clip/notes/added          [requestId, clipPath, newIds:int[]]
 *
 * Each note is the 24-byte `<iffffi>` struct
 * `(noteId:int32, pitch:f32, startBeats:f32, durBeats:f32, velocity:f32, mute:int32)`.
 * noteId is an explicit int32 so it never round-trips through float32's
 * 24-bit mantissa (plan decision 2).
 *
 * Cross-client sync reuses `clipNotesService.subscribeNotesChanged` —
 * the surface's `notes/changed` poke fans out to both the cheap-blob and
 * rich subscribers. The OWN-WRITE ECHO (plan decision 4): our note
 * writes fire the focused-clip listener back at us. We can't tag the
 * poke (it's origin-blind on the wire), so the initiating client
 * suppresses its own re-pull for a short window after a local write
 * (`markLocalWrite` / `shouldSuppressReconcile`).
 */

import { logger } from '$lib/utils/logger';
import { toUint8Array } from './clipNotesService';

export interface RichNote {
	noteId: number;
	pitch: number;
	startBeats: number;
	durationBeats: number;
	velocity: number;
	mute: boolean;
}

/** A note spec for add (no real id yet) / modify (real id required). */
export interface RichNoteSpec {
	noteId: number; // ignored on add; real id on modify
	pitch: number;
	startBeats: number;
	durationBeats: number;
	velocity: number;
	mute: boolean;
}

export type RichGetSender = (clipPath: string, requestId: string) => void;
export type RichEditSender = (address: string, args: unknown[]) => void;

export const RICH_NOTE_STRIDE = 24; // bytes: <iffffi>

const REQUEST_TIMEOUT_MS = 5000;
// Own-write echo suppression: ignore a `notes/changed` re-pull for this
// long after a local write so the editor doesn't reconcile against its
// own optimistic edit (plan decision 4). External edits arriving after
// the window still reconcile.
const LOCAL_WRITE_SUPPRESS_MS = 400;

// FNV-1a 32-bit — mirrors the surface's `_rich_blob_checksum`.
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// --- write addresses ------------------------------------------------------

export const V3_CLIP_NOTES_RICH_GET_ADDRESS = '/looping/v3/clip/notes/rich/get';
export const V3_CLIP_NOTES_REMOVE_ADDRESS = '/looping/v3/clip/notes/remove';
export const V3_CLIP_NOTES_MODIFY_ADDRESS = '/looping/v3/clip/notes/modify';
export const V3_CLIP_NOTES_ADD_ADDRESS = '/looping/v3/clip/notes/add';
export const V3_CLIP_NOTES_SELECT_ADDRESS = '/looping/v3/clip/notes/select';
export const V3_CLIP_NOTES_DUPLICATE_ADDRESS = '/looping/v3/clip/notes/duplicate';

// --- reassembly state -----------------------------------------------------

interface PendingRich {
	resolve: (notes: RichNote[]) => void;
	reject: (err: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
	clipPath: string;
	count: number;
	totalChunks: number;
	chunks: Array<Uint8Array | undefined>;
	received: number;
}

interface PendingAdd {
	resolve: (newIds: number[]) => void;
	reject: (err: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingRich>();
const inflightByClipPath = new Map<string, Promise<RichNote[]>>();
const pendingAdd = new Map<string, PendingAdd>();

let _getSender: RichGetSender | null = null;
let _editSender: RichEditSender | null = null;
let _seq = 0;
// clipPath → timestamp of last local write (for own-write echo suppression).
const lastLocalWrite = new Map<string, number>();

export function setRichGetSender(sender: RichGetSender): void {
	_getSender = sender;
}
export function setRichEditSender(sender: RichEditSender): void {
	_editSender = sender;
}

function nextRequestId(prefix: string): string {
	_seq = (_seq + 1) & 0x7fffffff;
	return `${prefix}-${Date.now().toString(36)}-${_seq}`;
}

// --- M3 read --------------------------------------------------------------

/**
 * Request the rich note list for `clipPath`. Single-flight per clipPath
 * (concurrent callers share one round-trip). Resolves once `rich/end`
 * verifies the checksum; rejects on timeout / checksum mismatch / error.
 */
export function requestRichNotes(clipPath: string): Promise<RichNote[]> {
	if (!_getSender) {
		return Promise.reject(new Error('clipRichNotesService: sender not configured'));
	}
	if (!clipPath) {
		return Promise.reject(new Error('clipRichNotesService: empty clipPath'));
	}
	const existing = inflightByClipPath.get(clipPath);
	if (existing) return existing;

	const requestId = nextRequestId('rich');
	const sender = _getSender;
	const promise = new Promise<RichNote[]>((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			pending.delete(requestId);
			reject(new Error(`clipRichNotesService: timed out after ${REQUEST_TIMEOUT_MS}ms`));
		}, REQUEST_TIMEOUT_MS);
		pending.set(requestId, {
			resolve,
			reject,
			timeoutId,
			clipPath,
			count: 0,
			totalChunks: 0,
			chunks: [],
			received: 0
		});
		try {
			sender(clipPath, requestId);
		} catch (err) {
			pending.delete(requestId);
			clearTimeout(timeoutId);
			reject(err as Error);
		}
	}).finally(() => {
		if (inflightByClipPath.get(clipPath) === promise) {
			inflightByClipPath.delete(clipPath);
		}
	});
	inflightByClipPath.set(clipPath, promise);
	return promise;
}

export function handleRichBegin(args: {
	requestId: string;
	clipPath: string;
	count: number;
	totalChunks: number;
}): void {
	const entry = pending.get(args.requestId);
	if (!entry) return;
	entry.count = args.count;
	entry.totalChunks = args.totalChunks;
	entry.chunks = new Array(args.totalChunks);
	entry.received = 0;
	// Empty clip: zero chunks → resolve immediately (avoids waiting on an
	// empty reassembly). The surface still sends rich/end, but the pending
	// entry is already cleared by then, so handleRichEnd → finalize finds
	// nothing and no-ops — expected, not a double resolve.
	if (args.totalChunks === 0) {
		finalize(args.requestId, null);
	}
}

export function handleRichChunk(args: {
	requestId: string;
	chunkIndex: number;
	blob: Uint8Array;
}): void {
	const entry = pending.get(args.requestId);
	if (!entry) return;
	if (args.chunkIndex < 0 || args.chunkIndex >= entry.totalChunks) {
		logger.warn('clipRichNotesService: chunk index OOR', {
			chunkIndex: args.chunkIndex,
			totalChunks: entry.totalChunks
		});
		return;
	}
	if (entry.chunks[args.chunkIndex] !== undefined) return; // dup
	entry.chunks[args.chunkIndex] = args.blob;
	entry.received += 1;
}

export function handleRichEnd(args: { requestId: string; checksum: number }): void {
	finalize(args.requestId, args.checksum);
}

function finalize(requestId: string, checksum: number | null): void {
	const entry = pending.get(requestId);
	if (!entry) return;

	// Empty-clip fast path (called from begin with totalChunks=0).
	if (entry.totalChunks === 0) {
		pending.delete(requestId);
		clearTimeout(entry.timeoutId);
		entry.resolve([]);
		return;
	}

	// `end` arrived: verify completeness + checksum.
	if (checksum === null) return;
	if (entry.received !== entry.totalChunks) {
		logger.warn('clipRichNotesService: missing chunks at end', {
			received: entry.received,
			totalChunks: entry.totalChunks
		});
		pending.delete(requestId);
		clearTimeout(entry.timeoutId);
		entry.reject(new Error('clipRichNotesService: incomplete chunk set'));
		return;
	}
	const blob = concatChunks(entry.chunks as Uint8Array[]);
	const computed = computeRichBlobChecksum(blob);
	if (computed !== checksum) {
		logger.warn('clipRichNotesService: checksum mismatch', { computed, checksum });
		pending.delete(requestId);
		clearTimeout(entry.timeoutId);
		entry.reject(new Error('clipRichNotesService: checksum mismatch'));
		return;
	}
	pending.delete(requestId);
	clearTimeout(entry.timeoutId);
	entry.resolve(decodeRichBlob(blob, entry.count));
}

/**
 * Resolve an in-flight rich request with `[]` on a benign error, or
 * reject on a hard one. The error wire shape carries no requestId, so
 * match by clipPath (one in-flight rich/get per clip).
 */
export function handleRichError(args: {
	originatingAddress: string;
	code: string;
	clipPath: string;
}): void {
	if (args.originatingAddress !== V3_CLIP_NOTES_RICH_GET_ADDRESS) return;
	for (const [requestId, entry] of pending) {
		if (entry.clipPath !== args.clipPath) continue;
		pending.delete(requestId);
		clearTimeout(entry.timeoutId);
		if (args.code === 'clip-not-midi' || args.code === 'clip-not-found') {
			entry.resolve([]);
		} else {
			entry.reject(new Error(`clipRichNotesService: ${args.code}`));
		}
		return;
	}
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const c of chunks) total += c.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.length;
	}
	return out;
}

/** Decode the `<iffffi>` blob into typed rich notes. */
export function decodeRichBlob(blob: Uint8Array, expectedCount: number): RichNote[] {
	if (blob.length === 0) return [];
	if (blob.length % RICH_NOTE_STRIDE !== 0) {
		logger.warn('clipRichNotesService: blob length not a stride multiple', {
			length: blob.length,
			stride: RICH_NOTE_STRIDE
		});
	}
	const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
	const usable = Math.floor(blob.length / RICH_NOTE_STRIDE);
	if (usable !== expectedCount) {
		logger.warn('clipRichNotesService: decoded count mismatch', {
			usable,
			expectedCount
		});
	}
	const out: RichNote[] = new Array(usable);
	for (let i = 0; i < usable; i++) {
		const off = i * RICH_NOTE_STRIDE;
		out[i] = {
			noteId: view.getInt32(off, true),
			pitch: view.getFloat32(off + 4, true),
			startBeats: view.getFloat32(off + 8, true),
			durationBeats: view.getFloat32(off + 12, true),
			velocity: view.getFloat32(off + 16, true),
			mute: view.getInt32(off + 20, true) !== 0
		};
	}
	return out;
}

/** FNV-1a over the raw blob bytes — must match the surface byte-for-byte. */
export function computeRichBlobChecksum(blob: Uint8Array): number {
	let h = FNV_OFFSET_BASIS;
	for (let i = 0; i < blob.length; i++) {
		h ^= blob[i] & 0xff;
		// `Math.imul` keeps the 32-bit multiply correct (avoids float drift).
		h = Math.imul(h, FNV_PRIME) >>> 0;
	}
	return h & 0x7fffffff;
}

/** Pack rich note specs into the `<iffffi>` blob for modify/add. */
export function encodeRichSpecs(specs: RichNoteSpec[]): Uint8Array {
	const out = new Uint8Array(specs.length * RICH_NOTE_STRIDE);
	const view = new DataView(out.buffer);
	for (let i = 0; i < specs.length; i++) {
		const s = specs[i];
		const off = i * RICH_NOTE_STRIDE;
		view.setInt32(off, s.noteId | 0, true);
		view.setFloat32(off + 4, s.pitch, true);
		view.setFloat32(off + 8, s.startBeats, true);
		view.setFloat32(off + 12, s.durationBeats, true);
		view.setFloat32(off + 16, s.velocity, true);
		view.setInt32(off + 20, s.mute ? 1 : 0, true);
	}
	return out;
}

// --- own-write echo suppression (plan decision 4) -------------------------

export function markLocalWrite(clipPath: string): void {
	lastLocalWrite.set(clipPath, Date.now());
}

/** True if a `notes/changed` for `clipPath` is likely our own echo. */
export function shouldSuppressReconcile(clipPath: string): boolean {
	const ts = lastLocalWrite.get(clipPath);
	if (ts === undefined) return false;
	return Date.now() - ts < LOCAL_WRITE_SUPPRESS_MS;
}

// --- M4 write -------------------------------------------------------------

/** Delete notes by id. Marks a local write to suppress the echo re-pull. */
export function sendRemoveNotes(clipPath: string, noteIds: number[]): void {
	if (!_editSender || noteIds.length === 0) return;
	markLocalWrite(clipPath);
	// OSC has no array type and the surface codec rejects JS arrays, so
	// ids travel as a little-endian int32 blob (the surface's
	// `_parse_id_list` decodes the blob branch).
	_editSender(V3_CLIP_NOTES_REMOVE_ADDRESS, [clipPath, encodeIdBlob(noteIds)]);
}

/** Pack note ids into a little-endian int32 blob for the wire. */
export function encodeIdBlob(ids: number[]): Uint8Array {
	const out = new Uint8Array(ids.length * 4);
	const view = new DataView(out.buffer);
	ids.forEach((id, i) => view.setInt32(i * 4, id | 0, true));
	return out;
}

/** Decode a little-endian int32 blob into a number[] (for notes/added). */
export function decodeIdBlob(blob: Uint8Array): number[] {
	const usable = Math.floor(blob.length / 4);
	const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
	const out: number[] = new Array(usable);
	for (let i = 0; i < usable; i++) out[i] = view.getInt32(i * 4, true);
	return out;
}

/**
 * Select notes by id in Live's piano roll (M6 editor→Live). Pass an
 * empty array to clear Live's selection. Selection is view state, not a
 * content edit — it does NOT mark a local write (there's no notes/changed
 * echo to suppress) and is fire-and-forget.
 */
export function sendSelectNotes(clipPath: string, noteIds: number[]): void {
	if (!_editSender) return;
	_editSender(V3_CLIP_NOTES_SELECT_ADDRESS, [clipPath, encodeIdBlob(noteIds)]);
}

/** Modify existing notes in place (by id). */
export function sendModifyNotes(clipPath: string, specs: RichNoteSpec[]): void {
	if (!_editSender || specs.length === 0) return;
	markLocalWrite(clipPath);
	_editSender(V3_CLIP_NOTES_MODIFY_ADDRESS, [clipPath, encodeRichSpecs(specs)]);
}

/**
 * Add new notes. Resolves with the real ids the surface assigned (off
 * `add_new_notes`'s return) so the caller can swap its temp ids. Rejects
 * on timeout. The noteId field of each spec is ignored by the surface
 * (Live mints the id), so callers pass a temp negative id.
 */
export function sendAddNotes(clipPath: string, specs: RichNoteSpec[]): Promise<number[]> {
	if (!_editSender) {
		return Promise.reject(new Error('clipRichNotesService: edit sender not configured'));
	}
	if (specs.length === 0) return Promise.resolve([]);
	const requestId = nextRequestId('add');
	markLocalWrite(clipPath);
	const sender = _editSender;
	return new Promise<number[]>((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			pendingAdd.delete(requestId);
			reject(new Error('clipRichNotesService: add timed out'));
		}, REQUEST_TIMEOUT_MS);
		pendingAdd.set(requestId, { resolve, reject, timeoutId });
		try {
			sender(V3_CLIP_NOTES_ADD_ADDRESS, [requestId, clipPath, encodeRichSpecs(specs)]);
		} catch (err) {
			pendingAdd.delete(requestId);
			clearTimeout(timeoutId);
			reject(err as Error);
		}
	});
}

/**
 * Duplicate notes by id (M5) → `clip.duplicate_notes_by_id`. Resolves
 * with the new ids the surface returns (via the shared `notes/added`
 * reply), so the caller can select the copies. Same request/reply
 * machinery as add.
 */
export function sendDuplicateNotes(clipPath: string, noteIds: number[]): Promise<number[]> {
	if (!_editSender) {
		return Promise.reject(new Error('clipRichNotesService: edit sender not configured'));
	}
	if (noteIds.length === 0) return Promise.resolve([]);
	const requestId = nextRequestId('dup');
	markLocalWrite(clipPath);
	const sender = _editSender;
	return new Promise<number[]>((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			pendingAdd.delete(requestId);
			reject(new Error('clipRichNotesService: duplicate timed out'));
		}, REQUEST_TIMEOUT_MS);
		pendingAdd.set(requestId, { resolve, reject, timeoutId });
		try {
			sender(V3_CLIP_NOTES_DUPLICATE_ADDRESS, [requestId, clipPath, encodeIdBlob(noteIds)]);
		} catch (err) {
			pendingAdd.delete(requestId);
			clearTimeout(timeoutId);
			reject(err as Error);
		}
	});
}

/** Inbound `/looping/v3/clip/notes/added` handler. */
export function handleNotesAdded(args: {
	requestId: string;
	clipPath: string;
	newIds: number[];
}): void {
	const entry = pendingAdd.get(args.requestId);
	if (!entry) return;
	pendingAdd.delete(args.requestId);
	clearTimeout(entry.timeoutId);
	// Refresh the suppression window — the surface's notes/changed for
	// this add lands right about now.
	markLocalWrite(args.clipPath);
	entry.resolve(args.newIds);
}

/** Test helper — clear all in-flight state. */
export function __resetClipRichNotesServiceForTests(): void {
	for (const [, e] of pending) clearTimeout(e.timeoutId);
	for (const [, e] of pendingAdd) clearTimeout(e.timeoutId);
	pending.clear();
	pendingAdd.clear();
	inflightByClipPath.clear();
	lastLocalWrite.clear();
	_seq = 0;
}

/** Re-export for handler wiring symmetry with clipNotesService. */
export { toUint8Array };
