// @vitest-environment node
/**
 * Bridge→surface over the TCP leg, UDP only while it is down (ADR-489).
 *
 * A real `net.Server` stands in for the surface's 11022 listener and
 * parses the same `[4-byte BE length][OSC]` frames `tcp_transport.py`
 * does, and a real `osc.UDPPort` → `dgram` socket stands in for 11020, so
 * the bytes compared here are the bytes the surface would read. What is
 * pinned:
 *
 * - while the stream is up every write rides it, in order, with typed
 *   args intact, and none reaches UDP — a UI write through the real
 *   `routeMessageToUDP` included;
 * - a frame on the stream is byte-for-byte the datagram UDP would send;
 * - while it is down a write takes UDP, and moves back when it returns;
 * - `kick()` redials at once instead of waiting out the backoff, once a
 *   second at most;
 * - a surface that stops reading costs dropped frames past the cap,
 *   never an unbounded buffer and never a UDP send that would overtake
 *   the frames still queued on the stream.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import net from 'node:net';
import dgram from 'node:dgram';

const nodeRequire = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const osc: any = nodeRequire('osc');
const { createSurfaceTcpClient } = nodeRequire('../../../../bridge/transport/SurfaceTcpClient.js');
const { createSurfaceLink } = nodeRequire('../../../../bridge/transport/SurfaceLink.js');
const { __testing } = nodeRequire('../../../../bridge/transport/WebSocketServer.js');

interface Packet {
	address: string;
	args?: unknown[];
}

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length) await cleanups.pop()!();
});

function until(check: () => boolean, ms = 3000): Promise<void> {
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

/** The surface's 11022 end: accepts, de-frames, keeps every payload. */
async function fakeSurface(port = 0) {
	const payloads: Buffer[] = [];
	const sockets = new Set<net.Socket>();
	const server = net.createServer((socket) => {
		sockets.add(socket);
		let inbox = Buffer.alloc(0);
		socket.on('data', (chunk) => {
			inbox = Buffer.concat([inbox, chunk]);
			while (inbox.length >= 4) {
				const length = inbox.readUInt32BE(0);
				if (inbox.length < 4 + length) break;
				payloads.push(Buffer.from(inbox.subarray(4, 4 + length)));
				inbox = inbox.subarray(4 + length);
			}
		});
		socket.on('close', () => sockets.delete(socket));
		socket.on('error', () => {});
	});
	await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
	const close = () =>
		new Promise<void>((resolve) => {
			for (const s of sockets) s.destroy();
			server.close(() => resolve());
		});
	cleanups.push(close);
	return {
		port: (server.address() as net.AddressInfo).port,
		payloads,
		sockets,
		close,
		messages: () => payloads.map((p) => osc.readPacket(p, { metadata: true }))
	};
}

/** The surface's 11020 end: a real osc.UDPPort sending to a dgram socket. */
async function fakeUdp() {
	const datagrams: Buffer[] = [];
	const receiver = dgram.createSocket('udp4');
	receiver.on('message', (msg) => datagrams.push(Buffer.from(msg)));
	await new Promise<void>((resolve) => receiver.bind(0, '127.0.0.1', resolve));
	const port = new osc.UDPPort({
		localAddress: '127.0.0.1',
		localPort: 0,
		remoteAddress: '127.0.0.1',
		remotePort: receiver.address().port
	});
	await new Promise<void>((resolve) => {
		port.on('ready', resolve);
		port.open();
	});
	cleanups.push(() => {
		port.close();
		receiver.close();
	});
	return { port, datagrams };
}

function client(port: number, extra: Record<string, unknown> = {}) {
	const tcp = createSurfaceTcpClient({ host: '127.0.0.1', port, onMessage: () => {}, ...extra });
	cleanups.push(() => tcp.stop());
	return tcp;
}

/** A port nothing is listening on (bound once to learn a free number). */
async function closedPort(): Promise<number> {
	const probe = net.createServer();
	await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
	const { port } = probe.address() as net.AddressInfo;
	await new Promise<void>((resolve) => probe.close(() => resolve()));
	return port;
}

