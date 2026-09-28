/**
 * clipNotesService — ADR-360 (Milestone 3).
 *
 * Covers the pull endpoint: request lifecycle (resolve, timeout,
 * error mapping), notes-changed subscription, and the blob decoder
 * (round-trips Python's `<ffff` packing).
 */

import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
	__resetClipNotesServiceForTests,
	decodeNotesBlob,
	handleClipNotesChanged,
	handleNotesError,
	handleNotesReply,
	requestNotes,
	setNotesSender,
	subscribeNotesChanged,
	toUint8Array,
	type NotesSender
} from '$lib/services/clipNotesService';

function packNotesBlob(notes: { pitch: number; start: number; duration: number; velocity: number }[]): Uint8Array {
	// Mirror Python's struct.pack('<ffff', ...) layout — the codec
	// the surface emits.
	const buf = new ArrayBuffer(notes.length * 16);
	const view = new DataView(buf);
	for (let i = 0; i < notes.length; i++) {
		view.setFloat32(i * 16, notes[i].pitch, true);
		view.setFloat32(i * 16 + 4, notes[i].start, true);
		view.setFloat32(i * 16 + 8, notes[i].duration, true);
		view.setFloat32(i * 16 + 12, notes[i].velocity, true);
	}
	return new Uint8Array(buf);
}

