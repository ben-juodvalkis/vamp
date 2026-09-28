/**
 * clipSimilarSwap — the clip view's swap pill (ADR-440). A half steps to the
 * neighboring file in Live's ranking of the clip's file and wraps at the
 * list's ends; a step is one request Live answers by id, and the pill stands
 * on the new file only when Live says it swapped; the list follows the clip's
 * file, but nothing read while a step is in flight moves it; and a clip Live
 * cannot rank says why.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const bus = vi.hoisted(() => ({
	listeners: new Set<(message: { address: string; args?: unknown[] }) => void>()
}));

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/api/connection/oscMessageBus', () => ({
	addOscMessageListener: (listener: (message: { address: string; args?: unknown[] }) => void) =>
		bus.listeners.add(listener),
	removeOscMessageListener: (listener: (message: { address: string; args?: unknown[] }) => void) =>
		bus.listeners.delete(listener)
}));

import { send } from '$lib/api/simpleClient';
import {
	clipSimilarSwap,
	slotOfClip,
	type SimilarSamplesAnswer,
	type SwapFileReply
} from '$lib/services/clipSimilarSwap.svelte';

const CLIP = 'tracks/0/slots/2/clip';
const SHAKERS = '/Users/Shared/Music/Samples Organized/Loops/Apple Loops/Drums/Shaker';
const REF = `${SHAKERS}/African Seed Caxixi 02.aiff`;
const NEIGHBORS = [
	`${SHAKERS}/African Seed Caxixi 06.aiff`,
	'/Users/Shared/Music/Samples Organized/Loops/Shaker/Loops/Hi Seed Shaker 120bpm 1_4n Off.wav',
	`${SHAKERS}/African Seed Caxixi 03.aiff`
].map((path) => ({ path, name: path.slice(path.lastIndexOf('/') + 1) }));
const SWAPPED: SwapFileReply = { ok: true, code: '', detail: '' };

let found: string[];
let answers: Map<string, SimilarSamplesAnswer>;
let swaps: Array<[string, string]>;
let forgotten: string[];
let answer: (clipPath: string, filePath: string) => Promise<SwapFileReply>;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const standing = () => {
	const s = clipSimilarSwap.state(CLIP);
	return s?.sounds[s.index]?.path;
};

beforeEach(() => {
	clipSimilarSwap._resetForTests();
	vi.mocked(send).mockClear();
	bus.listeners.clear();
	found = [];
	swaps = [];
	forgotten = [];
	answers = new Map([[REF, { ok: true, neighbors: NEIGHBORS }]]);
	answer = async () => SWAPPED;
	clipSimilarSwap._setForTests({
		find: async (filePath) => {
			found.push(filePath);
			return answers.get(filePath) ?? { ok: false, code: 'not-indexed', detail: 'Live’s index has no entry for this file' };
		},
		swap: (clipPath, filePath) => {
			swaps.push([clipPath, filePath]);
			return answer(clipPath, filePath);
		},
		forget: async (clipPath) => void forgotten.push(clipPath)
	});
});

describe('clipSimilarSwap.sync', () => {
	it('lists the clip’s file first, then Live’s neighbors, and stands on the file', async () => {
		await clipSimilarSwap.sync(CLIP, REF);

		expect(clipSimilarSwap.state(CLIP)).toMatchObject({ status: 'ready', reference: REF, index: 0, working: false });
		expect(clipSimilarSwap.state(CLIP)?.sounds.map((s) => s.name)).toEqual([
			'African Seed Caxixi 02.aiff',
			'African Seed Caxixi 06.aiff',
			'Hi Seed Shaker 120bpm 1_4n Off.wav',
			'African Seed Caxixi 03.aiff'
		]);
	});

	it('says why a clip cannot step', async () => {
		answers.set('/Takes/Take 3.aif', { ok: false, code: 'no-vector', detail: 'Live has not analyzed this file' });
		answers.set('/Takes/Lonely.wav', { ok: true, neighbors: [] });
		const reason = () => clipSimilarSwap.state(CLIP)?.reason?.code;

		await clipSimilarSwap.sync(CLIP, '/Elsewhere/Unindexed.wav');
		expect(clipSimilarSwap.state(CLIP)?.status).toBe('unavailable');
		expect(reason()).toBe('not-indexed');
		await clipSimilarSwap.sync(CLIP, '/Takes/Take 3.aif');
		expect(reason()).toBe('no-vector');
		await clipSimilarSwap.sync(CLIP, '/Takes/Lonely.wav');
		expect(reason()).toBe('no-similar');
		await clipSimilarSwap.sync(CLIP, '');
		expect(reason()).toBe('no-file');
	});

	/**
	 * Swap audit M9. `sync` short-circuited on `ready` and `loading` but not on
	 * `unavailable`, so a file that answered `no-similar` or `not-indexed`
	 * re-ran the whole index scan on every effect re-run — 1.26-1.39 s of
	 * synchronous work on the preview server's only event loop, measured on the
	 * rig 2026-09-15, while `/api/sample-peaks` decodes waveforms on that same
	 * loop.
	 */
	it('does not re-ask for a reference that already answered unavailable', async () => {
		const asked: string[] = [];
		clipSimilarSwap._setForTests({
			find: async (filePath) => {
				asked.push(filePath);
				return { ok: false, code: 'no-similar', detail: 'nothing near it' };
			}
		});

		await clipSimilarSwap.sync(CLIP, REF);
		await clipSimilarSwap.sync(CLIP, REF);
		await clipSimilarSwap.sync(CLIP, REF);

		expect(asked).toEqual([REF]);
		expect(clipSimilarSwap.state(CLIP)).toMatchObject({ status: 'unavailable', reference: REF });

		// A different reference is still asked for.
		await clipSimilarSwap.sync(CLIP, '/Takes/Another.aif');
		expect(asked).toEqual([REF, '/Takes/Another.aif']);
	});

	it('names a request that failed', async () => {
		clipSimilarSwap._setForTests({
			find: async () => {
				throw new Error('Failed to fetch');
			}
		});

		await clipSimilarSwap.sync(CLIP, REF);

		expect(clipSimilarSwap.state(CLIP)).toMatchObject({
			status: 'unavailable',
			reason: { code: 'similar-samples-failed', detail: 'Failed to fetch' }
		});
	});

	it('asks once per file, and a slower answer for an older file never wins', async () => {
		const OTHER = NEIGHBORS[1].path;
		answers.set(OTHER, { ok: true, neighbors: [{ path: REF, name: 'African Seed Caxixi 02.aiff' }] });
		let release!: () => void;
		clipSimilarSwap._setForTests({
			find: async (filePath) => {
				found.push(filePath);
				if (filePath === REF) await new Promise<void>((resolve) => (release = resolve));
				return answers.get(filePath)!;
			}
		});

		const first = clipSimilarSwap.sync(CLIP, REF);
		void clipSimilarSwap.sync(CLIP, REF);
		await clipSimilarSwap.sync(CLIP, OTHER);
		release();
		await first;

		expect(found).toEqual([REF, OTHER]);
		expect(clipSimilarSwap.state(CLIP)).toMatchObject({ status: 'ready', reference: OTHER });
	});

	it('starts a new list for a file changed by other means', async () => {
		await clipSimilarSwap.sync(CLIP, REF);
		const PICKED = `${SHAKERS}/Brazilian Ganza 01.aiff`;
		answers.set(PICKED, { ok: true, neighbors: NEIGHBORS });

		await clipSimilarSwap.sync(CLIP, PICKED);

		expect(found).toEqual([REF, PICKED]);
		expect(clipSimilarSwap.state(CLIP)).toMatchObject({ reference: PICKED, index: 0 });
	});
});

