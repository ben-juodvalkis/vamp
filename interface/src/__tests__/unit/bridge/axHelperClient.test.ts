/**
 * The bridge's AX helper client against a real Unix socket (ADR-439).
 *
 * A fake helper listens on a socket in a short /tmp directory and answers
 * one JSON line per request, so the tests exercise the real framing, id
 * matching, reconnect and the named errors the UI depends on: `ready`,
 * `ax-untrusted`, `ax-helper-down`, `ax-timeout`, and the helper's own codes.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import * as client from '../../../../bridge/transport/AxHelperClient.js';

type Reply = Record<string, unknown> | null;
type Request = { id: number; verb: string; args: Record<string, unknown> };

interface Client {
	start(): unknown;
	stop(): void;
	request(verb: string, args?: object, options?: { timeoutMs?: number }): Promise<Record<string, unknown>>;
	readonly state: { state: string; detail: string };
	readonly connected: boolean;
	readonly lastStatus: unknown;
	on(event: 'state', fn: (s: { state: string; detail: string }) => void): void;
}

const { AxHelperClient, createAxHelperClient } = client as unknown as {
	AxHelperClient: new (options: Record<string, unknown>) => Client;
	createAxHelperClient: (constants: object, options?: Record<string, unknown>) => Client;
};

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function until(check: () => boolean, ms = 2000): Promise<void> {
	const deadline = Date.now() + ms;
	return new Promise((resolve, reject) => {
		const tick = () => {
			if (check()) return resolve();
			if (Date.now() > deadline) return reject(new Error('condition not met in time'));
			setTimeout(tick, 5);
		};
		tick();
	});
}

function fakeHelper(socketPath: string, answer: (req: Request) => Reply) {
	const sockets = new Set<net.Socket>();
	const server = net.createServer((socket) => {
		sockets.add(socket);
		socket.setEncoding('utf8');
		let buffer = '';
		socket.on('data', (chunk: string) => {
			buffer += chunk;
			let newline = buffer.indexOf('\n');
			while (newline !== -1) {
				const req = JSON.parse(buffer.slice(0, newline)) as Request;
				buffer = buffer.slice(newline + 1);
				const reply = answer(req);
				if (reply) socket.write(`${JSON.stringify({ id: req.id, ms: 1.5, queuedMs: 0.1, ...reply })}\n`);
				newline = buffer.indexOf('\n');
			}
		});
		socket.on('close', () => sockets.delete(socket));
	});
	return new Promise<{ close(): Promise<void>; dropClients(): void }>((resolve) => {
		server.listen(socketPath, () =>
			resolve({
				dropClients: () => sockets.forEach((s) => s.destroy()),
				close: () =>
					new Promise<void>((done) => {
						sockets.forEach((s) => s.destroy());
						server.close(() => done());
					})
			})
		);
	});
}

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
	while (cleanups.length) await cleanups.pop()!();
});

function setup(options: Record<string, unknown> = {}) {
	const dir = fs.mkdtempSync(path.join(os.platform() === 'darwin' ? '/tmp' : os.tmpdir(), 'axc-'));
	const socketPath = path.join(dir, 'h.sock');
	cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
	const ax = new AxHelperClient({
		socketPath,
		logger: silent,
		statusIntervalMs: 60_000,
		reconnectBaseMs: 10,
		reconnectMaxMs: 40,
		downGraceMs: 30,
		...options
	});
	cleanups.push(() => ax.stop());
	return { ax, socketPath };
}

const trusted: (req: Request) => Reply = (req) =>
	req.verb === 'status' ? { ok: true, result: { trusted: true, live: { pid: 1 } } } : null;

describe('AxHelperClient', () => {
	it('reports ready once a trusted helper answers status', async () => {
		const { ax, socketPath } = setup();
		const helper = await fakeHelper(socketPath, trusted);
		cleanups.push(() => helper.close());
		ax.start();
		await until(() => ax.state.state === 'ready');
		expect(ax.state).toEqual({ state: 'ready', detail: '' });
	});

	it('names an untrusted helper, with the app to switch on', async () => {
		const { ax, socketPath } = setup({ appName: 'Looping AX Helper' });
		const helper = await fakeHelper(socketPath, (req) =>
			req.verb === 'status' ? { ok: true, result: { trusted: false } } : null
		);
		cleanups.push(() => helper.close());
		ax.start();
		await until(() => ax.state.state === 'ax-untrusted');
		expect(ax.state.detail).toContain('"Looping AX Helper"');
	});

	it('rejects with ax-helper-down when nothing listens, and says why', async () => {
		const { ax } = setup();
		ax.start();
		await until(() => ax.state.state === 'ax-helper-down' && ax.state.detail !== 'not connected yet');
		expect(ax.state.detail).toContain('helper not running');
		await expect(ax.request('press', { target: 'transport.tap_tempo' })).rejects.toMatchObject({
			code: 'ax-helper-down'
		});
	});

	it('resolves results with timings and rejects helper errors by code', async () => {
		const { ax, socketPath } = setup();
		const helper = await fakeHelper(socketPath, (req) => {
			if (req.verb === 'status') return { ok: true, result: { trusted: true } };
			if (req.args.target === 'transport.tap_tempo') return { ok: true, result: { pressMs: 3.2 } };
			return {
				ok: false,
				error: { code: 'ax-control-missing', detail: 'kit.swap_next is not in Live', count: 0 }
			};
		});
		cleanups.push(() => helper.close());
		ax.start();
		await until(() => ax.state.state === 'ready');
		await expect(ax.request('press', { target: 'transport.tap_tempo' })).resolves.toEqual({
			pressMs: 3.2,
			helperMs: 1.5,
			queuedMs: 0.1
		});
		const failure = ax.request('press', { target: 'kit.swap_next' });
		await expect(failure).rejects.toMatchObject({
			code: 'ax-control-missing',
			detail: 'kit.swap_next is not in Live',
			extra: { count: 0, helperMs: 1.5 }
		});
	});

	it('an ax-untrusted error reply flips the state at once', async () => {
		const { ax, socketPath } = setup();
		const helper = await fakeHelper(socketPath, (req) =>
			req.verb === 'status'
				? { ok: true, result: { trusted: true } }
				: { ok: false, error: { code: 'ax-untrusted', detail: 'switch it on' } }
		);
		cleanups.push(() => helper.close());
		ax.start();
		await until(() => ax.state.state === 'ready');
		await expect(ax.request('press', { target: 'transport.tap_tempo' })).rejects.toMatchObject({
			code: 'ax-untrusted'
		});
		expect(ax.state).toEqual({ state: 'ax-untrusted', detail: 'switch it on' });
	});

	it('times out a request the helper never answers', async () => {
		const { ax, socketPath } = setup();
		const helper = await fakeHelper(socketPath, trusted); // answers status only
		cleanups.push(() => helper.close());
		ax.start();
		await until(() => ax.state.state === 'ready');
		await expect(ax.request('press', {}, { timeoutMs: 30 })).rejects.toMatchObject({ code: 'ax-timeout' });
	});

	it('fails in-flight requests when the connection drops, then recovers', async () => {
		const { ax, socketPath } = setup();
		let hold = true;
		const helper = await fakeHelper(socketPath, (req) =>
			req.verb === 'status' ? { ok: true, result: { trusted: true } } : hold ? null : { ok: true, result: {} }
		);
		cleanups.push(() => helper.close());
		const states: string[] = [];
		ax.on('state', (s) => states.push(s.state));
		ax.start();
		await until(() => ax.state.state === 'ready');
		const inFlight = ax.request('press', { target: 'kit.swap_next' });
		helper.dropClients();
		await expect(inFlight).rejects.toMatchObject({ code: 'ax-helper-down' });
		hold = false;
		// It redials on its own and is ready again; a drop shorter than the
		// grace window never has to read as down.
		await until(() => ax.connected && ax.state.state === 'ready' && states.length >= 1);
		await expect(ax.request('press', {})).resolves.toMatchObject({ helperMs: 1.5 });
	});
});

/*
 * `createAxHelperClient` runs at the bridge's module top level, so a throw
 * there kills the whole process before it opens a port — which is what the
 * documented fresh install used to do, because
 * `config/constants.json.example` carried no `axHelper` block at all.
 */
describe('createAxHelperClient with no axHelper.socketPath', () => {
	it('returns a client shape that is permanently down instead of throwing', async () => {
		const ax = createAxHelperClient({}, { logger: silent });
		expect(ax.start()).toBe(ax);
		expect(ax.state.state).toBe('ax-helper-down');
		expect(ax.state.detail).toContain('axHelper.socketPath');
		expect(ax.connected).toBe(false);
		expect(ax.lastStatus).toBe(null);
		ax.on('state', () => {
			throw new Error('the disabled client never changes state');
		});
		await expect(ax.request('save_as_dialog', { name: 'x' })).rejects.toMatchObject({
			code: 'ax-helper-down'
		});
		ax.stop();
	});

	it('still builds the real client when the key is present', () => {
		const ax = createAxHelperClient(
			{ axHelper: { socketPath: '/nonexistent/ax.sock' } },
			{ logger: silent }
		);
		expect(ax).toBeInstanceOf(AxHelperClient);
		expect(ax.state.state).toBe('ax-helper-down');
		expect(ax.state.detail).toBe('not connected yet');
	});
});
