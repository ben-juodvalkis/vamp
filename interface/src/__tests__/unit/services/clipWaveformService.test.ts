/**
 * clipWaveformService — ADR-360.
 *
 * Covers cache + dedupe + abort behaviour. Uses a stubbed `fetch` so
 * we don't talk to the network.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
	__resetClipWaveformServiceForTests,
	cancelPeaks,
	getPeaks
} from '$lib/services/clipWaveformService';

interface MockResponse {
	peaks: [number, number][];
	bins: number;
}

function mockResponse(payload: MockResponse, ok = true) {
	return {
		ok,
		status: ok ? 200 : 500,
		json: () => Promise.resolve(payload)
	} as Response;
}

describe('clipWaveformService', () => {
	let fetchSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		__resetClipWaveformServiceForTests();
		fetchSpy = vi.fn(() =>
			Promise.resolve(
				mockResponse({
					peaks: [
						[-0.5, 0.5],
						[-0.4, 0.4]
					],
					bins: 2
				})
			)
		);
		vi.stubGlobal('fetch', fetchSpy);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns null on empty filePath without fetching', async () => {
		const result = await getPeaks('', 256);
		expect(result).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('fetches peaks and returns the parsed payload', async () => {
		const result = await getPeaks('/x.wav', 256);
		expect(result).toEqual({ peaks: [[-0.5, 0.5], [-0.4, 0.4]], bins: 2 });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const url = fetchSpy.mock.calls[0][0] as string;
		expect(url).toContain('path=%2Fx.wav');
		expect(url).toContain('bins=256');
	});

	it('serves second call from cache (one fetch)', async () => {
		await getPeaks('/x.wav', 256);
		await getPeaks('/x.wav', 256);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('treats different bin counts as different cache keys', async () => {
		await getPeaks('/x.wav', 256);
		await getPeaks('/x.wav', 1024);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('dedupes concurrent requests for the same key', async () => {
		const [a, b] = await Promise.all([getPeaks('/x.wav', 256), getPeaks('/x.wav', 256)]);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(a).toEqual(b);
	});

	it('returns null on non-OK response', async () => {
		fetchSpy.mockReturnValueOnce(Promise.resolve(mockResponse({ peaks: [], bins: 0 }, false)));
		const result = await getPeaks('/missing.wav', 256);
		expect(result).toBeNull();
	});

	it('returns null on fetch error', async () => {
		fetchSpy.mockReturnValueOnce(Promise.reject(new Error('network')));
		const result = await getPeaks('/x.wav', 256);
		expect(result).toBeNull();
	});

	it('cancelPeaks aborts an inflight request', async () => {
		// Make fetch hang so we can cancel.
		let abortSignal: AbortSignal | undefined;
		fetchSpy.mockImplementationOnce((_url: string, init: RequestInit) => {
			abortSignal = init.signal!;
			return new Promise((_resolve, reject) => {
				init.signal!.addEventListener('abort', () => {
					reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
				});
			});
		});
		const promise = getPeaks('/x.wav', 256);
		cancelPeaks('/x.wav', 256);
		await expect(promise).resolves.toBeNull();
		expect(abortSignal!.aborted).toBe(true);
	});
});
