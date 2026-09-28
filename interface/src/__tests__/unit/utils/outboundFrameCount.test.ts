/**
 * Socket-level proof that a write burst leaves as one frame.
 *
 * `outboundBatcher.test.ts` covers the queue mechanics in isolation.
 * This one drives the real `WebSocketConnection` — real connect path,
 * real `send`, real microtask flush — against a fake WebSocket, and
 * counts frames on the wire.
 *
 * Together with `trackColoring.test.ts`, which pins that
 * `applyAutoColorOnPrepareAck` issues one `send` per clip plus one for
 * the track (`toHaveBeenCalledTimes(3)` on its fixture), this closes
 * the loop on the canonical burst: N synchronous sends there, one
 * frame here. Splitting it across the two layers keeps each test
 * honest about what it actually exercises, and avoids dragging
 * `simpleClient`'s module-load wiring into a socket test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

/** Minimal WebSocket that opens on a macrotask and records frames. */
class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;

	static instances: FakeWebSocket[] = [];

	readyState: number = FakeWebSocket.CONNECTING;
	frames: string[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((e: unknown) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: ((e: unknown) => void) | null = null;

	constructor(public url: string) {
		FakeWebSocket.instances.push(this);
		// Open on a macrotask so the caller can assign `onopen` first —
		// the ordering a real socket gives.
		setTimeout(() => {
			this.readyState = FakeWebSocket.OPEN;
			this.onopen?.();
		}, 0);
	}

	send(data: string) {
		this.frames.push(data);
	}

	close() {
		this.readyState = FakeWebSocket.CLOSED;
		this.onclose?.();
	}
}

/** Connect a fresh module instance and hand back its open socket. */
async function connected() {
	const mod = await import('$lib/api/connection/WebSocketConnection');
	// Not awaited: `connectToLive` resolves off the same handler chain
	// the fake socket's macrotask drives.
	void mod.connectToLive();
	await new Promise((resolve) => setTimeout(resolve, 20));

	const socket = FakeWebSocket.instances.at(-1)!;
	expect(socket.readyState).toBe(FakeWebSocket.OPEN);
	socket.frames.length = 0; // drop handshake traffic
	return { mod, socket };
}

describe('outbound frames on the wire', () => {
	beforeEach(() => {
		FakeWebSocket.instances = [];
		vi.stubGlobal('WebSocket', FakeWebSocket);
		vi.resetModules();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('collapses a 9-message burst into one frame', async () => {
		const { mod, socket } = await connected();

		// The shape `applyAutoColorOnPrepareAck` produces on an 8-clip
		// track: one track colour, then one message per clip.
		mod.send('/looping/v3/track/color', ['tracks/0', 0x00ff00]);
		for (let i = 0; i < 8; i++) {
			mod.send('/looping/v3/clip/set/color', [`tracks/0/slots/${i}/clip`, 0x00ff00]);
		}

		// Nothing on the wire yet — the flush is a microtask.
		expect(socket.frames).toHaveLength(0);

		await Promise.resolve();

		expect(socket.frames).toHaveLength(1);
		const frame = JSON.parse(socket.frames[0]);
		expect(frame.address).toBe('/bridge/batch');
		expect(frame.source).toBe('ui');
		expect(frame.messages).toHaveLength(9);
		expect(frame.messages[0].address).toBe('/looping/v3/track/color');
		expect(frame.messages[8].args).toEqual(['tracks/0/slots/7/clip', 0x00ff00]);
	});

	it('still ships a lone write raw, unchanged from before coalescing', async () => {
		const { mod, socket } = await connected();

		mod.send('/looping/v3/track/mute', ['tracks/0', 1]);
		await Promise.resolve();

		expect(socket.frames).toHaveLength(1);
		const frame = JSON.parse(socket.frames[0]);
		expect(frame.address).toBe('/looping/v3/track/mute');
		expect(frame.args).toEqual(['tracks/0', 1]);
		expect(frame.messages).toBeUndefined();
	});

	it('writes in separate turns stay separate frames', async () => {
		const { mod, socket } = await connected();

		mod.send('/looping/v3/track/mute', ['tracks/0', 1]);
		await Promise.resolve();
		mod.send('/looping/v3/track/solo', ['tracks/0', 1]);
		await Promise.resolve();

		expect(socket.frames).toHaveLength(2);
	});

	it('flushOutboxNow ships without waiting for the microtask', async () => {
		const { mod, socket } = await connected();

		mod.send('/a', [1]);
		mod.send('/b', [2]);
		expect(socket.frames).toHaveLength(0);

		mod.flushOutboxNow();

		expect(socket.frames).toHaveLength(1);
		expect(JSON.parse(socket.frames[0]).messages).toHaveLength(2);
	});

	it('sends made while the socket is closed still reach the wire on reconnect', async () => {
		const { mod, socket } = await connected();

		socket.close();
		mod.send('/looping/v3/track/mute', ['tracks/0', 1]);
		mod.send('/looping/v3/track/solo', ['tracks/0', 1]);
		await Promise.resolve();

		// Nothing on the dead socket — they went to the pre-connection queue.
		expect(socket.frames).toHaveLength(0);

		// The module's own reconnect makes a new socket; let it open and
		// drain the queue.
		await new Promise((resolve) => setTimeout(resolve, 1200));
		const reconnected = FakeWebSocket.instances.at(-1)!;
		expect(reconnected).not.toBe(socket);

		const addresses = reconnected.frames
			.map((f) => JSON.parse(f))
			.flatMap((f) => (f.messages ? f.messages.map((m: { address: string }) => m.address) : [f.address]));
		expect(addresses).toContain('/looping/v3/track/mute');
		expect(addresses).toContain('/looping/v3/track/solo');
	}, 10_000);
});
