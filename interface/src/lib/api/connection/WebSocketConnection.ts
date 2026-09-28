/**
 * WebSocket Connection Manager
 *
 * Handles WebSocket connection lifecycle including:
 * - Connection with fallback URLs
 * - Auto-reconnection
 * - Message queuing when disconnected
 * - Connection status tracking
 */

import { logger } from '$lib/utils/logger';
import { createOutboundBatcher, type OutboundMessage } from './outboundBatcher';
import { dispatchOscMessage } from './oscMessageBus';
import type { OSCArg } from '$lib/types/osc';

// Hardcoded constants for simpleClient (critical for bootstrap)
// These match config/constants.json but are inlined to avoid import issues during SSR
//
// CRITICAL: Port 8080 causes RSV1 protocol errors due to macOS system interference
// See: ADR-143, documentation/current/websocket-rsv1-issue.md
const constants = {
	osc: {
		webSocket: { port: 8081 },
		messageQueue: { maxSize: 100, timeout: 10000 },
		reconnectDelay: 2000
	},
	debug: { maxRecentMessages: 50 }
};

// Connection state
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectionMethod: string = 'unknown';
let isConnecting: boolean = false;

// Reconnect backoff: 1s → 2s → 4s → 8s → 16s → capped at 30s. Reset
// to the base delay after a successful connection. Prevents hammering
// the bridge if it's genuinely down while still recovering fast from
// transient blips.
const BASE_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30_000;
let reconnectAttempts = 0;

// Liveness watchdog. Bridge sends `/bridge/ping` every 5s; we expect
// any inbound traffic (ping or otherwise) within SILENCE_THRESHOLD_MS.
// If the socket goes silent past that, it's almost certainly a
// suspended iPad Safari tab whose TCP hasn't RST yet — close it
// forcibly so the reconnect path fires.
const PING_CHECK_INTERVAL_MS = 2_000;
const SILENCE_THRESHOLD_MS = 12_000;
let lastInboundTs = 0;
let livenessTimer: ReturnType<typeof setInterval> | null = null;

// Envelope address for a coalesced multi-message frame. Deliberately
// the same address the bridge already uses for Surf→UI batching
// (`utils/broadcastBatcher.js`) rather than a second grammar — the
// two directions carry the same `{address, source, messages[]}` shape
// and differ only in `source`.
const BATCH_ADDRESS = '/bridge/batch';

// --- WebSocket auth ------------------------------------------------------
//
// The bridge binds 0.0.0.0:8081, so without a gate anything on the LAN
// that knows the port can drive Live. It now speaks first with a random
// per-connection salt; we answer with HMAC-SHA256(secret, salt). The
// secret itself never crosses the wire, and the salt is fresh per
// connection so a captured exchange is not replayable.
//
// Until we answer, the bridge refuses our commands and sends us no
// broadcasts — so this has to complete before the handshake hello is
// worth sending.
const AUTH_CHALLENGE_ADDRESS = '/bridge/auth/challenge';
const AUTH_ADDRESS = '/bridge/auth';
const AUTH_RESULT_ADDRESS = '/bridge/auth/result';

/** Same-origin route that turns the bridge's salt into a proof. */
const AUTH_PROOF_URL = '/api/ws-auth';

/**
 * Ask the interface server to answer the bridge's challenge.
 *
 * **Why this is not computed here.** It used to be, with
 * `crypto.subtle.importKey` + `sign`. `crypto.subtle` only exists in a
 * *secure context*, and browsers grant that to `https://` and to
 * `http://localhost` — but not to a bare IP. So the Mac at
 * `http://localhost:8889` authenticated fine while the iPad at
 * `http://169.254.216.140:8889` (USB-C) or `http://10.43.156.117:8889`
 * (WiFi) threw a TypeError, the catch below swallowed it, no proof was
 * ever sent, and the socket sat open-but-unauthenticated forever: the
 * bridge answers such a client with silence, so the UI showed "No
 * tracks in session" against a perfectly healthy Live set.
 *
 * Moving the HMAC to the server removes the secure-context dependency
 * for every origin at once, and it is strictly less exposed than what
 * it replaces — the raw secret now stays on the machine instead of
 * being handed to every page that loads.
 *
 * Not cached: each salt is fresh per connection, so each proof is
 * good exactly once.
 */
async function fetchAuthProof(salt: string): Promise<string | null> {
	try {
		const res = await fetch(`${AUTH_PROOF_URL}?salt=${encodeURIComponent(salt)}`, {
			cache: 'no-store'
		});
		if (!res.ok) {
			logger.error('Could not obtain the WebSocket auth proof', { status: res.status });
			return null;
		}
		const body = await res.json();
		return typeof body?.proof === 'string' ? body.proof : null;
	} catch (e) {
		logger.error('WebSocket auth proof fetch failed', { error: String(e) });
		return null;
	}
}

