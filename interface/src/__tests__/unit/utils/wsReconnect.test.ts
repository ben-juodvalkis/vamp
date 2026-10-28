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

	send() {}

	close() {
		if (this.readyState === FakeWebSocket.CLOSED) return;
		this.readyState = FakeWebSocket.CLOSED;
		this.onclose?.();
	}
}

async function freshModule() {
	return import('$lib/api/connection/WebSocketConnection');
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
		expect(mod.isConnected()).toBe(true);
	});

	it('drops a socket that has gone quiet when the page comes back', async () => {
		const mod = await freshModule();
		void mod.connectToLive();
		await vi.advanceTimersByTimeAsync(10);
		const quiet = FakeWebSocket.instances.at(-1)!;
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
		expect(mod.isConnected()).toBe(true);
	});

	it('leaves a socket that is hearing the bridge alone', async () => {
		const mod = await freshModule();
		void mod.connectToLive();
		await vi.advanceTimersByTimeAsync(10);
		const live = FakeWebSocket.instances.at(-1)!;

		live.onmessage?.({ data: JSON.stringify({ address: '/bridge/ping', args: [1, 0] }) });
		mod.reconnectNow('visible');

		expect(live.readyState).toBe(FakeWebSocket.OPEN);
		expect(FakeWebSocket.instances.at(-1)).toBe(live);
	});

	it('does nothing before the app has started connecting', async () => {
		const mod = await freshModule();
		mod.reconnectNow('online');
		expect(FakeWebSocket.instances).toHaveLength(0);
	});
});