const TYPED: Packet = {
	address: '/looping/v3/drum/show_for_swap',
	args: [
		{ type: 's', value: 'req-1' },
		{ type: 's', value: 'tracks/2/devices/0' },
		{ type: 'i', value: 38 },
		{ type: 'f', value: 0.5 },
		{ type: 'b', value: Buffer.from([1, 2, 3]) }
	]
};

describe('surfaceLink: the stream while it is up', () => {
	it('sends over TCP with typed args intact, and nothing over UDP', async () => {
		const surface = await fakeSurface();
		const udp = await fakeUdp();
		const tcp = client(surface.port);
		const link = createSurfaceLink({ tcp, udpPort: () => udp.port });
		tcp.start();
		await until(() => tcp.isConnected());

		expect(link.send(TYPED)).toBe('tcp');
		await until(() => surface.payloads.length === 1);

		const [msg] = surface.messages();
		expect(msg.address).toBe(TYPED.address);
		expect(msg.args.map((a: { type: string }) => a.type)).toEqual(['s', 's', 'i', 'f', 'b']);
		expect(msg.args[2].value).toBe(38);
		expect(udp.datagrams).toHaveLength(0);
		expect(link.stats()).toMatchObject({ tcp: 1, udp: 0, leg: 'tcp' });
	});

	it('delivers a burst in the order it was sent', async () => {
		const surface = await fakeSurface();
		const tcp = client(surface.port);
		const link = createSurfaceLink({ tcp, udpPort: () => null });
		tcp.start();
		await until(() => tcp.isConnected());

		for (let i = 0; i < 500; i++) {
			link.send({ address: '/looping/v3/track/volume', args: [{ type: 'i', value: i }] });
		}
		await until(() => surface.payloads.length === 500);

		expect(surface.messages().map((m: { args: { value: number }[] }) => m.args[0].value)).toEqual(
			Array.from({ length: 500 }, (_, i) => i)
		);
	});

	it('puts the same bytes on the stream as on a datagram', async () => {
		const surface = await fakeSurface();
		const udp = await fakeUdp();
		const tcp = client(surface.port);
		const link = createSurfaceLink({ tcp, udpPort: () => udp.port });

		// Down first: UDP.
		expect(link.send(TYPED)).toBe('udp');
		await until(() => udp.datagrams.length === 1);

		tcp.start();
		await until(() => tcp.isConnected());
		expect(link.send(TYPED)).toBe('tcp');
		await until(() => surface.payloads.length === 1);

		expect(surface.payloads[0].equals(udp.datagrams[0])).toBe(true);
	});

	it('carries a UI write routed by the real routeMessageToUDP', async () => {
		const surface = await fakeSurface();
		const udp = await fakeUdp();
		const tcp = client(surface.port);
		const link = createSurfaceLink({ tcp, udpPort: () => udp.port });
		tcp.start();
		await until(() => tcp.isConnected());

		__testing.routeMessageToUDP(
			{
				address: '/looping/v3/handshake/hello',
				args: ['3.12.0', 'etag:0x1f'],
				argsTypes: ['string', 'string']
			},
			{ pythonSurface: link },
			{ routingErrors: 0 }
		);
		__testing.routeMessageToUDP(
			{ address: '/looping/v3/session/auto_arm', args: [1], argsTypes: ['number'] },
			{ pythonSurface: link },
			{ routingErrors: 0 }
		);
		await until(() => surface.payloads.length === 2);

		const [hello, arm] = surface.messages();
		expect(hello.address).toBe('/looping/v3/handshake/hello');
		expect(hello.args.map((a: { value: string }) => a.value)).toEqual(['3.12.0', 'etag:0x1f']);
		// The `number` hint still lands as an OSC int on the stream.
		expect(arm.args[0]).toEqual({ type: 'i', value: 1 });
		expect(udp.datagrams).toHaveLength(0);
	});
});

