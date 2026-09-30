/**
 * WebSocket auth gate.
 *
 * The bridge binds `0.0.0.0:8081`, so before this anything on the LAN
 * that knew the port could drive Live. The server now speaks first with
 * a random per-connection salt and the client must answer with
 * HMAC-SHA256(secret, salt); the secret never crosses the wire and the
 * salt is fresh per connection, so a captured exchange is not
 * replayable.
 *
 * Two halves have to hold, and the second is the one that is easy to
 * forget:
 *
 * 1. an unauthenticated client cannot **send** commands, and
 * 2. an unauthenticated client cannot **receive** broadcasts — refusing
 *    only its commands would still leak the whole Live Set to anything
 *    that opened a socket, which is the half that needs no credentials
 *    to exploit.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const nodeRequire = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let secretMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let server: any;

beforeEach(() => {
	secretMod = nodeRequire('../../../../bridge/utils/wsSecret.js');
	server = nodeRequire('../../../../bridge/transport/WebSocketServer.js');
});

// --- the primitives --------------------------------------------------------

describe('wsSecret primitives', () => {
	it('computes a stable HMAC for a given secret and salt', () => {
		const a = secretMod.computeProof('sekrit', 'abc123');
		const b = secretMod.computeProof('sekrit', 'abc123');
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{64}$/);
	});

	it('changes with the salt, so a proof is per-connection', () => {
		expect(secretMod.computeProof('sekrit', 'salt-one')).not.toBe(
			secretMod.computeProof('sekrit', 'salt-two')
		);
	});

	it('changes with the secret', () => {
		expect(secretMod.computeProof('one', 'salt')).not.toBe(
			secretMod.computeProof('two', 'salt')
		);
	});

	it('never contains the secret', () => {
		// The whole point: capturing the exchange must not yield the
		// credential.
		const secret = 'a-very-distinctive-secret-value';
		expect(secretMod.computeProof(secret, 'salt')).not.toContain(secret);
	});

	it('mints a fresh salt each time', () => {
		const salts = new Set(Array.from({ length: 50 }, () => secretMod.makeSalt(16)));
		expect(salts.size).toBe(50);
	});

	it('accepts a matching proof', () => {
		const proof = secretMod.computeProof('s', 'salt');
		expect(secretMod.proofMatches(proof, proof)).toBe(true);
	});

	it('rejects a wrong proof, a short one, and a non-string', () => {
		const proof = secretMod.computeProof('s', 'salt');
		expect(secretMod.proofMatches(proof, secretMod.computeProof('other', 'salt'))).toBe(false);
		expect(secretMod.proofMatches(proof, 'deadbeef')).toBe(false);
		expect(secretMod.proofMatches(proof, null)).toBe(false);
		expect(secretMod.proofMatches(proof, undefined)).toBe(false);
		expect(secretMod.proofMatches(proof, 123)).toBe(false);
	});

	it('rejects an empty proof', () => {
		expect(secretMod.proofMatches(secretMod.computeProof('s', 'salt'), '')).toBe(false);
	});
});

// --- the gate --------------------------------------------------------------

function fakeSocket() {
	const sent: Array<Record<string, unknown>> = [];
	return {
		sent,
		readyState: 1,
		closed: null as null | { code: number; reason: string },
		loopingAuth: { required: true, ok: false, salt: 'test-salt' },
		send(raw: string) {
			sent.push(JSON.parse(raw));
		},
		close(code: number, reason: string) {
			this.closed = { code, reason };
		}
	};
}

function context(routed: unknown[]) {
	const port = { send: (m: unknown) => routed.push(m) };
	return {
		clientId: 'test',
		udpPorts: new Proxy({}, { get: () => port }),
		metrics: { routingErrors: 0 },
		captureOverride: null,
		totalmixLink: null,
		relayTotalMixLevel: null
	};
}

describe('auth gate on inbound messages', () => {
	it('refuses a command from an unauthenticated client', () => {
		const routed: unknown[] = [];
		const ws = fakeSocket();

		server.__testing.dispatchClientMessage(
			ws,
			{ address: '/looping/v3/track/mute', args: ['tracks/0', 1] },
			context(routed)
		);

		expect(routed).toEqual([]);
	});

	it('lets the auth frame itself through', () => {
		// Checked before the handler table, so it cannot be gated by the
		// very check it exists to satisfy.
		const routed: unknown[] = [];
		const ws = fakeSocket();

		expect(() =>
			server.__testing.dispatchClientMessage(
				ws,
				{ address: server.AUTH_ADDRESS, args: ['wrong-proof'] },
				context(routed)
			)
		).not.toThrow();

		// Wrong proof → rejected and closed, never routed.
		expect(routed).toEqual([]);
		expect(ws.closed?.code).toBe(4403);
	});

	it('routes commands once the client is authenticated', () => {
		const routed: unknown[] = [];
		const ws = fakeSocket();
		ws.loopingAuth.ok = true;

		server.__testing.dispatchClientMessage(
			ws,
			{ address: '/looping/v3/track/mute', args: ['tracks/0', 1] },
			context(routed)
		);

		expect(routed).toHaveLength(1);
	});

	it('accepts the right proof and reports success', () => {
		const ws = fakeSocket();
		const expected = server.__testing.expectedProofFor(ws.loopingAuth.salt);

		server.__testing.handleAuth(
			ws,
			{ address: server.AUTH_ADDRESS, args: [expected] },
			context([])
		);

		expect(ws.loopingAuth.ok).toBe(true);
		expect(ws.sent.at(-1)).toMatchObject({
			address: server.AUTH_RESULT_ADDRESS,
			args: [1]
		});
	});

	it('burns the salt on success so a proof is single-use', () => {
		const ws = fakeSocket();
		const expected = server.__testing.expectedProofFor(ws.loopingAuth.salt);

		server.__testing.handleAuth(ws, { args: [expected] }, context([]));

		expect(ws.loopingAuth.salt).toBeNull();
	});

	it('closes the socket on a bad proof', () => {
		const ws = fakeSocket();

		server.__testing.handleAuth(ws, { args: ['not-the-proof'] }, context([]));

		expect(ws.loopingAuth.ok).toBe(false);
		expect(ws.closed).toEqual({ code: 4403, reason: 'auth failed' });
	});

	it('says only that authentication failed, never how close it got', () => {
		const ws = fakeSocket();
		server.__testing.handleAuth(ws, { args: ['nope'] }, context([]));

		const result = ws.sent.find((m) => m.address === server.AUTH_RESULT_ADDRESS);
		expect(result?.args).toEqual([0, 'bad-proof']);
	});

	it('ignores an auth frame on a connection with no live challenge', () => {
		const ws = fakeSocket();
		// @ts-expect-error no live challenge is the point of the test
		ws.loopingAuth.salt = null;
		server.__testing.handleAuth(ws, { args: ['anything'] }, context([]));
		expect(ws.loopingAuth.ok).toBe(false);
	});
});

// --- the half that is easy to forget ---------------------------------------

describe('auth gate on outbound broadcasts', () => {
	function client(authOk: boolean | null) {
		return {
			readyState: 1,
			sent: [] as string[],
			loopingAuth: authOk === null ? undefined : { ok: authOk },
			send(raw: string) {
				this.sent.push(raw);
			}
		};
	}

	it('does not broadcast to an unauthenticated client', () => {
		const denied = client(false);
		const allowed = client(true);
		const wss = { clients: new Set([denied, allowed]) };

		server.broadcastToClients(wss, { address: '/looping/v3/track/name', args: ['x'] });

		expect(denied.sent).toEqual([]);
		expect(allowed.sent).toHaveLength(1);
	});

	it('broadcasts to a client with no auth state (gate disabled)', () => {
		const legacy = client(null);
		const wss = { clients: new Set([legacy]) };

		server.broadcastToClients(wss, { address: '/looping/v3/track/name', args: ['x'] });

		expect(legacy.sent).toHaveLength(1);
	});
});

// --- which pages may connect -------------------------------------------------

describe('origin check', () => {
	let originAllowed: (origin: string | undefined) => boolean;
	beforeEach(() => {
		({ originAllowed } = nodeRequire('../../../../bridge/utils/originCheck.js'));
	});

	it('lets Vamp’s own pages connect: localhost, an IP address, a .local name', () => {
		for (const origin of [
			'http://localhost:3000',
			'http://127.0.0.1:8889',
			'http://192.168.100.1:8889',
			'http://10.43.156.117:8889',
			'http://169.254.216.140:8889',
			'http://[::1]:3000',
			'http://Looping-Studio-2.local:8889',
			'https://vamp.localhost'
		]) {
			expect(originAllowed(origin), origin).toBe(true);
		}
	});

	it('lets a client outside a browser connect, since it sends no Origin', () => {
		expect(originAllowed(undefined)).toBe(true);
		expect(originAllowed('')).toBe(true);
	});

	it('refuses a page from any other site, including one rebinding its name to the Mac', () => {
		for (const origin of [
			'http://evil.example',
			'https://attacker.com:8889',
			'http://localhost.evil.example',
			'http://local',
			'null',
			'file://',
			'chrome-extension://abcdef',
			'not a url'
		]) {
			expect(originAllowed(origin), origin).toBe(false);
		}
	});
});

describe('auth config', () => {
	it('is on unless the config says enabled: false', () => {
		const { resolveAuthConfig } = server.__testing;
		expect(resolveAuthConfig(() => ({ enabled: true, timeoutMs: 1 }))).toEqual({
			enabled: true,
			timeoutMs: 1
		});
		expect(resolveAuthConfig(() => ({ enabled: false })).enabled).toBe(false);
	});

	it('stays on with no auth block, or a config that cannot be read', () => {
		const { resolveAuthConfig } = server.__testing;
		expect(resolveAuthConfig(() => undefined).enabled).toBe(true);
		expect(resolveAuthConfig(() => ({ saltBytes: 8 }))).toEqual({ saltBytes: 8, enabled: true });
		expect(
			resolveAuthConfig(() => {
				throw new Error('unreadable');
			}).enabled
		).toBe(true);
	});
});
