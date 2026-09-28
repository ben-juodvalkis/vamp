/**
 * clipRichNotesService — clip-view-mirror M3 + M4.
 *
 * Covers the rich channel reassembly (begin→chunk→end), checksum
 * verification + mismatch re-reject, blob decode/encode round-trip, the
 * benign-error short-circuit, the M4 edit senders, the own-write echo
 * suppression window, and the add temp-id → real-id reply.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
	__resetClipRichNotesServiceForTests,
	requestRichNotes,
	handleRichBegin,
	handleRichChunk,
	handleRichEnd,
	handleRichError,
	handleNotesAdded,
	decodeRichBlob,
	encodeRichSpecs,
	decodeIdBlob,
	computeRichBlobChecksum,
	setRichGetSender,
	setRichEditSender,
	sendRemoveNotes,
	sendModifyNotes,
	sendAddNotes,
	sendSelectNotes,
	sendDuplicateNotes,
	markLocalWrite,
	shouldSuppressReconcile,
	RICH_NOTE_STRIDE,
	V3_CLIP_NOTES_REMOVE_ADDRESS,
	V3_CLIP_NOTES_MODIFY_ADDRESS,
	V3_CLIP_NOTES_ADD_ADDRESS,
	V3_CLIP_NOTES_SELECT_ADDRESS,
	V3_CLIP_NOTES_RICH_GET_ADDRESS,
	type RichNote,
	type RichNoteSpec
} from '$lib/services/clipRichNotesService';

const CLIP = 'tracks/0/slots/0/clip';

/** Pack notes the way the surface does: <iffffi> little-endian. */
function packRich(notes: RichNote[]): Uint8Array {
	const buf = new ArrayBuffer(notes.length * RICH_NOTE_STRIDE);
	const view = new DataView(buf);
	notes.forEach((n, i) => {
		const off = i * RICH_NOTE_STRIDE;
		view.setInt32(off, n.noteId, true);
		view.setFloat32(off + 4, n.pitch, true);
		view.setFloat32(off + 8, n.startBeats, true);
		view.setFloat32(off + 12, n.durationBeats, true);
		view.setFloat32(off + 16, n.velocity, true);
		view.setInt32(off + 20, n.mute ? 1 : 0, true);
	});
	return new Uint8Array(buf);
}

const NOTES: RichNote[] = [
	{ noteId: 1001, pitch: 60, startBeats: 0, durationBeats: 0.5, velocity: 100, mute: false },
	{ noteId: 1002, pitch: 64, startBeats: 0.5, durationBeats: 0.25, velocity: 80, mute: true },
	{ noteId: 1003, pitch: 67, startBeats: 1, durationBeats: 1, velocity: 120, mute: false }
];

