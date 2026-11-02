/**
 * The browser demo (ADR-502): the real interface, with Live replaced by the
 * screenshot harness's mock surface running in the page.
 *
 * Nothing in the app knows. `installDemo()` swaps three globals before the
 * layout dials Live, exactly the seams the harness intercepts from outside:
 *
 * - `WebSocket` → `DemoWebSocket`, an in-page socket whose other end is
 *   `createMockEngine` (`scripts/shot/mock-engine.mjs`), the same protocol
 *   code `npm run shot` serves over a real socket. One implementation, so the
 *   demo and the harness cannot drift.
 * - `fetch` → answers `/api/*` (the interface server's routes, which a static
 *   build has none of) from the harness's committed fixtures.
 * - `EventSource` → removed: `placesLive` does nothing without one.
 *
 * Built only when `VITE_VAMP_DEMO=1` (`npm run demo`, `npm run demo:build`);
 * `hooks.client.ts` imports this behind that flag, so the shipped app has
 * none of it.
 */

import { createMockEngine } from '$shot/mock-engine.mjs';
import { buildDefaultScene } from '$shot/scene.mjs';
import { logger } from '$lib/utils/logger';
import { demoApiResponse } from './api';

type Engine = ReturnType<typeof createMockEngine>;
type EngineClient = ReturnType<Engine['connect']>;

let engine: Engine | null = null;

/** Every demo socket shares one engine, so a reconnect finds the same set. */
function getEngine(): Engine {
	if (!engine) {
		engine = createMockEngine({
			scene: buildDefaultScene(),
			live: true,
			log: (m: string) => logger.debug(`[demo] ${m}`)
		});
	}
	return engine;
}

/**
 * Enough of the `WebSocket` interface for `WebSocketConnection.ts`: the four
 * `on*` handlers, `readyState` and its constants, `send` and `close`.
 *
 * Delivery is asynchronous in both directions, as a real socket's is: the
 * engine's on-connect messages are queued and land after `onopen` has
 * installed the client's handlers, and a send reaches the engine on a later
 * turn, so the outbound batcher's coalescing behaves as it does on the wire.
 */
class DemoWebSocket extends EventTarget {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	readonly CONNECTING = 0;
	readonly OPEN = 1;
	readonly CLOSING = 2;
	readonly CLOSED = 3;

	readonly url: string;
	readyState = 0;
	binaryType: BinaryType = 'blob';
	bufferedAmount = 0;
	extensions = '';
	protocol = '';
	onopen: ((ev: Event) => void) | null = null;
	onmessage: ((ev: MessageEvent) => void) | null = null;
	onclose: ((ev: CloseEvent) => void) | null = null;
	onerror: ((ev: Event) => void) | null = null;

	private client: EngineClient | null = null;
	private inbox: string[] = [];
	private draining = false;

	constructor(url: string | URL) {
		super();
		this.url = String(url);
		setTimeout(() => {
			if (this.readyState !== 0) return;
			this.readyState = 1;
			// The engine's side of the socket: what it sends is queued for
			// this page.
			const socket = this;
			const peer = {
				OPEN: 1,
				get readyState() {
					return socket.readyState;
				},
				send: (text: string) => socket.deliver(text)
			};
			this.client = getEngine().connect(peer);
			this.fire('open', new Event('open'));
		}, 0);
	}

	send(data: string): void {
		if (this.readyState !== 1) throw new DOMException('WebSocket is not open', 'InvalidStateError');
		const text = String(data);
		setTimeout(() => this.client?.receive(text), 0);
	}

	close(code = 1000, reason = ''): void {
		if (this.readyState >= 2) return;
		this.readyState = 3;
		this.client?.close();
		this.client = null;
		setTimeout(() => this.fire('close', new CloseEvent('close', { code, reason, wasClean: true })), 0);
	}

	private deliver(text: string) {
		this.inbox.push(text);
		if (this.draining) return;
		this.draining = true;
		setTimeout(() => {
			this.draining = false;
			for (const data of this.inbox.splice(0)) {
				if (this.readyState !== 1) return;
				this.fire('message', new MessageEvent('message', { data }));
			}
		}, 0);
	}

	private fire(type: 'open' | 'message' | 'close' | 'error', ev: Event) {
		const handler = this[`on${type}`] as ((e: Event) => void) | null;
		handler?.call(this, ev);
		this.dispatchEvent(ev);
	}
}

export function installDemo(): void {
	const realFetch = globalThis.fetch.bind(globalThis);
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
		if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
			return demoApiResponse(url);
		}
		return realFetch(input, init);
	}) as typeof fetch;

	(globalThis as { WebSocket: unknown }).WebSocket = DemoWebSocket;
	delete (globalThis as { EventSource?: unknown }).EventSource;
	logger.info('[demo] Vamp is running against the in-page mock surface');
}
