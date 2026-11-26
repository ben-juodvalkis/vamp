/**
 * `oscRequest`: send `[id, ...args]`, settle on the first reply carrying
 * that id on one of the reply addresses, and leave no listener or timer
 * behind either way.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));

import { oscRequest, nextRequestId } from '$lib/api/connection/oscRequest';
import {
	dispatchOscMessage,
	oscMessageListenerCount,
	resetOscMessageBusForTests
} from '$lib/api/connection/oscMessageBus';

describe('oscRequest', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		resetOscMessageBusForTests();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	function start(sent: unknown[][]) {
		return oscRequest<string>({
			address: '/x/do',
			args: ['a', 1],
			replies: ['/x/ok', '/x/err'],
			timeoutMs: 1000,
			send: (_address, args) => sent.push(args),
			onReply: (address, args) =>
				address === '/x/ok' ? { value: String(args[1]) } : { error: new Error(String(args[1])) }
		});
	}

	it('sends the id first and settles on its own reply only', async () => {
		const sent: unknown[][] = [];
		const p = start(sent);
		const [id, ...rest] = sent[0];
		expect(rest).toEqual(['a', 1]);
		dispatchOscMessage({ address: '/x/ok', args: ['someone-else', 'no'] });
		dispatchOscMessage({ address: '/x/other', args: [id, 'no'] });
		dispatchOscMessage({ address: '/x/ok', args: [id, 'yes'] });
		await expect(p).resolves.toBe('yes');
		expect(oscMessageListenerCount()).toBe(0);
	});

	it('rejects on an error reply', async () => {
		const sent: unknown[][] = [];
		const p = start(sent);
		dispatchOscMessage({ address: '/x/err', args: [sent[0][0], 'refused'] });
		await expect(p).rejects.toThrow('refused');
		expect(oscMessageListenerCount()).toBe(0);
	});

	it('times out and removes its listener', async () => {
		const p = start([]);
		vi.advanceTimersByTime(1000);
		await expect(p).rejects.toThrow('/x/do timeout (1000ms)');
		expect(oscMessageListenerCount()).toBe(0);
	});

	it('mints prefixed, distinct ids', () => {
		const a = nextRequestId('notes');
		const b = nextRequestId('notes');
		expect(a).toMatch(/^notes-/);
		expect(a).not.toBe(b);
	});
});