describe('clipRichNotesService', () => {
	let getSender: ReturnType<typeof vi.fn>;
	let editSender: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		__resetClipRichNotesServiceForTests();
		getSender = vi.fn();
		editSender = vi.fn();
		setRichGetSender(getSender as never);
		setRichEditSender(editSender as never);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('encode/decode round-trip', () => {
		it('encodeRichSpecs → decodeRichBlob preserves all fields', () => {
			const blob = encodeRichSpecs(NOTES as RichNoteSpec[]);
			expect(blob.length).toBe(NOTES.length * RICH_NOTE_STRIDE);
			const decoded = decodeRichBlob(blob, NOTES.length);
			expect(decoded).toEqual(NOTES);
		});

		it('decodes empty blob to []', () => {
			expect(decodeRichBlob(new Uint8Array(0), 0)).toEqual([]);
		});
	});

	describe('checksum', () => {
		it('matches the surface FNV-1a over the blob bytes', () => {
			const blob = packRich(NOTES);
			// Recompute via an independent FNV-1a to confirm the impl.
			let h = 0x811c9dc5;
			for (let i = 0; i < blob.length; i++) {
				h ^= blob[i] & 0xff;
				h = Math.imul(h, 0x01000193) >>> 0;
			}
			expect(computeRichBlobChecksum(blob)).toBe(h & 0x7fffffff);
		});
	});

	describe('rich/get reassembly', () => {
		function lastRequestId(): string {
			return getSender.mock.calls.at(-1)?.[1] as string;
		}

		it('resolves with reassembled+checksum-verified notes', async () => {
			const p = requestRichNotes(CLIP);
			const reqId = lastRequestId();
			const blob = packRich(NOTES);
			// Two chunks: first 2 notes, last note.
			const c0 = blob.slice(0, 2 * RICH_NOTE_STRIDE);
			const c1 = blob.slice(2 * RICH_NOTE_STRIDE);
			handleRichBegin({ requestId: reqId, clipPath: CLIP, count: 3, totalChunks: 2 });
			handleRichChunk({ requestId: reqId, chunkIndex: 0, blob: c0 });
			handleRichChunk({ requestId: reqId, chunkIndex: 1, blob: c1 });
			handleRichEnd({ requestId: reqId, checksum: computeRichBlobChecksum(blob) });
			await expect(p).resolves.toEqual(NOTES);
		});

		it('empty clip (zero chunks) resolves with []', async () => {
			const p = requestRichNotes(CLIP);
			const reqId = lastRequestId();
			handleRichBegin({ requestId: reqId, clipPath: CLIP, count: 0, totalChunks: 0 });
			await expect(p).resolves.toEqual([]);
		});

		it('rejects on checksum mismatch', async () => {
			const p = requestRichNotes(CLIP);
			const reqId = lastRequestId();
			const blob = packRich(NOTES);
			handleRichBegin({ requestId: reqId, clipPath: CLIP, count: 3, totalChunks: 1 });
			handleRichChunk({ requestId: reqId, chunkIndex: 0, blob });
			handleRichEnd({ requestId: reqId, checksum: 0xdead });
			await expect(p).rejects.toThrow(/checksum/);
		});

		it('rejects when a chunk is missing at end', async () => {
			const p = requestRichNotes(CLIP);
			const reqId = lastRequestId();
			const blob = packRich(NOTES);
			handleRichBegin({ requestId: reqId, clipPath: CLIP, count: 3, totalChunks: 2 });
			handleRichChunk({ requestId: reqId, chunkIndex: 0, blob: blob.slice(0, 2 * RICH_NOTE_STRIDE) });
			// chunk 1 dropped
			handleRichEnd({ requestId: reqId, checksum: computeRichBlobChecksum(blob) });
			await expect(p).rejects.toThrow(/incomplete/);
		});

		it('single-flights concurrent requests for the same clip', () => {
			requestRichNotes(CLIP);
			requestRichNotes(CLIP);
			expect(getSender).toHaveBeenCalledTimes(1);
		});

		it('times out after 5s', async () => {
			const p = requestRichNotes(CLIP);
			const expectation = expect(p).rejects.toThrow(/timed out/);
			vi.advanceTimersByTime(5001);
			await expectation;
		});
	});

	describe('error mapping', () => {
		it('benign clip-not-midi resolves with []', async () => {
			const p = requestRichNotes(CLIP);
			handleRichError({
				originatingAddress: V3_CLIP_NOTES_RICH_GET_ADDRESS,
				code: 'clip-not-midi',
				clipPath: CLIP
			});
			await expect(p).resolves.toEqual([]);
		});

		it('hard error rejects', async () => {
			const p = requestRichNotes(CLIP);
			handleRichError({
				originatingAddress: V3_CLIP_NOTES_RICH_GET_ADDRESS,
				code: 'write-rejected',
				clipPath: CLIP
			});
			await expect(p).rejects.toThrow(/write-rejected/);
		});
	});

	describe('M4 edit senders', () => {
		it('sendRemoveNotes emits remove + marks a local write', () => {
			sendRemoveNotes(CLIP, [1, 2]);
			expect(editSender).toHaveBeenCalledTimes(1);
			const [addr, args] = editSender.mock.calls[0] as [string, unknown[]];
			expect(addr).toBe(V3_CLIP_NOTES_REMOVE_ADDRESS);
			expect(args[0]).toBe(CLIP);
			// ids travel as a little-endian int32 blob, not a JS array.
			expect(decodeIdBlob(args[1] as Uint8Array)).toEqual([1, 2]);
			expect(shouldSuppressReconcile(CLIP)).toBe(true);
		});

		it('sendRemoveNotes is a no-op for empty ids', () => {
			sendRemoveNotes(CLIP, []);
			expect(editSender).not.toHaveBeenCalled();
		});

		it('sendModifyNotes emits modify with an encoded blob', () => {
			sendModifyNotes(CLIP, [NOTES[0] as RichNoteSpec]);
			expect(editSender).toHaveBeenCalledTimes(1);
			const [addr, args] = editSender.mock.calls[0] as [string, unknown[]];
			expect(addr).toBe(V3_CLIP_NOTES_MODIFY_ADDRESS);
			expect(args[0]).toBe(CLIP);
			const blob = args[1] as Uint8Array;
			expect(decodeRichBlob(blob, 1)).toEqual([NOTES[0]]);
		});

		it('sendSelectNotes emits select with an id blob (no local-write mark)', () => {
			sendSelectNotes(CLIP, [5, 9]);
			expect(editSender).toHaveBeenCalledTimes(1);
			const [addr, args] = editSender.mock.calls[0] as [string, unknown[]];
			expect(addr).toBe(V3_CLIP_NOTES_SELECT_ADDRESS);
			expect(args[0]).toBe(CLIP);
			expect(decodeIdBlob(args[1] as Uint8Array)).toEqual([5, 9]);
			// Selection is view state, not a content edit — it must NOT
			// arm the own-write echo suppression (no notes/changed echo).
			expect(shouldSuppressReconcile(CLIP)).toBe(false);
		});

		it('sendSelectNotes with empty ids sends a clear (deselect)', () => {
			sendSelectNotes(CLIP, []);
			expect(editSender).toHaveBeenCalledTimes(1);
			const [addr, args] = editSender.mock.calls[0] as [string, unknown[]];
			expect(addr).toBe(V3_CLIP_NOTES_SELECT_ADDRESS);
			expect(decodeIdBlob(args[1] as Uint8Array)).toEqual([]);
		});

		it('sendAddNotes resolves with the surface-assigned ids', async () => {
			const tempSpec: RichNoteSpec = {
				noteId: -1,
				pitch: 72,
				startBeats: 2,
				durationBeats: 0.5,
				velocity: 90,
				mute: false
			};
			const p = sendAddNotes(CLIP, [tempSpec]);
			const [addr, args] = editSender.mock.calls[0] as [string, unknown[]];
			expect(addr).toBe(V3_CLIP_NOTES_ADD_ADDRESS);
			const reqId = args[0] as string;
			handleNotesAdded({ requestId: reqId, clipPath: CLIP, newIds: [9001] });
			await expect(p).resolves.toEqual([9001]);
		});

		it('sendAddNotes resolves [] for empty specs without a round-trip', async () => {
			await expect(sendAddNotes(CLIP, [])).resolves.toEqual([]);
			expect(editSender).not.toHaveBeenCalled();
		});

		it('sendDuplicateNotes sends an id blob and resolves the new ids', async () => {
			const p = sendDuplicateNotes(CLIP, [3, 4]);
			const [addr, args] = editSender.mock.calls[0] as [string, unknown[]];
			expect(addr).toBe('/looping/v3/clip/notes/duplicate');
			const reqId = args[0] as string;
			expect(args[1]).toBe(CLIP);
			expect(decodeIdBlob(args[2] as Uint8Array)).toEqual([3, 4]);
			// Duplicate replies on the shared notes/added channel.
			handleNotesAdded({ requestId: reqId, clipPath: CLIP, newIds: [5005, 5006] });
			await expect(p).resolves.toEqual([5005, 5006]);
		});

		it('sendDuplicateNotes resolves [] for empty ids without a round-trip', async () => {
			await expect(sendDuplicateNotes(CLIP, [])).resolves.toEqual([]);
			expect(editSender).not.toHaveBeenCalled();
		});
	});

	describe('own-write echo suppression', () => {
		it('suppresses within the window, allows after', () => {
			markLocalWrite(CLIP);
			expect(shouldSuppressReconcile(CLIP)).toBe(true);
			vi.advanceTimersByTime(500);
			expect(shouldSuppressReconcile(CLIP)).toBe(false);
		});

		it('never suppresses a clip with no local write', () => {
			expect(shouldSuppressReconcile('tracks/9/slots/9/clip')).toBe(false);
		});
	});
});