describe('clipSimilarSwap.step', () => {
	it('asks Live to put the neighbor in the clip’s slot, and stands on it once Live says it swapped', async () => {
		await clipSimilarSwap.sync(CLIP, REF);

		await clipSimilarSwap.step(CLIP, 1);

		expect(swaps).toEqual([[CLIP, NEIGHBORS[0].path]]);
		expect(standing()).toBe(NEIGHBORS[0].path);
		expect(clipSimilarSwap.state(CLIP)).toMatchObject({ index: 1, working: false, error: null });
	});

	it('wraps at both ends of the list, so the way back is the other half', async () => {
		await clipSimilarSwap.sync(CLIP, REF);

		await clipSimilarSwap.step(CLIP, -1);
		expect(standing()).toBe(NEIGHBORS[2].path);
		await clipSimilarSwap.step(CLIP, 1);
		expect(standing()).toBe(REF);
	});

	it('lets nothing read during a step move the list, however old the read', async () => {
		await clipSimilarSwap.sync(CLIP, REF);
		await clipSimilarSwap.step(CLIP, 1);
		let landed!: (reply: SwapFileReply) => void;
		answer = () => new Promise((resolve) => (landed = resolve));

		const step = clipSimilarSwap.step(CLIP, 1);
		expect(clipSimilarSwap.inFlight).toBe(CLIP);
		expect(clipSimilarSwap.state(CLIP)?.working).toBe(true);
		await settle();
		// Deleting the focused clip makes the clip view re-read the slot: the
		// old file, a cached answer older than that, and the step's own file.
		await clipSimilarSwap.sync(CLIP, NEIGHBORS[0].path);
		await clipSimilarSwap.sync(CLIP, REF);
		await clipSimilarSwap.sync(CLIP, NEIGHBORS[1].path);
		landed(SWAPPED);
		await step;
		await clipSimilarSwap.sync(CLIP, NEIGHBORS[1].path);

		expect(found).toEqual([REF]);
		expect(standing()).toBe(NEIGHBORS[1].path);
		expect(clipSimilarSwap.inFlight).toBeNull();
	});

	it('drops the cached file for the slot after every step, swapped, refused or unanswered', async () => {
		await clipSimilarSwap.sync(CLIP, REF);

		await clipSimilarSwap.step(CLIP, 1);
		answer = async () => ({ ok: false, code: 'load-failed', detail: 'the old file is back' });
		await clipSimilarSwap.step(CLIP, 1);
		answer = async () => {
			throw new Error('swap-timeout: Live did not answer within 15 s');
		};
		await clipSimilarSwap.step(CLIP, 1);

		expect(forgotten).toEqual([CLIP, CLIP, CLIP]);
	});

	it('stays on the old file when Live refuses, shows why, and can still step', async () => {
		answer = async () => ({
			ok: false,
			code: 'load-failed',
			detail: 'create_audio_clip raised: RuntimeError: cannot read; the old file is back'
		});
		await clipSimilarSwap.sync(CLIP, REF);

		await clipSimilarSwap.step(CLIP, 1);
		expect(clipSimilarSwap.state(CLIP)).toMatchObject({
			index: 0,
			working: false,
			error: 'load-failed: create_audio_clip raised: RuntimeError: cannot read; the old file is back'
		});

		answer = async () => SWAPPED;
		await clipSimilarSwap.step(CLIP, 1);
		expect(clipSimilarSwap.state(CLIP)).toMatchObject({ index: 1, error: null });
	});

	it('stands on the new file when Live swapped it but refused a setting', async () => {
		answer = async () => ({ ok: true, code: '', detail: 'not kept: gain' });
		await clipSimilarSwap.sync(CLIP, REF);

		await clipSimilarSwap.step(CLIP, 1);

		expect(clipSimilarSwap.state(CLIP)).toMatchObject({ index: 1, working: false, error: null });
	});

	it('names a step Live never answered', async () => {
		answer = async () => {
			throw new Error('swap-timeout: Live did not answer within 15 s');
		};
		await clipSimilarSwap.sync(CLIP, REF);

		await clipSimilarSwap.step(CLIP, 1);

		expect(clipSimilarSwap.state(CLIP)).toMatchObject({
			index: 0,
			working: false,
			error: 'swap-timeout: Live did not answer within 15 s'
		});
		expect(clipSimilarSwap.inFlight).toBeNull();
	});

	it('takes one step at a time, and none on a clip it cannot rank', async () => {
		await clipSimilarSwap.sync(CLIP, REF);
		let landed!: (reply: SwapFileReply) => void;
		answer = () => new Promise((resolve) => (landed = resolve));

		const first = clipSimilarSwap.step(CLIP, 1);
		await clipSimilarSwap.step(CLIP, 1);
		await settle();
		landed(SWAPPED);
		await first;
		expect(swaps).toHaveLength(1);

		await clipSimilarSwap.sync('tracks/1/slots/0/clip', '/Elsewhere/Unindexed.wav');
		await clipSimilarSwap.step('tracks/1/slots/0/clip', 1);
		expect(swaps).toHaveLength(1);
	});
});

