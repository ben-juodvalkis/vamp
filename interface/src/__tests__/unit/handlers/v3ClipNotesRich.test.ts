/**
 * v3ClipNotesRich handler — clip-view-mirror M3 + M4.
 *
 * Routes the rich begin/chunk/end read sequence and the add reply into
 * clipRichNotesService. Verifies address matching, arity guards, blob
 * normalisation, and the hex-checksum parse end-to-end (a full
 * begin→chunk→end through the handler resolves a pending request).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
	V3_CLIP_NOTES_RICH_BEGIN_ADDRESS,
	V3_CLIP_NOTES_RICH_CHUNK_ADDRESS,
	V3_CLIP_NOTES_RICH_END_ADDRESS,
	V3_CLIP_NOTES_ADDED_ADDRESS,
	handleV3ClipNotesRich,
	isV3ClipNotesRichAddress
} from '$lib/api/handlers/v3ClipNotesRich';
import {
	__resetClipRichNotesServiceForTests,
	requestRichNotes,
	sendAddNotes,
	setRichGetSender,
	setRichEditSender,
	computeRichBlobChecksum,
	encodeRichSpecs,
	type RichNoteSpec
} from '$lib/services/clipRichNotesService';

const CLIP = 'tracks/0/slots/0/clip';

describe('v3ClipNotesRich handler', () => {
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

	it('isV3ClipNotesRichAddress matches the four addresses', () => {
		expect(isV3ClipNotesRichAddress(V3_CLIP_NOTES_RICH_BEGIN_ADDRESS)).toBe(true);
		expect(isV3ClipNotesRichAddress(V3_CLIP_NOTES_RICH_CHUNK_ADDRESS)).toBe(true);
		expect(isV3ClipNotesRichAddress(V3_CLIP_NOTES_RICH_END_ADDRESS)).toBe(true);
		expect(isV3ClipNotesRichAddress(V3_CLIP_NOTES_ADDED_ADDRESS)).toBe(true);
		expect(isV3ClipNotesRichAddress('/looping/v3/clip/notes')).toBe(false);
	});

	it('routes a full begin→chunk→end sequence and resolves', async () => {
		const specs: RichNoteSpec[] = [
			{ noteId: 1, pitch: 60, startBeats: 0, durationBeats: 0.5, velocity: 100, mute: false }
		];
		const blob = encodeRichSpecs(specs);
		const checksumHex = '0x' + (computeRichBlobChecksum(blob) >>> 0).toString(16).padStart(8, '0');

		const p = requestRichNotes(CLIP);
		const reqId = getSender.mock.calls.at(-1)?.[1] as string;

		handleV3ClipNotesRich(V3_CLIP_NOTES_RICH_BEGIN_ADDRESS, [reqId, CLIP, 1, 1]);
		// Blob delivered as the bridge's JSON Buffer shape.
		handleV3ClipNotesRich(V3_CLIP_NOTES_RICH_CHUNK_ADDRESS, [
			reqId,
			0,
			{ type: 'Buffer', data: Array.from(blob) } as never
		]);
		handleV3ClipNotesRich(V3_CLIP_NOTES_RICH_END_ADDRESS, [reqId, checksumHex]);

		await expect(p).resolves.toEqual([
			{ noteId: 1, pitch: 60, startBeats: 0, durationBeats: 0.5, velocity: 100, mute: false }
		]);
	});

	it('routes notes/added into the pending add', async () => {
		const p = sendAddNotes(CLIP, [
			{ noteId: -1, pitch: 72, startBeats: 0, durationBeats: 0.25, velocity: 100, mute: false }
		]);
		const reqId = (editSender.mock.calls.at(-1)?.[1] as unknown[])[0] as string;
		// Real wire shape: ids as a little-endian int32 blob (Buffer JSON shape).
		const idBlob = Array.from(new Uint8Array(new Int32Array([8001]).buffer));
		handleV3ClipNotesRich(V3_CLIP_NOTES_ADDED_ADDRESS, [
			reqId,
			CLIP,
			{ type: 'Buffer', data: idBlob } as never
		]);
		await expect(p).resolves.toEqual([8001]);
	});

	it('drops malformed (short-arity) messages without throwing', () => {
		expect(() => handleV3ClipNotesRich(V3_CLIP_NOTES_RICH_BEGIN_ADDRESS, [CLIP])).not.toThrow();
		expect(() => handleV3ClipNotesRich(V3_CLIP_NOTES_RICH_CHUNK_ADDRESS, ['r'])).not.toThrow();
		expect(() => handleV3ClipNotesRich(V3_CLIP_NOTES_RICH_END_ADDRESS, ['r'])).not.toThrow();
		expect(() => handleV3ClipNotesRich(V3_CLIP_NOTES_ADDED_ADDRESS, ['r'])).not.toThrow();
	});
});
