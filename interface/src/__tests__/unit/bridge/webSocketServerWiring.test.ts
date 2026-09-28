/**
 * The WebSocket server must actually accept a connection and route a write.
 *
 * Every other bridge test calls the pure functions directly, which meant a
 * `ReferenceError` in `createWebSocketServer`'s connection handler shipped
 * green: the whole suite passed while the running bridge logged
 * "relayTotalMixLevel is not defined" on **every** client connection, so no
 * client was ever registered. A unit test that calls `routeMessageToUDP` with
 * explicit arguments cannot see that, because the bug was in the plumbing
 * between the two.
 *
 * So this stands the real server up on an ephemeral port, connects a real
 * client, and drives a TotalMix write through the actual WS path. It is the
 * only test here that exercises the wiring rather than the logic.
 */

import { describe, it, expect, afterEach } from 'vitest';
// @ts-expect-error ws ships no type declarations
import WebSocket from 'ws';
import { createRequire } from 'module';

const nodeRequire = createRequire(import.meta.url);

const { computeProof, resolveWsSecret } = nodeRequire(
	'../../../../bridge/utils/wsSecret.js'
);
const {
	AUTH_ADDRESS,
	AUTH_CHALLENGE_ADDRESS,
	AUTH_RESULT_ADDRESS,
	__testing: { isAuthRequired }
} = nodeRequire('../../../../bridge/transport/WebSocketServer.js');

/** The same secret the server resolved — both read the same source. */
function wsSecret(): string {
	return resolveWsSecret().secret ?? '';
}

import { createWebSocketServer } from '../../../../bridge/transport/WebSocketServer.js';
import { createTotalMixLink } from '../../../../bridge/handlers/totalmixLink.js';
import { createFeatureRegistry } from '../../../../bridge/utils/features.js';

let teardown: (() => void) | null = null;
afterEach(() => {
	teardown?.();
	teardown = null;
});

interface Harness {
	port: number;
	link: ReturnType<typeof createTotalMixLink>;
	sentToRecorder: unknown[];
	errors: Error[];
}

function startServer(features: unknown = null, captureRecorder: unknown = null): Promise<Harness> {
	const link = createTotalMixLink();
	const sentToRecorder: unknown[] = [];
	const errors: Error[] = [];

	const onError = (err: Error) => errors.push(err);
	process.on('uncaughtException', onError);

	const udpPorts = {
		totalmix: { send: () => {} },
		totalmixDevice: { send: () => {} },
		loopingRecorder: { send: (m: unknown) => sentToRecorder.push(m) }
	};

	// The bridge is untyped JS: its JSDoc says `@returns {Object}` and omits serverMode.
	const { httpServer, wss } = (createWebSocketServer as (...args: unknown[]) => any)(
		{ port: 0, host: '127.0.0.1', serverMode: 'dev' },
		udpPorts,
		{},
		{ totalMessages: 0, routingErrors: 0, startTime: Date.now() },
		null,
		null,
		link,
		null,
		null,
		null,
		features,
		null,
		captureRecorder
	);

	teardown = () => {
		process.off('uncaughtException', onError);
		try { wss.close(); } catch { /* already closed */ }
		try { httpServer.close(); } catch { /* already closed */ }
	};

	return new Promise((resolve) => {
		const check = () => {
			const addr = httpServer.address();
			if (addr && typeof addr === 'object') resolve({ port: addr.port, link, sentToRecorder, errors });
			else setTimeout(check, 20);
		};
		check();
	});
}

/**
 * Connect, authenticate, send one message, wait for it to be handled.
 *
 * The auth exchange is not incidental setup — since the gate landed, a
 * client that skips it has its messages refused, so a test that skipped
 * it would silently assert nothing. Answering the challenge here is what
 * keeps these tests exercising the routing they are about.
 */