describe('surfaceLink: UDP only while the stream is down', () => {
	it('sends over UDP when the stream never connected', async () => {
		const udp = await fakeUdp();
		const tcp = client(await closedPort());
		const link = createSurfaceLink({ tcp, udpPort: () => udp.port });

		expect(link.send(TYPED)).toBe('udp');
		await until(() => udp.datagrams.length === 1);
		expect(link.stats()).toMatchObject({ tcp: 0, udp: 1, leg: 'udp' });
	});

	it('throws when the stream is down and there is no UDP port', async () => {
		const tcp = client(await closedPort());
		const link = createSurfaceLink({ tcp, udpPort: () => null });
		expect(() => link.send(TYPED)).toThrow(/not open/);
	});

	it('falls back when the surface goes, and moves back when it returns', async () => {
		const surface = await fakeSurface();
		const udp = await fakeUdp();
		const tcp = client(surface.port);
		const link = createSurfaceLink({ tcp, udpPort: () => udp.port });
		tcp.start();
		await until(() => tcp.isConnected());

		// Live quits: the listener and its connection go.
		await surface.close();
		await until(() => !tcp.isConnected());
		expect(link.send({ address: '/x', args: [{ type: 'i', value: 1 }] })).toBe('udp');

		// Live is back on the same port; a datagram from it kicks the redial.
		const again = await fakeSurface(surface.port);
		expect(tcp.kick()).toBe(true);
		await until(() => tcp.isConnected(), 1000);
		expect(link.send({ address: '/x', args: [{ type: 'i', value: 2 }] })).toBe('tcp');
		await until(() => again.payloads.length === 1);
		expect(again.messages()[0].args[0].value).toBe(2);
	});
});

describe('SurfaceTcpClient.kick', () => {
	it('redials at once instead of waiting out the backoff', async () => {
		const port = await closedPort();
		const tcp = client(port);
		tcp.start();
		// Refused: a redial is now scheduled on the backoff.
		await until(() => tcp.stats().lastError !== '');

		const surface = await fakeSurface(port);
		const t0 = Date.now();
		expect(tcp.kick()).toBe(true);
		await until(() => tcp.isConnected(), 1000);
		// The first backoff alone is 500 ms; a kick connects well inside it.
		expect(Date.now() - t0).toBeLessThan(400);
		// The client sees `connect` before the server's accept callback runs.
		await until(() => surface.sockets.size === 1);
	});

	it('does nothing while connected, and kicks at most once a second', async () => {
		const port = await closedPort();
		const tcp = client(port);
		tcp.start();
		await until(() => tcp.stats().lastError !== '');

		// No listener: the first kick dials (and is refused), the next is held.
		expect(tcp.kick()).toBe(true);
		await until(() => tcp.stats().lastError !== '' && !tcp.isConnected());
		await new Promise((r) => setTimeout(r, 50));
		expect(tcp.kick()).toBe(false);
		expect(tcp.stats().kicks).toBe(1);

		const surface = await fakeSurface(port);
		await until(() => tcp.isConnected(), 12_000);
		expect(tcp.kick()).toBe(false);
		// One connection, and no second one opened by the refused kick.
		await until(() => surface.sockets.size === 1);
		await new Promise((r) => setTimeout(r, 50));
		expect(surface.sockets.size).toBe(1);
	}, 15_000);
});

describe('SurfaceTcpClient: a surface that stops reading', () => {
	it('drops frames past the cap instead of buffering without limit, and never falls back', async () => {
		const surface = await fakeSurface();
		const udp = await fakeUdp();
		const cap = 64 * 1024;
		const tcp = client(surface.port, { maxPendingOutBytes: cap });
		const link = createSurfaceLink({ tcp, udpPort: () => udp.port });
		tcp.start();
		await until(() => tcp.isConnected() && surface.sockets.size === 1);
		// A hung Live: the connection stays up and nothing is read.
		for (const s of surface.sockets) s.pause();

		const blob = { type: 'b', value: Buffer.alloc(16 * 1024) };
		for (let i = 0; i < 2000; i++) link.send({ address: '/x', args: [blob] });

		const stats = tcp.stats();
		expect(stats.droppedOut).toBeGreaterThan(0);
		// Sent frames plus dropped frames account for every write; the
		// kernel and Node together hold no more than the cap plus what the
		// kernel took before Node had to start queueing.
		expect(stats.framesOut + stats.droppedOut).toBe(2000);
		expect(stats.framesOut * 16 * 1024).toBeLessThan(cap + 8 * 1024 * 1024);
		expect(udp.datagrams).toHaveLength(0);
		expect(link.stats()).toMatchObject({ tcp: 2000, udp: 0 });
	});
});
