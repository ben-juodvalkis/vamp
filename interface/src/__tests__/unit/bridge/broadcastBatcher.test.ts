/**
 * Unit tests for the bridge broadcast batcher.
 *
 * Targets `interface/bridge/utils/broadcastBatcher.js`. Imports follow
 * the same relative-path pattern as `messageRouterPrefix.test.ts` — vitest
 * loads the CJS module transparently via ESM interop.
 *
 * Coverage:
 * - single-item windows ship raw (no /bridge/batch envelope)
 * - multi-item windows ship a /bridge/batch envelope, FIFO order
 * - disabled window (BRIDGE_BATCH_WINDOW_MS=0) flushes synchronously
 * - flush() drains pending and cancels the timer
 * - fake timers control the 10ms window deterministically
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBroadcastBatcher } from '../../../../bridge/utils/broadcastBatcher.js';

type Envelope = { address: string; messages?: unknown[]; args?: unknown[] };

interface Batcher {
	enqueue(message: unknown): void;
	flush(): void;
	isBatching(): boolean;
}

describe('broadcastBatcher', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		delete process.env.BRIDGE_BATCH_WINDOW_MS;
	});

	it('ships a single-item window raw, with no envelope', () => {
		const sent: unknown[] = [];
		const batcher: Batcher = createBroadcastBatcher({
			send: (m: unknown) => sent.push(m),
			windowMs: 10
		});

		expect(batcher.isBatching()).toBe(true);

		batcher.enqueue({ address: '/looping/v3/track/meter', args: ['tracks/0', 0.5, 0.3] });
		expect(sent).toHaveLength(0);

		vi.advanceTimersByTime(10);

		expect(sent).toHaveLength(1);
		expect(sent[0]).toEqual({
			address: '/looping/v3/track/meter',
			args: ['tracks/0', 0.5, 0.3]
		});
	});

	it('wraps multi-item windows in a /bridge/batch envelope, FIFO order', () => {
		const sent: Envelope[] = [];
		const batcher: Batcher = createBroadcastBatcher({
			send: (m: unknown) => sent.push(m as Envelope),
			windowMs: 10
		});

		batcher.enqueue({ address: '/looping/v3/track/meter', args: ['tracks/0', 0.5, 0.3] });
		batcher.enqueue({ address: '/looping/v3/track/meter', args: ['tracks/1', 0.4, 0.4] });
		batcher.enqueue({ address: '/looping/v3/master/meter', args: [0.7, 0.7] });

		expect(sent).toHaveLength(0);
		vi.advanceTimersByTime(10);

		expect(sent).toHaveLength(1);
		const env = sent[0];
		expect(env.address).toBe('/bridge/batch');
		expect(env.messages).toHaveLength(3);
		expect((env.messages as Envelope[])[0].address).toBe('/looping/v3/track/meter');
		expect((env.messages as Envelope[])[0].args).toEqual(['tracks/0', 0.5, 0.3]);
		expect((env.messages as Envelope[])[2].address).toBe('/looping/v3/master/meter');
	});

	it('opens a fresh window after each flush', () => {
		const sent: Envelope[] = [];
		const batcher: Batcher = createBroadcastBatcher({
			send: (m: unknown) => sent.push(m as Envelope),
			windowMs: 10
		});

		batcher.enqueue({ address: '/a', args: [] });
		batcher.enqueue({ address: '/b', args: [] });
		vi.advanceTimersByTime(10);

		batcher.enqueue({ address: '/c', args: [] });
		vi.advanceTimersByTime(10);

		expect(sent).toHaveLength(2);
		expect(sent[0].address).toBe('/bridge/batch');
		expect(sent[0].messages).toHaveLength(2);
		// Second window had one item → raw passthrough.
		expect(sent[1].address).toBe('/c');
	});

	it('flush() drains pending and clears the timer', () => {
		const sent: Envelope[] = [];
		const batcher: Batcher = createBroadcastBatcher({
			send: (m: unknown) => sent.push(m as Envelope),
			windowMs: 100
		});

		batcher.enqueue({ address: '/a', args: [] });
		batcher.enqueue({ address: '/b', args: [] });
		batcher.flush();

		expect(sent).toHaveLength(1);
		expect(sent[0].address).toBe('/bridge/batch');
		expect(sent[0].messages).toHaveLength(2);

		// Advance past the original timer — nothing more should arrive.
		vi.advanceTimersByTime(200);
		expect(sent).toHaveLength(1);
	});

	it('flush() with empty queue is a no-op', () => {
		const sent: unknown[] = [];
		const batcher: Batcher = createBroadcastBatcher({
			send: (m: unknown) => sent.push(m),
			windowMs: 10
		});

		batcher.flush();
		expect(sent).toHaveLength(0);
	});

	it('windowMs=0 disables batching — every enqueue flushes synchronously', () => {
		const sent: Envelope[] = [];
		const batcher: Batcher = createBroadcastBatcher({
			send: (m: unknown) => sent.push(m as Envelope),
			windowMs: 0
		});

		expect(batcher.isBatching()).toBe(false);

		batcher.enqueue({ address: '/a', args: [] });
		batcher.enqueue({ address: '/b', args: [] });

		expect(sent).toHaveLength(2);
		expect(sent[0].address).toBe('/a');
		expect(sent[1].address).toBe('/b');
	});
});