describe('the swap request', () => {
	it('sends the clip and the file under a request id, and settles on the reply that carries it', async () => {
		clipSimilarSwap._resetForTests();
		clipSimilarSwap._setForTests({
			find: async () => ({ ok: true, neighbors: NEIGHBORS }),
			forget: async () => {}
		});
		await clipSimilarSwap.sync(CLIP, REF);

		const step = clipSimilarSwap.step(CLIP, 1);
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		const [address, args] = vi.mocked(send).mock.calls[0];
		expect(address).toBe('/looping/v3/clip/swap_file');
		expect(args?.slice(1)).toEqual([CLIP, NEIGHBORS[0].path]);

		const reply = (id: unknown, ok: number) =>
			[...bus.listeners].forEach((listener) =>
				listener({ address: '/looping/v3/clip/swap_file/reply', args: [id, ok, '', ''] })
			);
		reply('another-request', 0);
		expect(clipSimilarSwap.state(CLIP)?.working).toBe(true);
		reply(args?.[0], 1);
		await step;

		expect(clipSimilarSwap.state(CLIP)).toMatchObject({ index: 1, working: false, error: null });
		expect(bus.listeners.size).toBe(0);
	});
});

describe('slotOfClip', () => {
	it('reads the track, the slot and its scene off a session clip path', () => {
		expect(slotOfClip('tracks/3/slots/12/clip')).toEqual({
			trackPath: 'tracks/3',
			slotPath: 'tracks/3/slots/12',
			scene: 12
		});
		expect(slotOfClip('tracks/3/slots/12')).toBeNull();
	});
});
