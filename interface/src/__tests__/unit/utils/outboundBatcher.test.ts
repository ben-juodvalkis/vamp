/**
 * Outbound (UI→Surf) command coalescing.
 *
 * `WebSocketConnection.send` used to emit one WebSocket frame per
 * call, so anything writing in a loop produced a burst of frames that
 * were always going to leave in the same event-loop turn anyway. The
 * canonical case is `trackColoring.applyAutoColorOnPrepareAck`: track
 * colour plus one message per clip, so a preset load onto an 8-clip
 * track was 9 frames.
 *
 * Two units, both pure:
 * - `createOutboundBatcher` — queue mechanics, no socket knowledge.
 * - `buildOutboundFrame` — the raw-vs-envelope decision.
 *
 * The `schedule` hook is injected rather than awaiting real
 * microtasks, so "one turn" is an explicit thing the test controls
 * instead of a timing coincidence.
 */

import { describe, it, expect } from 'vitest';

import {
	createOutboundBatcher,
	type OutboundMessage
} from '$lib/api/connection/outboundBatcher';
import { buildOutboundFrame } from '$lib/api/connection/WebSocketConnection';

/** Collects scheduled flushes so a test can run them as one "turn". */
function manualScheduler() {
	const pendingFlushes: Array<() => void> = [];
	return {
		schedule: (flush: () => void) => pendingFlushes.push(flush),
		runTurn() {
			const due = pendingFlushes.splice(0);
			for (const flush of due) flush();
		},
		scheduledCount: () => pendingFlushes.length
	};
}

function setup() {
	const delivered: OutboundMessage[][] = [];
	const scheduler = manualScheduler();
	const batcher = createOutboundBatcher({
		deliver: (messages) => delivered.push(messages),
		schedule: scheduler.schedule
	});
	return { batcher, delivered, scheduler };
}

describe('createOutboundBatcher', () => {
	it('delivers every send in one turn as a single batch', () => {
		const { batcher, delivered, scheduler } = setup();
		batcher.enqueue({ address: '/looping/v3/track/color', args: ['tracks/0', 9] });
		batcher.enqueue({ address: '/looping/v3/clip/set/color', args: ['c0', 9] });
		batcher.enqueue({ address: '/looping/v3/clip/set/color', args: ['c1', 9] });

		expect(delivered).toHaveLength(0); // nothing before the turn ends
		scheduler.runTurn();

		expect(delivered).toHaveLength(1);
		expect(delivered[0]).toHaveLength(3);
	});

	it('schedules exactly one flush per turn however many sends there are', () => {
		const { batcher, scheduler } = setup();
		for (let i = 0; i < 50; i++) batcher.enqueue({ address: '/x', args: [i] });
		expect(scheduler.scheduledCount()).toBe(1);
	});

	it('preserves FIFO order', () => {
		const { batcher, delivered, scheduler } = setup();
		for (let i = 0; i < 5; i++) batcher.enqueue({ address: '/x', args: [i] });
		scheduler.runTurn();
		expect(delivered[0].map((m) => m.args[0])).toEqual([0, 1, 2, 3, 4]);
	});

	it('does not merge across turns', () => {
		const { batcher, delivered, scheduler } = setup();
		batcher.enqueue({ address: '/a', args: [] });
		scheduler.runTurn();
		batcher.enqueue({ address: '/b', args: [] });
		scheduler.runTurn();

		expect(delivered).toHaveLength(2);
		expect(delivered[0][0].address).toBe('/a');
		expect(delivered[1][0].address).toBe('/b');
	});

	it('never delivers an empty batch', () => {
		const { delivered, scheduler } = setup();
		scheduler.runTurn();
		expect(delivered).toHaveLength(0);
	});

	it('flush() drains without waiting for the scheduled turn', () => {
		const { batcher, delivered } = setup();
		batcher.enqueue({ address: '/a', args: [] });
		batcher.flush();
		expect(delivered).toHaveLength(1);
	});

	it('a second flush after draining is a no-op', () => {
		const { batcher, delivered } = setup();
		batcher.enqueue({ address: '/a', args: [] });
		batcher.flush();
		batcher.flush();
		expect(delivered).toHaveLength(1);
	});

	it('a send made from inside deliver lands in the NEXT batch, not this one', () => {
		// Re-entrancy: a downstream handler that sends while we are
		// draining must not be swallowed into the batch being drained,
		// and must not be lost.
		const delivered: OutboundMessage[][] = [];
		const scheduler = manualScheduler();
		let reentered = false;
		const batcher = createOutboundBatcher({
			deliver: (messages) => {
				delivered.push(messages);
				if (!reentered) {
					reentered = true;
					batcher.enqueue({ address: '/echo', args: [] });
				}
			},
			schedule: scheduler.schedule
		});

		batcher.enqueue({ address: '/a', args: [] });
		scheduler.runTurn();
		expect(delivered).toHaveLength(1);

		scheduler.runTurn();
		expect(delivered).toHaveLength(2);
		expect(delivered[1][0].address).toBe('/echo');
	});

	it('pending() reports the queue depth', () => {
		const { batcher } = setup();
		expect(batcher.pending()).toBe(0);
		batcher.enqueue({ address: '/a', args: [] });
		batcher.enqueue({ address: '/b', args: [] });
		expect(batcher.pending()).toBe(2);
		batcher.flush();
		expect(batcher.pending()).toBe(0);
	});

	it('defaults to queueMicrotask when no scheduler is injected', async () => {
		const delivered: OutboundMessage[][] = [];
		const batcher = createOutboundBatcher({
			deliver: (m) => delivered.push(m)
		});
		batcher.enqueue({ address: '/a', args: [] });
		batcher.enqueue({ address: '/b', args: [] });
		expect(delivered).toHaveLength(0);

		await Promise.resolve();

		expect(delivered).toHaveLength(1);
		expect(delivered[0]).toHaveLength(2);
	});
});

describe('buildOutboundFrame', () => {
	it('ships a lone message raw, with no envelope', () => {
		const frame = buildOutboundFrame([
			{ address: '/looping/v3/track/mute', args: ['tracks/0', 1] }
		]) as { address: string; args: unknown[]; messages?: unknown[] };

		expect(frame.address).toBe('/looping/v3/track/mute');
		expect(frame.messages).toBeUndefined();
		expect(frame.args).toEqual(['tracks/0', 1]);
	});

	it('wraps multiple messages in a /bridge/batch envelope', () => {
		const frame = buildOutboundFrame([
			{ address: '/a', args: [1] },
			{ address: '/b', args: [2] }
		]) as { address: string; source: string; messages: Array<{ address: string }> };

		expect(frame.address).toBe('/bridge/batch');
		expect(frame.source).toBe('ui');
		expect(frame.messages.map((m) => m.address)).toEqual(['/a', '/b']);
	});

	it('returns null for an empty batch rather than an empty envelope', () => {
		expect(buildOutboundFrame([])).toBeNull();
	});

	it('carries argsTypes through the envelope so blobs survive', () => {
		const frame = buildOutboundFrame([
			{ address: '/a', args: [1] },
			{ address: '/b', args: [new Uint8Array([1, 2, 3])] }
		]) as { messages: Array<{ argsTypes: string[]; args: unknown[] }> };

		expect(frame.messages[1].argsTypes).toEqual(['blob']);
		expect(frame.messages[1].args[0]).toEqual({ type: 'Buffer', data: [1, 2, 3] });
	});
});
