/**
 * How the page gets back to the bridge after the iPad's link drops.
 *
 * Drives the real `WebSocketConnection` against a fake WebSocket and fake
 * timers. The cases are the 2026-10-27 rig failure: macOS reset the iPad's
 * USB link for ~30s at a time, the page's socket to the old address neither
 * opened nor errored, and the retry had backed off to 30s.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

/**
 * `mode` decides what a new socket does: `open` opens on a macrotask,
 * `refuse` errors on one (the Mac answered, nothing listening), `hang`
 * does neither (the address has gone away).
 */
class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;

	static instances: FakeWebSocket[] = [];
	static mode: 'open' | 'refuse' | 'hang' = 'open';

	readyState: number = FakeWebSocket.CONNECTING;
	onopen: (() => void) | null = null;
	onmessage: ((e: unknown) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: ((e: unknown) => void) | null = null;

	constructor(public url: string) {
		FakeWebSocket.instances.push(this);
		const mode = FakeWebSocket.mode;
		if (mode === 'hang') return;
		setTimeout(() => {
			if (mode === 'open') {
				this.readyState = FakeWebSocket.OPEN;
				this.onopen?.();
			} else {
				this.onerror?.(new Event('error'));
			}
		}, 0);
	}

	frames: string[] = [];

	send(data: string) {
		this.frames.push(data);
	}

	/** A frame from the bridge. */
	receive(address: string, args: unknown[] = []) {
		this.onmessage?.({ data: JSON.stringify({ address, args }) });
	}

	close() {
		if (this.readyState === FakeWebSocket.CLOSED) return;
		this.readyState = FakeWebSocket.CLOSED;
		this.onclose?.();
	}
}

async function freshModule() {
	return import('$lib/api/connection/WebSocketConnection');
}

/** Connect and have the bridge accept the socket. */
async function accepted(mod: Awaited<ReturnType<typeof freshModule>>) {
	void mod.connectToLive();
	await vi.advanceTimersByTimeAsync(10);
	const socket = FakeWebSocket.instances.at(-1)!;
	socket.receive('/bridge/auth/result', [1]);
	return socket;
}

/** A `fetch` for `/api/ws-auth` that answers each salt when told to. */
function deferredProofs() {
	const pending = new Map<string, (proof: string) => void>();
	vi.stubGlobal(
		'fetch',
		vi.fn((url: string, init?: RequestInit) => {
			const salt = new URL(url, 'http://x').searchParams.get('salt')!;
			return new Promise((resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
				pending.set(salt, (proof) =>
					resolve({ ok: true, json: async () => ({ proof }) } as Response)
				);
			});
		})
	);
	return pending;
}