/**
 * Answer the bridge's challenge.
 *
 * Sent with `flushOutboxNow` rather than the normal microtask flush:
 * this is the frame that unblocks every other frame, and letting it sit
 * behind a queued burst would deadlock the connection against its own
 * auth timeout.
 */
async function answerAuthChallenge(salt: string): Promise<void> {
	const proof = await fetchAuthProof(salt);
	if (!proof) {
		logger.error('Cannot authenticate to the bridge — no proof available');
		return;
	}
	try {
		send(AUTH_ADDRESS, [proof]);
		flushOutboxNow();
	} catch (e) {
		logger.error('Failed to answer the auth challenge', { error: String(e) });
	}
}

// Outbound coalescing. Every `send()` in one event-loop turn leaves as
// a single frame. Queue mechanics live in `outboundBatcher`; this
// module supplies `deliverOutbound`, which is the part that needs to
// know about the socket.
const outboundBatcher = createOutboundBatcher({
	deliver: (messages) => deliverOutbound(messages)
});

// Message queue for messages sent before connection
interface QueuedMessage {
	address: string;
	args: OSCArg[];
	timestamp: number;
}

let messageQueue: QueuedMessage[] = [];
const MAX_QUEUE_SIZE = constants.osc.messageQueue.maxSize;
const QUEUE_TIMEOUT = constants.osc.messageQueue.timeout;

// Track recently sent messages for error correlation (true circular buffer)
const recentMessages: Array<{
	address: string;
	args: OSCArg[];
	timestamp: number;
} | null> = new Array(Math.min(constants.debug.maxRecentMessages, 50)).fill(null);
const MAX_RECENT_MESSAGES = Math.min(constants.debug.maxRecentMessages, 50);
let recentMessageIndex = 0;
let recentMessageCount = 0;

// Track last listener operation for better error context
let lastListenerOperation: string | null = null;

// Callback for when messages are received
type MessageHandler = (address: string, args: OSCArg[]) => void;
let onMessageCallback: MessageHandler | null = null;

// Callback for when connection is established
type ConnectionHandler = () => void;
let onConnectCallback: ConnectionHandler | null = null;

/**
 * Set the message handler callback
 */
export function setMessageHandler(handler: MessageHandler): void {
	onMessageCallback = handler;
}

/**
 * Set the connection established callback
 */
export function setConnectionHandler(handler: ConnectionHandler): void {
	onConnectCallback = handler;
}

/**
 * The bridge's address: the host that served this page. The bridge runs on
 * the same Mac as the page's server, so whatever name or address reached the
 * page — `localhost` on the Mac, an IP or a `.local` name on the iPad —
 * reaches the bridge. There used to be a second guess, the rig's own
 * Bonjour name `looping-studio.local`, tried first by a page opened at
 * `localhost`: on any other Mac that is a stranger's name, or nobody's.
 */
function getConnectionUrls(): string[] {
	const host = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
	return [`ws://${host}:${constants.osc.webSocket.port}`];
}

/**
 * Schedule a reconnect using the same exponential backoff curve as
 * `onclose` so all retry paths converge on one cadence.
 */
function scheduleReconnect(reason: string): void {
	if (reconnectTimer) return;
	const delay = Math.min(
		BASE_RECONNECT_MS * Math.pow(2, reconnectAttempts),
		MAX_RECONNECT_MS
	);
	reconnectAttempts += 1;
	logger.info('Scheduling reconnect', { delayMs: delay, attempt: reconnectAttempts, reason });
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connectToLive();
	}, delay);
}

/**
 * Try connecting to WebSocket with multiple URLs
 */
