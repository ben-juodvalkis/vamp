/**
 * similarSwap — the interface's end of `/looping/v3/drum/swap_similar`
 * (ADR-439 phase 3). One request per press, answered on the reply address
 * under the same request id (replies are per client, but a stale or foreign
 * id must never settle a press); whether a swap is in flight and its named
 * error kept per rack and scope; a refusal or a lost reply is named, never
 * swallowed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
	similarSwap,
	swapScope,
	SWAP_SIMILAR_ADDRESS,
	SWAP_SIMILAR_REPLY_ADDRESS
} from '$lib/services/similarSwap.svelte';
import {
	dispatchOscMessage,
	oscMessageListenerCount,
	resetOscMessageBusForTests
} from '$lib/api/connection/oscMessageBus';

const RACK = 'tracks/1/devices/0';
const KIT_RESULT = { scope: 'kit', direction: 'next', changed: 30, unchanged: 2, pads: [] };
let sent: Array<{ address: string; args: Array<string | number> }> = [];

function lastId(): string {
	return String(sent[sent.length - 1].args[0]);
}

function reply(id: string, ok: number, code = '', detail = '', result: object | null = null): void {
	dispatchOscMessage({
		address: SWAP_SIMILAR_REPLY_ADDRESS,
		args: [id, ok, code, detail, result ? JSON.stringify(result) : '']
	});
}

beforeEach(() => {
	resetOscMessageBusForTests();
	similarSwap._resetForTests();
	sent = [];
	similarSwap._setForTests({ send: (address, args) => void sent.push({ address, args }) });
});

describe('swapScope', () => {
	it('is the kit with nothing scoped and pad:<note> for a pad', () => {
		expect(swapScope(null)).toBe('kit');
		expect(swapScope(38)).toBe('pad:38');
	});
});

describe('similarSwap.run', () => {
	it('sends one request and works until its own reply lands', async () => {
		const run = similarSwap.run(RACK, 'kit', 'next');
		expect(sent).toEqual([{ address: SWAP_SIMILAR_ADDRESS, args: [expect.any(String), RACK, 'kit', 'next'] }]);
		expect(similarSwap.state(RACK, 'kit').working).toBe(true);

		reply('not-this-request', 1, '', '', KIT_RESULT);
		expect(similarSwap.state(RACK, 'kit').working).toBe(true);

		reply(lastId(), 1, '', '', KIT_RESULT);
		await run;
		expect(similarSwap.state(RACK, 'kit')).toEqual({ working: false, error: null });
		expect(oscMessageListenerCount()).toBe(0);
	});

	it('names a refusal, and the next swap that lands clears it', async () => {
		const refused = similarSwap.run(RACK, 'kit', 'next');
		reply(lastId(), 0, 'ax-control-missing', 'kit.swap_next: TrackView.Device[0] has no SwapNext');
		await refused;
		expect(similarSwap.state(RACK, 'kit')).toEqual({
			working: false,
			error: 'ax-control-missing: kit.swap_next: TrackView.Device[0] has no SwapNext'
		});

		const next = similarSwap.run(RACK, 'kit', 'prev');
		expect(similarSwap.state(RACK, 'kit')).toEqual({ working: true, error: null });
		reply(lastId(), 1, '', '', { ...KIT_RESULT, direction: 'prev' });
		await next;
		expect(similarSwap.state(RACK, 'kit')).toEqual({ working: false, error: null });
	});

	it('keeps the kit and each pad apart', async () => {
		const run = similarSwap.run(RACK, 'pad:38', 'prev');
		expect(similarSwap.state(RACK, 'pad:38').working).toBe(true);
		expect(similarSwap.state(RACK, 'kit').working).toBe(false);
		reply(lastId(), 0, 'ax-control-disabled', "pad.swap_prev is disabled in Live's UI");
		await run;
		expect(similarSwap.state(RACK, 'pad:38').error).toMatch(/^ax-control-disabled: /);
		expect(similarSwap.state(RACK, 'kit').error).toBeNull();
		expect(similarSwap.state(RACK, 'pad:36').error).toBeNull();
	});

	it('drops a press while one is still in flight', async () => {
		const run = similarSwap.run(RACK, 'kit', 'next');
		void similarSwap.run(RACK, 'kit', 'next');
		expect(sent).toHaveLength(1);
		reply(lastId(), 1, '', '', KIT_RESULT);
		await run;
	});

	it('names a lost reply and lets go of its listener', async () => {
		similarSwap._setForTests({ timeoutMs: 10 });
		await similarSwap.run(RACK, 'kit', 'prev');
		expect(similarSwap.state(RACK, 'kit').working).toBe(false);
		expect(similarSwap.state(RACK, 'kit').error).toMatch(/^swap-timeout/);
		expect(oscMessageListenerCount()).toBe(0);
	});
});