describe('reconnecting after the link drops', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		FakeWebSocket.instances = [];
		FakeWebSocket.mode = 'open';
		vi.stubGlobal('WebSocket', FakeWebSocket);
		vi.resetModules();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('abandons an attempt that never opens and tries again', async () => {
		FakeWebSocket.mode = 'hang';
		const mod = await freshModule();
		void mod.connectToLive();
		expect(FakeWebSocket.instances).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(4000);
		expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);

		await vi.advanceTimersByTimeAsync(600);
		expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
	});

	it('keeps retrying about every second instead of backing off', async () => {
		FakeWebSocket.mode = 'refuse';
		const mod = await freshModule();
		void mod.connectToLive();

		await vi.advanceTimersByTimeAsync(60_000);
		// Backing off to 30s gave 6 attempts in a minute; every second gives ~60.
		expect(FakeWebSocket.instances.length).toBeGreaterThan(40);
	});

	it('connects again as soon as the network comes back', async () => {
		FakeWebSocket.mode = 'refuse';
		const mod = await freshModule();
		void mod.connectToLive();
		await vi.advanceTimersByTimeAsync(10);
		const before = FakeWebSocket.instances.length;

		FakeWebSocket.mode = 'open';
		window.dispatchEvent(new Event('online'));
		// At once, not on the retry timer. (Module instances from earlier
		// tests are listening too, so this counts "more", not "one more".)
		expect(FakeWebSocket.instances.length).toBeGreaterThan(before);

		await vi.advanceTimersByTimeAsync(10);
		FakeWebSocket.instances.at(-1)!.receive('/bridge/auth/result', [1]);
		expect(mod.isConnected()).toBe(true);
	});

	it('drops a socket that has gone quiet when the page comes back', async () => {
		const mod = await freshModule();
		const quiet = await accepted(mod);
		expect(mod.isConnected()).toBe(true);

		// Seven seconds with nothing from the bridge: past two missed pings,
		// short of the 12s watchdog.
		await vi.advanceTimersByTimeAsync(7000);
		expect(quiet.readyState).toBe(FakeWebSocket.OPEN);

		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));

		expect(quiet.readyState).toBe(FakeWebSocket.CLOSED);
		await vi.advanceTimersByTimeAsync(10);
		expect(FakeWebSocket.instances.at(-1)).not.toBe(quiet);
		FakeWebSocket.instances.at(-1)!.receive('/bridge/auth/result', [1]);
		expect(mod.isConnected()).toBe(true);
	});

	it('leaves a socket that is hearing the bridge alone', async () => {
		const mod = await freshModule();
		const live = await accepted(mod);

		live.onmessage?.({ data: JSON.stringify({ address: '/bridge/ping', args: [1, 0] }) });
		mod.reconnectNow('visible');

		expect(live.readyState).toBe(FakeWebSocket.OPEN);
		expect(FakeWebSocket.instances.at(-1)).toBe(live);
	});

	it('says hello only once the bridge has accepted the socket', async () => {
		deferredProofs();
		const mod = await freshModule();
		const onConnect = vi.fn();
		mod.setConnectionHandler(onConnect);
		void mod.connectToLive();
		await vi.advanceTimersByTimeAsync(10);
		const socket = FakeWebSocket.instances.at(-1)!;

		socket.receive('/bridge/auth/challenge', ['abcdef0123456789']);
		mod.send('/looping/v3/track/mute', ['tracks/0', 1]);
		await vi.advanceTimersByTimeAsync(2000);
		// Open, challenged, not yet accepted: nothing the bridge would refuse.
		expect(onConnect).not.toHaveBeenCalled();
		expect(mod.isConnected()).toBe(false);
		expect(socket.frames.some((f) => f.includes('track/mute'))).toBe(false);

		socket.receive('/bridge/auth/result', [1]);
		expect(onConnect).toHaveBeenCalledTimes(1);
		expect(socket.frames.some((f) => f.includes('track/mute'))).toBe(true);
	});

	it('is ready on its own when the bridge sends no challenge', async () => {
		const mod = await freshModule();
		const onConnect = vi.fn();
		mod.setConnectionHandler(onConnect);
		void mod.connectToLive();
		await vi.advanceTimersByTimeAsync(1010);
		expect(onConnect).toHaveBeenCalledTimes(1);
		expect(mod.isConnected()).toBe(true);
	});

	it("never sends one socket's proof on the next socket", async () => {
		const proofs = deferredProofs();
		const mod = await freshModule();
		void mod.connectToLive();
		await vi.advanceTimersByTimeAsync(10);
		const first = FakeWebSocket.instances.at(-1)!;
		first.receive('/bridge/auth/challenge', ['aaaaaaaaaaaaaaaa']);

		// The link drops while the first proof is still on its way.
		first.close();
		await vi.advanceTimersByTimeAsync(600);
		const second = FakeWebSocket.instances.at(-1)!;
		expect(second).not.toBe(first);
		second.receive('/bridge/auth/challenge', ['bbbbbbbbbbbbbbbb']);

		proofs.get('aaaaaaaaaaaaaaaa')!('proof-for-a');
		proofs.get('bbbbbbbbbbbbbbbb')!('proof-for-b');
		await vi.advanceTimersByTimeAsync(0);

		const sent = second.frames.join('\n');
		expect(sent).toContain('proof-for-b');
		expect(sent).not.toContain('proof-for-a');
	});

	it('gives up on a proof that never comes and tries a fresh socket', async () => {
		deferredProofs(); // never answered
		const mod = await freshModule();
		void mod.connectToLive();
		await vi.advanceTimersByTimeAsync(10);
		const stuck = FakeWebSocket.instances.at(-1)!;
		stuck.receive('/bridge/auth/challenge', ['cccccccccccccccc']);

		await vi.advanceTimersByTimeAsync(3000);
		expect(stuck.readyState).toBe(FakeWebSocket.CLOSED);
		await vi.advanceTimersByTimeAsync(600);
		expect(FakeWebSocket.instances.at(-1)).not.toBe(stuck);
	});

	it('tries a fresh socket when the bridge rejects the proof', async () => {
		const mod = await freshModule();
		void mod.connectToLive();
		await vi.advanceTimersByTimeAsync(10);
		const rejected = FakeWebSocket.instances.at(-1)!;
		rejected.receive('/bridge/auth/result', [0, 'bad-proof']);

		expect(rejected.readyState).toBe(FakeWebSocket.CLOSED);
		await vi.advanceTimersByTimeAsync(600);
		expect(FakeWebSocket.instances.at(-1)).not.toBe(rejected);
	});

	it('an unpaired device shows the pairing screen and stops redialling (ADR-491)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 }) as Response));
		const required = vi.fn();
		window.addEventListener('pairing-required', required);
		const mod = await freshModule();
		void mod.connectToLive();
		await vi.advanceTimersByTimeAsync(10);
		const socket = FakeWebSocket.instances.at(-1)!;
		socket.receive('/bridge/auth/challenge', ['dddddddddddddddd']);
		await vi.advanceTimersByTimeAsync(10);

		expect(required).toHaveBeenCalledTimes(1);
		expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
		const count = FakeWebSocket.instances.length;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(FakeWebSocket.instances.length).toBe(count);
		mod.reconnectNow('online');
		expect(FakeWebSocket.instances.length).toBe(count);
		window.removeEventListener('pairing-required', required);
	});

	it('does nothing before the app has started connecting', async () => {
		const mod = await freshModule();
		mod.reconnectNow('online');
		expect(FakeWebSocket.instances).toHaveLength(0);
	});
});