function tryConnect(urls: string[], index = 0): Promise<void> {
	if (index >= urls.length) {
		// All candidate URLs failed before any reached `onopen`, so the
		// `onclose` retry path never fires. Schedule the next attempt
		// here instead of giving up silently (issue #386).
		logger.error('All connection attempts failed');
		scheduleReconnect('all-urls-failed');
		return Promise.resolve();
	}

	const url = urls[index];
	logger.debug('Trying connection', { attempt: index + 1, total: urls.length, url });

	return new Promise<void>((resolve, reject) => {
		try {
			const testWs = new WebSocket(url);

			testWs.onopen = () => {
				logger.info('WebSocket connected', { url });
				connectionMethod = url.includes('.local')
					? 'Bonjour'
					: url.includes('localhost')
						? 'Localhost'
						: 'IP Address';

				ws = testWs;
				setupWebSocketHandlers(ws);

				// Update global WebSocket status for freeze detector
				(globalThis as any).__wsConnected = true;

				// Reset backoff on a real connect so the next drop
				// gets the fast 1s retry.
				reconnectAttempts = 0;

				// Clear reconnect timer
				if (reconnectTimer) {
					clearTimeout(reconnectTimer);
					reconnectTimer = null;
				}

				// Start liveness watchdog — if bridge pings stop
				// arriving, we'll close + reconnect from this side.
				startLivenessWatchdog();

				// Flush any queued messages
				flushMessageQueue();

				// Notify listeners that a (re)connect happened so
				// they can re-register subscriptions and pull fresh
				// state. The custom event fires for every successful
				// open — first-connect and every reconnect alike —
				// so services can use one handler for both paths.
				if (typeof window !== 'undefined') {
					window.dispatchEvent(new CustomEvent('bridge-resync', {
						detail: { reason: 'connected', attempt: reconnectAttempts }
					}));
				}

				// Call connection handler
				if (onConnectCallback) {
					onConnectCallback();
				}

				resolve();
			};

			testWs.onerror = () => {
				logger.debug('Connection failed', { url });
				testWs.close();
				reject();
			};

			testWs.onclose = () => {
				if (ws !== testWs) {
					reject();
				}
			};
		} catch (error) {
			logger.error('Error creating WebSocket', { url, error });
			reject();
		}
	}).catch(() => {
		return tryConnect(urls, index + 1);
	});
}

/**
 * Dispatch a single inbound message to event listeners and the
 * registered message handler. Shared between the unbatched path and
 * the `/bridge/batch` disassembly loop so they stay byte-for-byte
 * equivalent downstream.
 */
function dispatchInbound(message: { address?: string; args?: OSCArg[] }): void {
	if (!message) return;

	// Auth challenge — answered here rather than surfaced, because no
	// downstream handler has anything to do with it and the connection
	// is useless until it is satisfied.
	if (message.address === AUTH_CHALLENGE_ADDRESS) {
		const salt = message.args?.[0];
		if (typeof salt === 'string' && salt) {
			void answerAuthChallenge(salt);
		} else {
			logger.error('Auth challenge carried no salt', { args: message.args });
		}
		return;
	}

	// Auth verdict. Only worth surfacing when it failed: a rejection is
	// otherwise indistinguishable from "the bridge is quiet", which is
	// the single most confusing way for this to break.
	if (message.address === AUTH_RESULT_ADDRESS) {
		if (message.args?.[0] === 1) {
			logger.info('Authenticated to the bridge');
		} else {
			logger.error('Bridge rejected our authentication', { detail: message.args?.[1] });
		}
		return;
	}

	// Bridge liveness heartbeat. Swallow it here so handlers
	// downstream don't see noise in their address space. The
	// `lastInboundTs` stamp at the onmessage entry is the real signal.
	if (message.address === '/bridge/ping') return;

	// Python control-thread heartbeat (1 Hz from
	// LoopingSurface._tick). Dispatched as a dedicated event so
	// the stall-detector can track upstream liveness independently
	// of WS liveness.
	if (message.address === '/looping/v3/bridge/heartbeat') {
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('surface-heartbeat', { detail: message.args }));
		}
		return;
	}

	// Open Channel Architecture: every message goes to whoever is correlating
	// on it. The bus short-circuits when nobody is — which is the steady
	// state, since both consumers register per request and remove on settle.
	dispatchOscMessage(message);

	// Call message handler
	if (onMessageCallback && message.address) {
		onMessageCallback(message.address, message.args ?? []);
	}
}

/**
 * Setup WebSocket event handlers
 */
function setupWebSocketHandlers(websocket: WebSocket): void {
	websocket.onmessage = (event) => {
		// Any inbound frame counts as liveness — it means the socket
		// is flowing both directions and the bridge is healthy.
		lastInboundTs = Date.now();

		try {
			const parsed = JSON.parse(event.data);

			// `/bridge/batch` is the broadcast batcher's envelope (see
			// interface/bridge/utils/broadcastBatcher.js). Unpack and
			// re-dispatch inner messages in order — downstream handlers
			// never learn the frame arrived batched.
			if (parsed && parsed.address === '/bridge/batch' && Array.isArray(parsed.messages)) {
				for (const inner of parsed.messages) {
					if (inner) dispatchInbound(inner);
				}
				return;
			}

			dispatchInbound(parsed);
		} catch (error) {
			logger.error('Message parse error', { error });
		}
	};

	websocket.onclose = () => {
		logger.info('Connection closed', { previousMethod: connectionMethod });
		ws = null;
		connectionMethod = 'disconnected';

		// Update global WebSocket status for freeze detector
		(globalThis as any).__wsConnected = false;

		stopLivenessWatchdog();

		// Exponential backoff reconnect. Cap at 30s so an extended
		// outage doesn't starve us on recovery. `reconnectAttempts`
		// resets to 0 on successful open (see `tryConnect` onopen).
		scheduleReconnect('onclose');
	};

	websocket.onerror = (error) => {
		logger.error('WebSocket connection error', { error });
	};
}

