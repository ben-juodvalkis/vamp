import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	decodeTable,
	cycleAt,
	tableFrames,
	loadFactoryWavetables,
	resetWavetableCache,
	type WavetableBundle
} from '$lib/utils/wavetableShapes';

/** base64 of signed bytes, the way the bundle step writes them. */
function encode(bytes: number[]): string {
	return btoa(String.fromCharCode(...bytes.map((b) => (b < 0 ? b + 256 : b))));
}

const bundle: WavetableBundle = {
	format: 1,
	note: 42,
	frames: 3,
	points: 4,
	tables: {
		Basics: {
			Ramp: encode([0, 127, 0, -127, 0, 64, 0, -64, 0, 0, 0, 0])
		}
	}
};

describe('wavetableShapes', () => {
	beforeEach(() => resetWavetableCache());

	it('decodes a table into frames of signed samples', () => {
		const frames = decodeTable(bundle, bundle.tables.Basics.Ramp);
		expect(frames).toHaveLength(3);
		expect(Array.from(frames[0])).toEqual([0, 1, 0, -1]);
		expect(frames[1][1]).toBeCloseTo(64 / 127);
		expect(Array.from(frames[2])).toEqual([0, 0, 0, 0]);
	});

	it('refuses a table whose length disagrees with the bundle', () => {
		expect(decodeTable(bundle, encode([1, 2, 3]))).toEqual([]);
	});

	it('blends the two rendered frames either side of a Wave Position', () => {
		const frames = tableFrames(bundle, 'Basics', 'Ramp');
		expect(Array.from(cycleAt(frames, 0)!)).toEqual([0, 1, 0, -1]);
		expect(Array.from(cycleAt(frames, 1)!)).toEqual([0, 0, 0, 0]);
		// Halfway between frame 0 and frame 1.
		expect(cycleAt(frames, 0.25)![1]).toBeCloseTo((1 + 64 / 127) / 2);
		// Out of range clamps.
		expect(Array.from(cycleAt(frames, 2)!)).toEqual([0, 0, 0, 0]);
	});

	it('has no frames for a table it never rendered (a user table)', () => {
		expect(tableFrames(bundle, 'User', 'My Table')).toEqual([]);
		expect(cycleAt([], 0.5)).toBeNull();
	});

	it('fetches the bundle once', async () => {
		const fetchFn = vi.fn(async () => new Response(JSON.stringify(bundle)));
		const [a, b] = await Promise.all([
			loadFactoryWavetables(fetchFn as unknown as typeof fetch),
			loadFactoryWavetables(fetchFn as unknown as typeof fetch)
		]);
		expect(a).toEqual(bundle);
		expect(b).toBe(a);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('answers null and lets a later call retry when the fetch fails', async () => {
		const fail = vi.fn(async () => new Response('', { status: 404 }));
		expect(await loadFactoryWavetables(fail as unknown as typeof fetch)).toBeNull();
		const ok = vi.fn(async () => new Response(JSON.stringify(bundle)));
		expect(await loadFactoryWavetables(ok as unknown as typeof fetch)).toEqual(bundle);
	});
});
