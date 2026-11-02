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
import { buildDemoScene } from '$shot/demo-scene.mjs';
import { demoPreset } from '$shot/demo-catalog.mjs';
import { logger } from '$lib/utils/logger';
import { CENTRAL_VIEW_REGISTRY } from '$lib/components/v6/central/viewRegistry';
import { demoApiResponse } from './api';
import { describePress, describeWrite, FIRST_HINT } from './hints';

type Engine = ReturnType<typeof createMockEngine>;
type EngineClient = ReturnType<Engine['connect']>;

let engine: Engine | null = null;

/** `uiPrefsStore`'s clip-grid switch (`scripts/shot/views.mjs`). */
const SESSION_MODE_KEY = 'uiPrefsStore.sessionMode';

/** Every demo socket shares one engine, so a reconnect finds the same set. */
function getEngine(): Engine {
	if (!engine) {
		const scene = buildDemoScene();
		engine = createMockEngine({
			scene,
			// Every write the page sends: the hint line names what it touched.
			onInbound: (address: string, args: unknown[]) => {
				const text = describeWrite(scene, address, args);
				if (text) showHint(text);
			},
			live: true,
			resolvePreset: demoPreset,
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

/** The message the embedding page listens for (benjuodvalkis.com's `vamp-play.svelte`). */
const HINT_MESSAGE = 'vamp-demo-hint';
const framed = (() => {
	try {
		return window.parent !== window;
	} catch {
		return true;
	}
})();
let hintBar: HTMLDivElement | null = null;
let lastHint = '';

/**
 * Put a sentence on the hint line. Framed, it goes to the embedding page,
 * which shows it under the frame; on its own, the demo draws a bar along the
 * bottom of the screen that touches pass through.
 */
function showHint(text: string) {
	if (text === lastHint) return;
	lastHint = text;
	if (framed) {
		window.parent.postMessage({ type: HINT_MESSAGE, text }, '*');
		return;
	}
	if (!hintBar) {
		hintBar = document.createElement('div');
		hintBar.setAttribute('aria-live', 'off');
		Object.assign(hintBar.style, {
			position: 'fixed',
			left: '50%',
			bottom: '6px',
			transform: 'translateX(-50%)',
			maxWidth: 'calc(100% - 24px)',
			padding: '6px 12px',
			borderRadius: '4px',
			background: 'color-mix(in srgb, var(--canvas, #1f2126) 88%, transparent)',
			border: '1px solid var(--line-strong, #0f1013)',
			color: 'var(--foreground, #d3d6db)',
			font: '13px/1.3 ui-sans-serif, system-ui, -apple-system, sans-serif',
			whiteSpace: 'nowrap',
			overflow: 'hidden',
			textOverflow: 'ellipsis',
			pointerEvents: 'none',
			zIndex: '2147483647'
		});
		document.body.appendChild(hintBar);
	}
	hintBar.textContent = text;
}

/**
 * Fetch every central view's code once the demo has drawn. The app loads a
 * view the first time it opens, which costs nothing from the Mac beside the
 * iPad; served over the web, each first tap on a device or a track waited on
 * a download (0.7–1 s measured on benjuodvalkis.com) and looked like the tap
 * had done nothing. One at a time, so the warm-up never competes with a tap.
 */
function warmCentralViews() {
	const { device, instrument, ...rest } = CENTRAL_VIEW_REGISTRY;
	const loaders = [...Object.values(device), ...Object.values(instrument), ...Object.values(rest)];
	void (async () => {
		for (const load of new Set(loaders)) {
			try {
				await load();
			} catch {
				/* offline or a failed chunk: that view loads on its first tap, as in the app */
			}
		}
		logger.debug(`[demo] ${loaders.length} central views loaded ahead of a tap`);
	})();
}

export function installDemo(): void {
	// A host that serves the build's `index.html` only by its own name (a
	// plain static server, Vite's) leaves that name in the address, where the
	// router finds no route. Drop it before the router starts.
	if (location.pathname.endsWith('/index.html')) {
		const path = location.pathname.slice(0, -'index.html'.length);
		history.replaceState(history.state, '', `${path}${location.search}${location.hash}`);
	}

	const realFetch = globalThis.fetch.bind(globalThis);
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
		if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
			return demoApiResponse(url);
		}
		return realFetch(input, init);
	}) as typeof fetch;

	// Open with the clip grid showing, so a visitor has clips to launch (the
	// harness's `session` view). Only when unset: a visitor's own toggle stays.
	try {
		if (localStorage.getItem(SESSION_MODE_KEY) === null) localStorage.setItem(SESSION_MODE_KEY, '1');
	} catch {
		/* storage blocked: the shipped layout, without the grid */
	}

	(globalThis as { WebSocket: unknown }).WebSocket = DemoWebSocket;

	// The hint line: a first sentence once the page has drawn, then one per
	// press that sends nothing (a write names itself through `onInbound`).
	addEventListener(
		'pointerdown',
		(event) => {
			const text = describePress(event.target instanceof Element ? event.target : null);
			if (text) showHint(text);
		},
		{ capture: true, passive: true }
	);
	// Not on `load`, which has usually fired by the time this runs.
	setTimeout(() => {
		if (!lastHint) showHint(FIRST_HINT);
		warmCentralViews();
	}, 1500);
	delete (globalThis as { EventSource?: unknown }).EventSource;
	logger.info('[demo] Vamp is running against the in-page mock surface');
}