/**
 * Start the liveness watchdog. Called on successful connect. Polls
 * every PING_CHECK_INTERVAL_MS; if nothing has arrived in
 * SILENCE_THRESHOLD_MS, assumes the socket is dead and closes it —
 * the onclose handler then schedules reconnect.
 */
function startLivenessWatchdog(): void {
	stopLivenessWatchdog();
	lastInboundTs = Date.now();
	livenessTimer = setInterval(() => {
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		const silence = Date.now() - lastInboundTs;
		if (silence > SILENCE_THRESHOLD_MS) {
			logger.warn('WebSocket silent past threshold — forcing reconnect', {
				silenceMs: silence,
				threshold: SILENCE_THRESHOLD_MS
			});
			try { ws.close(); } catch {}
		}
	}, PING_CHECK_INTERVAL_MS);
}

function stopLivenessWatchdog(): void {
	if (livenessTimer !== null) {
		clearInterval(livenessTimer);
		livenessTimer = null;
	}
}

/**
 * Flush queued messages after connection
 */
function flushMessageQueue(): void {
	if (messageQueue.length === 0) return;

	logger.debug('Flushing queued messages', { count: messageQueue.length });
	const now = Date.now();
	const live: OutboundMessage[] = [];
	let expired = 0;

	while (messageQueue.length > 0) {
		const msg = messageQueue.shift()!;

		if (now - msg.timestamp > QUEUE_TIMEOUT) {
			expired++;
			continue;
		}

		live.push({ address: msg.address, args: msg.args });
	}

	// One frame, not one per message. A reconnect after a backgrounded
	// iPad tab can have a full queue waiting (MAX_QUEUE_SIZE), and
	// firing that as N frames is the exact burst coalescing exists to
	// avoid — the messages are already in hand, so there is nothing to
	// wait for.
	const frame = buildOutboundFrame(live);
	if (frame) ws!.send(JSON.stringify(frame));

	logger.debug('Message queue flushed', { sent: live.length, expired });
}

/**
 * Connect to Live via WebSocket with fallback URLs
 */
export function connectToLive(): Promise<void> {
	if (ws?.readyState === WebSocket.OPEN) return Promise.resolve();
	if (isConnecting) return Promise.resolve();

	const urls = getConnectionUrls();
	logger.debug('Available connection methods', { urls });

	isConnecting = true;
	return tryConnect(urls).finally(() => {
		isConnecting = false;
	});
}

/**
 * Build the JSON wire envelope for the bridge.
 *
 * `JSON.stringify` flattens a `Uint8Array` to an integer-keyed object
 * (`{"0":255,...}`), which the bridge can't tell from a generic object
 * and the OSC encoder won't tag as a blob. So binary args are
 * explicitly serialised to the Node-Buffer JSON shape
 * `{type:'Buffer', data:[...bytes]}` and flagged in `argsTypes` as
 * `'blob'` — the same convention the surface→UI direction already uses
 * (decoded by `toUint8Array`). The bridge's `routeMessageToUDP` reads
 * the `'blob'` tag and rebuilds a real OSC `b` argument.
 */
function buildWireMessage(address: string, args: OSCArg[]) {
	const argsTypes: string[] = [];
	// Widen the element type so the defensive ArrayBuffer branch below
	// type-checks. An OSCArg is never statically an ArrayBuffer, but this is a
	// wire boundary — a caller could hand us one at runtime, and we still
	// normalise it to the Buffer shape the bridge expects.
	const wireArgs = (args as (OSCArg | ArrayBuffer)[]).map((arg) => {
		if (arg instanceof Uint8Array) {
			argsTypes.push('blob');
			return { type: 'Buffer', data: Array.from(arg) };
		}
		if (arg instanceof ArrayBuffer) {
			argsTypes.push('blob');
			return { type: 'Buffer', data: Array.from(new Uint8Array(arg)) };
		}
		argsTypes.push(typeof arg);
		return arg;
	});
	return { address, args: wireArgs, argsTypes };
}

