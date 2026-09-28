/**
 * clipSampleService — ADR-415.
 *
 * The client half of `clip/sample/get` → `clip/sample`. The surface
 * half is pinned by `surface/tests/test_clips_sample_get.py`;
 * this covers what the UI does with the answer, which is where the
 * behaviour is subtle:
 *
 *  - single-flight per clipPath, then cached
 *  - a MIDI reply and an audio reply with an empty path are both
 *    REPLIES, not errors — but only one of them is cacheable
 *  - `reset()` must settle in-flight promises, not strand them
 *  - errors reject by clipPath, which only works when a path was sent
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
	handleSampleError,
	handleSampleReply,
	invalidateSample,
	peekSample,
	requestSample,
	resetClipSampleService,
	setSampleSender,
	type SampleSender
} from '$lib/services/clipSampleService';

const PATH = 'tracks/0/slots/2/clip';

describe('clipSampleService', () => {
	let sender: Mock<SampleSender>;
	/** requestIds the sender was handed, in call order. */
	const idsSent = () => sender.mock.calls.map(([, requestId]) => requestId);

	beforeEach(() => {
		vi.useFakeTimers();
		resetClipSampleService();
		sender = vi.fn<SampleSender>();
		setSampleSender(sender);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('request lifecycle', () => {
		it('sends [requestId, clipPath] and resolves on the matching reply', async () => {
			const promise = requestSample(PATH);
			expect(sender).toHaveBeenCalledTimes(1);
			const [sentPath, requestId] = sender.mock.calls[0];
			expect(sentPath).toBe(PATH);

			handleSampleReply({
				requestId,
				clipPath: PATH,
				isAudioClip: true,
				filePath: '/S/kick.wav'
			});

			await expect(promise).resolves.toEqual({
				isAudioClip: true,
				filePath: '/S/kick.wav',
				fileStartBeats: 0,
				fileEndBeats: 0
			});
		});

		it('carries the file span — where the take sits in clip time', async () => {
			// The rig's Bass take (2026-09-18): beats 0..28, looping 16..24.
			const promise = requestSample(PATH);
			const [, requestId] = sender.mock.calls[0];
			handleSampleReply({
				requestId,
				clipPath: PATH,
				isAudioClip: true,
				filePath: '/Rec/Bass 0001.aif',
				fileStartBeats: 0,
				fileEndBeats: 28
			});
			await expect(promise).resolves.toEqual({
				isAudioClip: true,
				filePath: '/Rec/Bass 0001.aif',
				fileStartBeats: 0,
				fileEndBeats: 28
			});
			expect(peekSample(PATH)?.fileEndBeats).toBe(28);
		});

		it('is single-flight per clipPath — concurrent asks share one round-trip', async () => {
			const a = requestSample(PATH);
			const b = requestSample(PATH);
			expect(sender).toHaveBeenCalledTimes(1);
			expect(a).toBe(b);

			handleSampleReply({
				requestId: idsSent()[0],
				clipPath: PATH,
				isAudioClip: true,
				filePath: '/S/kick.wav'
			});
			await expect(a).resolves.toEqual({ isAudioClip: true, filePath: '/S/kick.wav', fileStartBeats: 0, fileEndBeats: 0 });
		});

		it('rejects on timeout', async () => {
			const promise = requestSample(PATH);
			const assertion = expect(promise).rejects.toThrow(/timed out/);
			vi.advanceTimersByTime(5000);
			await assertion;
		});

		it('rejects when no sender is configured', async () => {
			// @ts-expect-error — deliberately clearing the wiring.
			setSampleSender(null);
			await expect(requestSample(PATH)).rejects.toThrow(/sender not configured/);
		});

		it('rejects an empty clipPath without touching the wire', async () => {
			await expect(requestSample('')).rejects.toThrow(/empty clipPath/);
			expect(sender).not.toHaveBeenCalled();
		});
	});

	describe('caching', () => {
		it('serves a second ask from cache without a second round-trip', async () => {
			const first = requestSample(PATH);
			handleSampleReply({
				requestId: idsSent()[0],
				clipPath: PATH,
				isAudioClip: true,
				filePath: '/S/kick.wav'
			});
			await first;

			await expect(requestSample(PATH)).resolves.toEqual({
				isAudioClip: true,
				filePath: '/S/kick.wav',
				fileStartBeats: 0,
				fileEndBeats: 0
			});
			expect(sender).toHaveBeenCalledTimes(1);
			expect(peekSample(PATH)).toEqual({ isAudioClip: true, filePath: '/S/kick.wav', fileStartBeats: 0, fileEndBeats: 0 });
		});

		it('caches a MIDI reply — isAudioClip:false is a final answer', async () => {
			const promise = requestSample(PATH);
			handleSampleReply({
				requestId: idsSent()[0],
				clipPath: PATH,
				isAudioClip: false,
				filePath: ''
			});
			await expect(promise).resolves.toEqual({ isAudioClip: false, filePath: '', fileStartBeats: 0, fileEndBeats: 0 });
			expect(peekSample(PATH)).toEqual({ isAudioClip: false, filePath: '', fileStartBeats: 0, fileEndBeats: 0 });
		});

		it('does NOT cache an audio reply with an empty path', async () => {
			// Live reports no path while a recording is still flushing to
			// disk. Caching that would freeze the cell blank forever: the
			// clipPath never changes, so nothing would ever re-query.
			const promise = requestSample(PATH);
			handleSampleReply({
				requestId: idsSent()[0],
				clipPath: PATH,
				isAudioClip: true,
				filePath: ''
			});

			// It still RESOLVES — the cell draws a chip now, not an error.
			await expect(promise).resolves.toEqual({ isAudioClip: true, filePath: '', fileStartBeats: 0, fileEndBeats: 0 });
			expect(peekSample(PATH)).toBeUndefined();

			// ...and the next ask really goes back to the surface.
			// Left unsettled on purpose; `reset()` in beforeEach rejects it.
			requestSample(PATH).catch(() => {});
			expect(sender).toHaveBeenCalledTimes(2);
		});

		it('invalidateSample drops one entry so the next ask re-queries', async () => {
			const promise = requestSample(PATH);
			handleSampleReply({
				requestId: idsSent()[0],
				clipPath: PATH,
				isAudioClip: true,
				filePath: '/S/kick.wav'
			});
			await promise;
			expect(peekSample(PATH)).toBeDefined();

			invalidateSample(PATH);

			expect(peekSample(PATH)).toBeUndefined();
			// Left unsettled on purpose; `reset()` in beforeEach rejects it.
			requestSample(PATH).catch(() => {});
			expect(sender).toHaveBeenCalledTimes(2);
		});

		it('caches a late reply that arrives after its request timed out', async () => {
			const promise = requestSample(PATH);
			const assertion = expect(promise).rejects.toThrow(/timed out/);
			vi.advanceTimersByTime(5000);
			await assertion;

			// The answer is still correct even though nobody is waiting.
			handleSampleReply({
				requestId: idsSent()[0],
				clipPath: PATH,
				isAudioClip: true,
				filePath: '/S/kick.wav'
			});
			expect(peekSample(PATH)).toEqual({ isAudioClip: true, filePath: '/S/kick.wav', fileStartBeats: 0, fileEndBeats: 0 });
		});
	});

	describe('errors', () => {
		it('rejects the pending request for the errored clipPath', async () => {
			const promise = requestSample(PATH);
			handleSampleError({ clipPath: PATH, code: 'clip-not-present' });
			await expect(promise).rejects.toThrow(/clip-not-present/);
		});

		it('leaves other paths pending', async () => {
			const other = 'tracks/1/slots/0/clip';
			const a = requestSample(PATH);
			const b = requestSample(other);

			handleSampleError({ clipPath: PATH, code: 'clip-not-present' });
			await expect(a).rejects.toThrow(/clip-not-present/);

			handleSampleReply({
				requestId: idsSent()[1],
				clipPath: other,
				isAudioClip: false,
				filePath: ''
			});
			await expect(b).resolves.toEqual({ isAudioClip: false, filePath: '', fileStartBeats: 0, fileEndBeats: 0 });
		});

		it('cannot match an error carrying no clipPath — request falls back to its timeout', async () => {
			// `_check_arg_count` on the surface emits `path=""`, and an
			// empty path can never match a pending entry. Pinning the
			// consequence so the 5s fallback stays a deliberate choice.
			const promise = requestSample(PATH);
			handleSampleError({ clipPath: '', code: 'write-rejected' });

			const assertion = expect(promise).rejects.toThrow(/timed out/);
			vi.advanceTimersByTime(5000);
			await assertion;
		});
	});

	describe('reset', () => {
		it('rejects in-flight promises rather than stranding them', async () => {
			// Clearing the timeout removes the only other path that could
			// settle these, so dropping the entry would leave every waiting
			// SlotCell on a promise that never resolves OR rejects.
			const promise = requestSample(PATH);
			const assertion = expect(promise).rejects.toThrow(/reset before reply/);

			resetClipSampleService();
			await assertion;

			// And the abandoned timeout must not fire afterwards.
			expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
		});

		it('clears the cache', async () => {
			const promise = requestSample(PATH);
			handleSampleReply({
				requestId: idsSent()[0],
				clipPath: PATH,
				isAudioClip: true,
				filePath: '/S/kick.wav'
			});
			await promise;
			expect(peekSample(PATH)).toBeDefined();

			resetClipSampleService();
			expect(peekSample(PATH)).toBeUndefined();
		});
	});
});