describe('clipNotesService', () => {
	let sender: Mock<NotesSender>;

	beforeEach(() => {
		vi.useFakeTimers();
		__resetClipNotesServiceForTests();
		sender = vi.fn<NotesSender>();
		setNotesSender(sender);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('requestNotes', () => {
		it('rejects when sender not configured', async () => {
			__resetClipNotesServiceForTests();
			setNotesSender(undefined as never);
			await expect(requestNotes('tracks/0/slots/0/clip')).rejects.toThrow(/sender/);
		});

		it('rejects on empty clipPath', async () => {
			await expect(requestNotes('')).rejects.toThrow(/empty/);
		});

		it('emits notes/get with a fresh requestId and resolves on reply', async () => {
			const promise = requestNotes('tracks/0/slots/0/clip');
			expect(sender).toHaveBeenCalledTimes(1);
			const [clipPath, requestId] = sender.mock.calls[0] as [string, string];
			expect(clipPath).toBe('tracks/0/slots/0/clip');
			expect(requestId).toMatch(/^notes-/);

			const blob = packNotesBlob([
				{ pitch: 60, start: 0, duration: 0.5, velocity: 100 },
				{ pitch: 64, start: 0.5, duration: 0.25, velocity: 80 }
			]);
			handleNotesReply({ requestId, clipPath, count: 2, blob });

			const notes = await promise;
			expect(notes).toHaveLength(2);
			expect(notes[0].pitch).toBe(60);
			expect(notes[1].velocity).toBe(80);
		});

		it('rejects on 5s timeout', async () => {
			const promise = requestNotes('tracks/0/slots/0/clip');
			vi.advanceTimersByTime(5001);
			await expect(promise).rejects.toThrow(/timed out/);
		});

		it('resolves with [] for clip-not-midi error', async () => {
			const promise = requestNotes('tracks/0/slots/0/clip');
			handleNotesError({
				originatingAddress: '/looping/v3/clip/notes/get',
				code: 'clip-not-midi',
				clipPath: 'tracks/0/slots/0/clip'
			});
			await expect(promise).resolves.toEqual([]);
		});

		it('resolves with [] for clip-not-found error', async () => {
			const promise = requestNotes('tracks/0/slots/0/clip');
			handleNotesError({
				originatingAddress: '/looping/v3/clip/notes/get',
				code: 'clip-not-found',
				clipPath: 'tracks/0/slots/0/clip'
			});
			await expect(promise).resolves.toEqual([]);
		});

		it('rejects on other typed errors', async () => {
			const promise = requestNotes('tracks/0/slots/0/clip');
			handleNotesError({
				originatingAddress: '/looping/v3/clip/notes/get',
				code: 'clip-too-many-notes',
				clipPath: 'tracks/0/slots/0/clip'
			});
			await expect(promise).rejects.toThrow(/clip-too-many-notes/);
		});

		it('ignores errors for a different clipPath', async () => {
			const promise = requestNotes('tracks/0/slots/0/clip');
			handleNotesError({
				originatingAddress: '/looping/v3/clip/notes/get',
				code: 'clip-not-midi',
				clipPath: 'tracks/9/slots/0/clip'
			});
			// Promise still pending; advance timer to confirm it didn't
			// resolve early.
			vi.advanceTimersByTime(100);
			let resolved = false;
			promise.then(() => (resolved = true)).catch(() => (resolved = true));
			await Promise.resolve();
			expect(resolved).toBe(false);
		});

		it('single-flights concurrent calls for the same clipPath', async () => {
			const p1 = requestNotes('tracks/0/slots/0/clip');
			const p2 = requestNotes('tracks/0/slots/0/clip');
			const p3 = requestNotes('tracks/0/slots/0/clip');
			expect(sender).toHaveBeenCalledTimes(1);
			expect(p1).toBe(p2);
			expect(p2).toBe(p3);

			const [, requestId] = sender.mock.calls[0] as [string, string];
			handleNotesReply({
				requestId,
				clipPath: 'tracks/0/slots/0/clip',
				count: 1,
				blob: packNotesBlob([{ pitch: 60, start: 0, duration: 1, velocity: 100 }])
			});
			await expect(p1).resolves.toHaveLength(1);
			await expect(p2).resolves.toHaveLength(1);
			await expect(p3).resolves.toHaveLength(1);
		});

		it('serves a settled clipPath from cache instead of re-asking (ADR-415)', async () => {
			// The session grid remounts a MIDI cell on every row of scene
			// scroll, so re-asking on each mount meant dozens of full blob
			// pulls per drag. Resolved notes are cached; `notes/changed` is
			// what makes them stale (covered below).
			const p1 = requestNotes('tracks/0/slots/0/clip');
			expect(sender).toHaveBeenCalledTimes(1);
			const [, firstId] = sender.mock.calls[0] as [string, string];
			handleNotesReply({
				requestId: firstId,
				clipPath: 'tracks/0/slots/0/clip',
				count: 1,
				blob: packNotesBlob([{ pitch: 60, start: 0, duration: 1, velocity: 100 }])
			});
			await p1;

			await expect(requestNotes('tracks/0/slots/0/clip')).resolves.toHaveLength(1);
			expect(sender).toHaveBeenCalledTimes(1);
		});

		it('re-asks after a notes/changed poke invalidates the cache', async () => {
			const p1 = requestNotes('tracks/0/slots/0/clip');
			const [, firstId] = sender.mock.calls[0] as [string, string];
			handleNotesReply({
				requestId: firstId,
				clipPath: 'tracks/0/slots/0/clip',
				count: 1,
				blob: packNotesBlob([{ pitch: 60, start: 0, duration: 1, velocity: 100 }])
			});
			await p1;
			expect(sender).toHaveBeenCalledTimes(1);

			// Poke with no subscribers mounted: the cache must still drop,
			// or the next mount would paint the pre-edit notes.
			handleClipNotesChanged('tracks/0', 'tracks/0/slots/0/clip');

			const p2 = requestNotes('tracks/0/slots/0/clip');
			expect(sender).toHaveBeenCalledTimes(2);
			expect(p2).not.toBe(p1);
		});

		it('does not collapse different clipPaths', () => {
			void requestNotes('tracks/0/slots/0/clip');
			void requestNotes('tracks/1/slots/0/clip');
			expect(sender).toHaveBeenCalledTimes(2);
		});

		it('clears the in-flight slot on rejection so retries can fire', async () => {
			const p1 = requestNotes('tracks/0/slots/0/clip');
			handleNotesError({
				originatingAddress: '/looping/v3/clip/notes/get',
				code: 'clip-too-many-notes',
				clipPath: 'tracks/0/slots/0/clip'
			});
			await expect(p1).rejects.toThrow();

			const p2 = requestNotes('tracks/0/slots/0/clip');
			expect(sender).toHaveBeenCalledTimes(2);
			expect(p2).not.toBe(p1);
		});
	});

	describe('subscribeNotesChanged', () => {
		it('fires the registered callback on a matching changed event', () => {
			const cb = vi.fn();
			const release = subscribeNotesChanged('tracks/0/slots/0/clip', cb);
			handleClipNotesChanged('tracks/0', 'tracks/0/slots/0/clip');
			expect(cb).toHaveBeenCalledTimes(1);
			release();
		});

		it('ignores changed events for unrelated clip paths', () => {
			const cb = vi.fn();
			subscribeNotesChanged('tracks/0/slots/0/clip', cb);
			handleClipNotesChanged('tracks/9', 'tracks/9/slots/0/clip');
			expect(cb).not.toHaveBeenCalled();
		});

		it('release function removes the subscription', () => {
			const cb = vi.fn();
			const release = subscribeNotesChanged('tracks/0/slots/0/clip', cb);
			release();
			handleClipNotesChanged('tracks/0', 'tracks/0/slots/0/clip');
			expect(cb).not.toHaveBeenCalled();
		});

		it('fires every subscriber on the same clipPath', () => {
			const cb1 = vi.fn();
			const cb2 = vi.fn();
			const cb3 = vi.fn();
			subscribeNotesChanged('tracks/0/slots/0/clip', cb1);
			subscribeNotesChanged('tracks/0/slots/0/clip', cb2);
			subscribeNotesChanged('tracks/0/slots/0/clip', cb3);
			handleClipNotesChanged('tracks/0', 'tracks/0/slots/0/clip');
			expect(cb1).toHaveBeenCalledTimes(1);
			expect(cb2).toHaveBeenCalledTimes(1);
			expect(cb3).toHaveBeenCalledTimes(1);
		});

		it('release removes only the matching subscriber', () => {
			const cb1 = vi.fn();
			const cb2 = vi.fn();
			const release1 = subscribeNotesChanged('tracks/0/slots/0/clip', cb1);
			subscribeNotesChanged('tracks/0/slots/0/clip', cb2);
			release1();
			handleClipNotesChanged('tracks/0', 'tracks/0/slots/0/clip');
			expect(cb1).not.toHaveBeenCalled();
			expect(cb2).toHaveBeenCalledTimes(1);
		});

		it('continues firing remaining subscribers when one throws', () => {
			const cb1 = vi.fn(() => {
				throw new Error('boom');
			});
			const cb2 = vi.fn();
			subscribeNotesChanged('tracks/0/slots/0/clip', cb1);
			subscribeNotesChanged('tracks/0/slots/0/clip', cb2);
			handleClipNotesChanged('tracks/0', 'tracks/0/slots/0/clip');
			expect(cb1).toHaveBeenCalledTimes(1);
			expect(cb2).toHaveBeenCalledTimes(1);
		});

		it('handles a subscriber that unregisters itself during fire', () => {
			let release2: () => void = () => {};
			const cb1 = vi.fn(() => {
				release2();
			});
			const cb2 = vi.fn();
			subscribeNotesChanged('tracks/0/slots/0/clip', cb1);
			release2 = subscribeNotesChanged('tracks/0/slots/0/clip', cb2);
			handleClipNotesChanged('tracks/0', 'tracks/0/slots/0/clip');
			// Snapshot iteration: cb2 still fires this round.
			expect(cb2).toHaveBeenCalledTimes(1);
			handleClipNotesChanged('tracks/0', 'tracks/0/slots/0/clip');
			// On the next fire it's gone.
			expect(cb2).toHaveBeenCalledTimes(1);
		});
	});

	describe('decodeNotesBlob', () => {
		it('round-trips packed float32 notes', () => {
			const blob = packNotesBlob([
				{ pitch: 60, start: 0, duration: 0.5, velocity: 100 },
				{ pitch: 72, start: 0.5, duration: 0.25, velocity: 64 }
			]);
			const decoded = decodeNotesBlob(blob, 2);
			expect(decoded[0]).toEqual({
				pitch: 60,
				startBeats: 0,
				durationBeats: 0.5,
				velocity: 100,
				muted: false
			});
			expect(decoded[1].pitch).toBe(72);
		});

		it('reads a negative velocity as a muted note (ADR-444)', () => {
			const blob = packNotesBlob([
				{ pitch: 60, start: 0, duration: 0.5, velocity: -80 },
				{ pitch: 62, start: 0.5, duration: 0.25, velocity: -0 },
				{ pitch: 64, start: 1, duration: 0.25, velocity: 0 }
			]);
			const decoded = decodeNotesBlob(blob, 3);
			expect(decoded[0]).toMatchObject({ pitch: 60, velocity: 80, muted: true });
			// A muted velocity-0 note arrives as -0: `< 0` misses it, Object.is
			// does not — and the velocity handed on is a plain +0.
			expect(decoded[1]).toMatchObject({ pitch: 62, muted: true });
			expect(Object.is(decoded[1].velocity, 0)).toBe(true);
			expect(decoded[2]).toMatchObject({ pitch: 64, velocity: 0, muted: false });
		});

		it('returns [] on empty blob', () => {
			expect(decodeNotesBlob(new Uint8Array(0), 0)).toEqual([]);
		});
	});

	describe('toUint8Array', () => {
		it('passes through Uint8Array unchanged', () => {
			const arr = new Uint8Array([1, 2, 3]);
			expect(toUint8Array(arr)).toBe(arr);
		});

		it('converts {type:"Buffer", data:[...]} (bridge JSON shape)', () => {
			const obj = { type: 'Buffer', data: [1, 2, 3, 4] };
			const arr = toUint8Array(obj);
			expect(arr).toBeInstanceOf(Uint8Array);
			expect(Array.from(arr)).toEqual([1, 2, 3, 4]);
		});

		it('converts plain number arrays', () => {
			const arr = toUint8Array([0xff, 0x00, 0x42]);
			expect(arr).toBeInstanceOf(Uint8Array);
			expect(Array.from(arr)).toEqual([0xff, 0, 0x42]);
		});

		it('converts integer-keyed object (raw Uint8Array round-tripped through JSON.stringify)', () => {
			// What the bridge actually emits when the OSC parser hands
			// back a plain Uint8Array (no Buffer.toJSON) and the message
			// goes through `JSON.stringify` — every byte becomes a
			// string-keyed numeric property.
			const blob = { '0': 0xde, '1': 0xad, '2': 0xbe, '3': 0xef };
			const arr = toUint8Array(blob);
			expect(arr).toBeInstanceOf(Uint8Array);
			expect(Array.from(arr)).toEqual([0xde, 0xad, 0xbe, 0xef]);
		});

		it('returns empty array on unrecognised input', () => {
			expect(toUint8Array(null).length).toBe(0);
			expect(toUint8Array(undefined).length).toBe(0);
			expect(toUint8Array('string').length).toBe(0);
		});
	});
});