/**
 * Send a message over WebSocket
 */
export function send(address: string, args: OSCArg[] = []): void {
	// Track message for error correlation (circular buffer - no shift/realloc).
	// Stays synchronous: this is diagnostic state that `getRecentMessages`
	// and the error path read, and deferring it would let the ring buffer
	// disagree with what the caller just did.
	recentMessages[recentMessageIndex % MAX_RECENT_MESSAGES] = { address, args, timestamp: Date.now() };
	recentMessageIndex++;
	recentMessageCount = Math.min(recentMessageCount + 1, MAX_RECENT_MESSAGES);

	// Track listener operations specifically
	if (address.includes('start_listen') || address.includes('stop_listen')) {
		lastListenerOperation = `${address} [${args.join(', ')}]`;
	}

	outboundBatcher.enqueue({ address, args });
}

/**
 * Push one message onto the pre-connection queue.
 *
 * Unchanged behaviour from before outbound coalescing existed: evict
 * oldest at capacity, and kick a reconnect if the socket is gone.
 */
function enqueueUntilConnected(message: OutboundMessage): void {
	if (messageQueue.length >= MAX_QUEUE_SIZE) {
		logger.warn('Message queue full, dropping oldest message');
		messageQueue.shift();
	}

	messageQueue.push({
		address: message.address,
		args: message.args,
		timestamp: Date.now()
	});

	// Auto-connect if not connected
	if (!ws || ws.readyState === WebSocket.CLOSED) {
		connectToLive();
	}
}

/**
 * Build the frame for a drained batch.
 *
 * A single message goes raw — no envelope. That mirrors
 * `broadcastBatcher`'s single-item passthrough in the other direction
 * and keeps the overwhelmingly common case (one write per turn)
 * byte-for-byte identical to what shipped before coalescing existed,
 * so nothing downstream has to learn a new shape for it.
 *
 * Exported for tests: this is the whole raw-vs-envelope decision, and
 * it is pure.
 */
export function buildOutboundFrame(messages: OutboundMessage[]): object | null {
	if (messages.length === 0) return null;
	if (messages.length === 1) {
		return buildWireMessage(messages[0].address, messages[0].args);
	}
	return {
		address: BATCH_ADDRESS,
		source: 'ui',
		messages: messages.map((m) => buildWireMessage(m.address, m.args))
	};
}

/**
 * Ship one drained batch, or spill it to the pre-connection queue.
 *
 * The OPEN check happens here rather than in `send` because the socket
 * can close between the two — in which case every drained message
 * falls back to the pre-connection queue exactly as an uncoalesced
 * `send` would have.
 */
function deliverOutbound(messages: OutboundMessage[]): void {
	if (ws?.readyState === WebSocket.OPEN) {
		const frame = buildOutboundFrame(messages);
		if (frame) ws.send(JSON.stringify(frame));
		return;
	}

	for (const message of messages) {
		enqueueUntilConnected(message);
	}
}

/**
 * Flush pending outbound messages synchronously.
 *
 * For tests, and for any caller that must get bytes onto the wire
 * before yielding. Production code should not need it — the microtask
 * fires before the browser does anything observable.
 */
export function flushOutboxNow(): void {
	outboundBatcher.flush();
}

/**
 * Check if connected to WebSocket
 */
export function isConnected(): boolean {
	return ws?.readyState === WebSocket.OPEN;
}

/**
 * Get current connection status for UI display
 */
export function getConnectionStatus(): { connected: boolean; method: string; url?: string } {
	return {
		connected: ws?.readyState === WebSocket.OPEN,
		method: connectionMethod,
		url: ws?.url
	};
}

/**
 * Get the last listener operation for error context
 */
export function getLastListenerOperation(): string | null {
	return lastListenerOperation;
}

/**
 * Get recent messages for debugging
 */
export function getRecentMessages(
	count: number = 10
): Array<{ address: string; args: OSCArg[]; timestamp: number }> {
	const result: Array<{ address: string; args: OSCArg[]; timestamp: number }> = [];
	const total = Math.min(count, recentMessageCount);
	for (let i = 0; i < total; i++) {
		const idx = (recentMessageIndex - total + i + MAX_RECENT_MESSAGES) % MAX_RECENT_MESSAGES;
		const msg = recentMessages[idx];
		if (msg) result.push(msg);
	}
	return result;
}

// Set up global getter for last listener operation (for router to access)
if (typeof window !== 'undefined') {
	(window as any).__getLastListenerOperation = () => lastListenerOperation;
}