function sendOne(port: number, message: unknown): Promise<void> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}`);
		ws.on('error', reject);

		let sent = false;
		const sendPayload = () => {
			if (sent) return;
			sent = true;
			ws.send(JSON.stringify(message));
			setTimeout(() => { ws.close(); resolve(); }, 250);
		};

		ws.on('message', (raw: Buffer) => {
			let frame: { address?: string; args?: unknown[] };
			try {
				frame = JSON.parse(raw.toString());
			} catch {
				return;
			}
			if (frame.address === AUTH_CHALLENGE_ADDRESS) {
				const salt = frame.args?.[0];
				if (typeof salt === 'string') {
					ws.send(JSON.stringify({
						address: AUTH_ADDRESS,
						args: [computeProof(wsSecret(), salt)]
					}));
				}
				return;
			}
			if (frame.address === AUTH_RESULT_ADDRESS) sendPayload();
		});

		// A server with auth disabled never challenges, so fall through
		// after a beat rather than hanging on a result that never comes.
		ws.on('open', () => setTimeout(sendPayload, 150));
	});
}

describe('WebSocket server wiring', () => {
	it('accepts a connection without throwing', async () => {
		// The regression: the connection handler referenced an undeclared
		// variable, so this threw before any client could be registered.
		const h = await startServer();
		await sendOne(h.port, { address: '/bridge/noop', args: [] });
		expect(h.errors.map((e) => e.message)).toEqual([]);
	});

	it('hands the recorder its folder before a capture start, on the same port', async () => {
		// The device records an unsaved set into the folder it heard last, so
		// the folder must reach it first — and must not be dropped between
		// the connection's context and the handler, as relayTotalMixLevel once was.
		let h: Harness | null = null;
		const startsSentBeforeFolder: number[] = [];
		const recorder = {
			sendProjectFolder: () => startsSentBeforeFolder.push(h?.sentToRecorder.length ?? -1)
		};
		h = await startServer(null, recorder);
		await sendOne(h.port, { address: '/capture/start', args: [] });
		expect(h.errors.map((e) => e.message)).toEqual([]);
		expect(startsSentBeforeFolder).toEqual([0]);
		expect(h.sentToRecorder).toEqual([{ address: '/capture/start', args: [] }]);
	});

	it('tells a new client the feature switches the moment it connects', async () => {
		// The UI draws nothing for a feature until this arrives, so it has to
		// come with the first frames — before auth, like connection_status:
		// which subsystems are on is layout, not the set.
		const features = createFeatureRegistry(
			{ features: { totalmix: true } },
			{ logger: { info: () => {}, warn: () => {} } }
		);
		features.setAvailability('totalmix', false, 'TotalMix not answering');
		const h = await startServer(features);

		const frames = await new Promise<Array<{ address?: string; args?: unknown[] }>>((resolve, reject) => {
			const seen: Array<{ address?: string; args?: unknown[] }> = [];
			const ws = new WebSocket(`ws://127.0.0.1:${h.port}`);
			ws.on('error', reject);
			ws.on('message', (raw: Buffer) => seen.push(JSON.parse(raw.toString())));
			ws.on('open', () => setTimeout(() => { ws.close(); resolve(seen); }, 200));
		});

		const frame = frames.find((f) => f.address === '/bridge/features');
		expect(frame, `no /bridge/features among ${frames.map((f) => f.address).join(', ')}`).toBeDefined();
		expect(JSON.parse(String(frame?.args?.[0]))).toEqual({
			totalmix: { enabled: true, available: false, reason: 'TotalMix not answering' },
			maxUtilityPatch: { enabled: false, available: false, reason: '' },
			expressionPedal: { enabled: false, available: false, reason: '' },
			menubar: { enabled: false, available: false, reason: '' },
			axHelper: { enabled: false, available: false, reason: '' },
			captureRecorder: { enabled: true, available: false, reason: '' }
		});
		expect(h.errors.map((e) => e.message)).toEqual([]);
	});
});

interface Frame {
	address?: string;
	args?: unknown[];
}

/**
 * Connect and record every frame the server sends, in arrival order.
 *
 * With `answerChallenge` the client authenticates and listens a beat past
 * the verdict, which is when the replay lands. Without it, or against a
 * server with the gate off (no challenge, so no verdict), it listens for a
 * fixed window instead.
 */
function join(port: number, { answerChallenge }: { answerChallenge: boolean }): Promise<Frame[]> {
	return new Promise((resolve, reject) => {
		const frames: Frame[] = [];
		const ws = new WebSocket(`ws://127.0.0.1:${port}`);
		ws.on('error', reject);

		let finishing = false;
		const finish = (afterMs: number) => {
			if (finishing) return;
			finishing = true;
			setTimeout(() => { ws.close(); resolve(frames); }, afterMs);
		};

		ws.on('message', (raw: Buffer) => {
			let frame: Frame;
			try {
				frame = JSON.parse(raw.toString());
			} catch {
				return;
			}
			frames.push(frame);
			const salt = frame.args?.[0];
			if (answerChallenge && frame.address === AUTH_CHALLENGE_ADDRESS && typeof salt === 'string') {
				ws.send(JSON.stringify({ address: AUTH_ADDRESS, args: [computeProof(wsSecret(), salt)] }));
			}
			if (frame.address === AUTH_RESULT_ADDRESS) finish(100);
		});

		ws.on('open', () => setTimeout(() => finish(0), 400));
	});
}

const isLevel = (f: Frame) => f.address?.startsWith('/looping/v3/totalmix/') ?? false;

describe('TotalMix levels for a client that joins after the bootstrap', () => {
	it('replays the cached levels once the client authenticates', async () => {
		// The rig bug: an iPad that reloads after the bridge's one startup
		// broadcast shows empty wells until a level changes on the mixer.
		const h = await startServer();
		h.link.fromMixer('/mix/pb/2/2/fader', [-22.3]);

		const frames = await join(h.port, { answerChallenge: true });

		// Only the channel the bridge has heard from. The other four are
		// never synthesized, so the UI keeps showing them as unknown.
		expect(frames.filter(isLevel).map((f) => [f.address, f.args])).toEqual([
			['/looping/v3/totalmix/click', [-22.3]]
		]);
		// After the verdict. With the gate off there is no verdict (-1), and
		// the client was entitled to the levels from the start.
		expect(frames.findIndex(isLevel)).toBeGreaterThan(
			frames.findIndex((f) => f.address === AUTH_RESULT_ADDRESS)
		);
		expect(h.errors.map((e) => e.message)).toEqual([]);
	});

	// With the gate off every client is authenticated, so there is no such
	// client to test.
	it.skipIf(!isAuthRequired())('sends nothing to a client that has not authenticated', async () => {
		const h = await startServer();
		h.link.fromMixer('/mix/pb/2/2/fader', [-22.3]);

		const frames = await join(h.port, { answerChallenge: false });

		// The client heard the on-connect frames, so the silence below is
		// the gate at work and not a connection that never got going.
		expect(frames.map((f) => f.address)).toContain('/bridge/connection_status');
		expect(frames.filter(isLevel)).toEqual([]);
	});
});
