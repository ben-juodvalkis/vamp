// @vitest-environment node
// (Real sockets below: under jsdom a Node `Buffer` is not the realm's
// `Uint8Array`, so osc.js cannot decode what arrives and throws.)
/**
 * Every configured UDP endpoint must be created, handled, opened and closed.
 *
 * `UDPPortManager` used to maintain **four** hand-written lists —
 * `createUDPPorts`, `setupAllPortHandlers`, `openAllPorts`, `closeAllPorts` —
 * and adding an endpoint meant editing all four. Adding `totalmix` /
 * `totalmixDevice` to only the first two produced a bridge that constructed the
 * ports, logged "Inbound source missing from udpPorts", and then never bound
 * them: messages to 11019 vanished with no error anywhere. That failure is
 * completely silent from the outside — the port simply does not answer —
 * which is exactly the kind of thing a test should catch instead of an
 * afternoon of debugging.
 *
 * Since the feature switches (general-release audit §7b) the last three walk
 * whatever `createUDPPorts` built, so a switched-off endpoint needs no guard in
 * each. What is left to assert: the one remaining list builds every endpoint
 * `constants.json` configures, the other three reach every port they are
 * given, an endpoint left out of the config is never built — which is how a
 * switched-off feature binds nothing — and every socket binds loopback, read
 * back off the options and then measured on real sockets. None of it names a
 * particular endpoint, so it keeps working as endpoints come and go.
 */

import { describe, it, expect } from 'vitest';
import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';

import constants from '$config/constants.json';
import * as portManager from '../../../../bridge/transport/UDPPortManager.js';

/**
 * Endpoints the bridge is expected to wire up: every `osc.*` entry that names
 * both a localPort and a remotePort. Entries like `footTrigger` (input only)
 * and `webSocket` are deliberately not UDP port pairs and are excluded.
 */
const CONFIGURED = Object.entries(constants.osc as Record<string, unknown>)
	.filter(([key, value]) => {
		if (key.startsWith('_')) return false;
		const v = value as Record<string, unknown>;
		return v && typeof v === 'object' && 'localPort' in v && 'remotePort' in v;
	})
	.map(([key]) => key);

/** Endpoints the bridge does not own a socket for, with the reason why. */
const NOT_BRIDGE_OWNED: Record<string, string> = {
	// Borrowed for ~1s at startup by totalmixBootstrap.js, which opens and
	// closes its own socket so port 7001 is not held for the run (ADR-423).
	// It binds all interfaces, deliberately: TotalMix's controller 1 sends to
	// `looping-studio-2.local`, which resolves to the LAN address too.
	totalmixLegacy: 'opened transiently by totalmixBootstrap, not UDPPortManager'
};

const EXPECTED = CONFIGURED.filter((name) => !(name in NOT_BRIDGE_OWNED));

/** Endpoints the bridge builds only while their feature switch is on. */
const SWITCHED = ['totalmix', 'totalmixDevice'];

/** A stand-in port that records which of the manager's calls reached it. */
function recordingPort() {
	const calls: string[] = [];
	return {
		calls,
		on: (event: string) => calls.push(`on:${event}`),
		open: () => calls.push('open'),
		close: () => calls.push('close')
	};
}

describe('UDPPortManager endpoint coverage', () => {
	it('has endpoints to check', () => {
		// Four since 2026-09-25: pythonSurface, loopingRecorder, totalmix,
		// totalmixDevice. (The Max observer, Omnisphere, NI and shell-helper
		// pairs went 2026-09-23; midiConverter, the wheels' route to the
		// standalone Max patch, went when the wheels moved to MidiWheels.)
		expect(EXPECTED.length).toBeGreaterThanOrEqual(4);
		expect(EXPECTED).not.toContain('midiConverter');
	});

	it('createUDPPorts constructs every configured endpoint', () => {
		// Constructing an osc.UDPPort binds nothing; `open()` does.
		const built = Object.keys(createPorts(configured())).sort();
		expect(built, 'createUDPPorts built a different set of endpoints').toEqual([...EXPECTED].sort());
	});

	it('builds no socket for an endpoint the config leaves out', () => {
		// How a switched-off feature binds nothing: the bridge drops its
		// entries from the config it hands over (general-release audit §7b).
		const config = configured();
		for (const name of SWITCHED) delete config[name];
		const built = Object.keys(createPorts(config));
		expect(built.filter((name) => SWITCHED.includes(name))).toEqual([]);
		expect(built.sort()).toEqual(EXPECTED.filter((name) => !SWITCHED.includes(name)).sort());
	});

	it.each([
		['setupAllPortHandlers', 'on:error'],
		['openAllPorts', 'open'],
		['closeAllPorts', 'close']
	])('%s reaches every port it is given', (fn, call) => {
		// The switched pair is absent here and every other endpoint present,
		// so a function that still named ports would either throw on the
		// missing pair or skip one that is there.
		const names = EXPECTED.filter((name) => !SWITCHED.includes(name));
		const ports = Object.fromEntries(names.map((name) => [name, recordingPort()]));
		const run = (portManager as unknown as Record<string, (...args: unknown[]) => void>)[fn];
		run(ports, configured(), { pythonSurface: 'unknown' });
		const missed = names.filter((name) => !ports[name].calls.includes(call));
		expect(
			missed,
			`${fn} never reached: ${missed.join(', ')}. A port it skips is ` +
				'constructed but never bound — messages to it vanish silently.'
		).toEqual([]);
	});

	it('every excluded endpoint has a documented reason', () => {
		for (const name of Object.keys(NOT_BRIDGE_OWNED)) {
			expect(CONFIGURED, `${name} is excluded but no longer configured`).toContain(name);
			expect(NOT_BRIDGE_OWNED[name].length).toBeGreaterThan(10);
		}
	});

	/*
	 * Whatever the middleware does not consume goes to every WS client, and
	 * the message handler in `enhanced-osc-bridge.js` takes `(oscMessage)` and
	 * drops osc.js's third `rinfo` argument, so there is no source check in JS
	 * at all — the bind address IS the check. On 0.0.0.0 one datagram from any
	 * LAN host went around the WebSocket auth gate: `/capture/file <path>` to
	 * 11017 made every client load that file, `/totalmix/*` to 11019 reached
	 * the mixer, `session/save_as_request` to 11021 went straight into the AX
	 * helper. Constructing a UDPPort does not bind it; `open()` does. This
	 * reads the options back off the constructed ports.
	 */
	it('binds every bridge-owned inbound port to loopback', () => {
		const ports = createPorts(configured());
		const exposed = EXPECTED.filter((name) => ports[name].options.localAddress !== '127.0.0.1');
		expect(
			exposed,
			`${exposed.join(', ')} bind beyond loopback: one datagram from any LAN host ` +
				'reaches every WS client, around the WebSocket auth gate entirely'
		).toEqual([]);
	});
});

type BridgePort = {
	options: { localAddress: string };
	socket: dgram.Socket;
	on: (event: string, listener: (...args: unknown[]) => void) => void;
	open: () => void;
	close: () => void;
};

function createPorts(config: object): Record<string, BridgePort> {
	return (
		portManager as unknown as { createUDPPorts: (c: object) => Record<string, BridgePort> }
	).createUDPPorts(config);
}

/** Every bridge-owned endpoint's config, optionally with `localPort` overridden. */
function configured(localPort?: number): Record<string, unknown> {
	return Object.fromEntries(
		EXPECTED.map((name) => {
			const entry = (constants.osc as Record<string, unknown>)[name] as Record<string, unknown>;
			return [name, localPort === undefined ? entry : { ...entry, localPort }];
		})
	);
}

/**
 * A non-loopback IPv4 address of this machine, when it has one (a sandbox
 * may not). A VPN's point-to-point address is passed over while a real one
 * exists: Tailscale's (100.64.0.0/10, on a utun interface) came first on
 * one Mac, and a datagram to it did not reliably come back, so the positive
 * control failed under the full gate's load and passed alone.
 */
const isCgnat = (address: string) => {
	const [a, b] = address.split('.').map(Number);
	return a === 100 && b >= 64 && b <= 127;
};
const LAN_CANDIDATES = Object.values(networkInterfaces())
	.flat()
	.filter((info) => info?.family === 'IPv4' && !info.internal)
	.map((info) => info!.address);
const LAN_ADDRESS = LAN_CANDIDATES.find((address) => !isCgnat(address)) ?? LAN_CANDIDATES[0];

/** `/probe` with no arguments, as OSC: the address and the `,` type tag, each NUL-padded to 4. */
const PROBE = Buffer.from('/probe\0\0,\0\0\0', 'binary');

/*
 * The options check above trusts that osc.js binds what it is given. This
 * measures it: every bridge socket opened for real (on ephemeral ports, so a
 * running rig's own sockets are untouched), a datagram sent to this machine's
 * LAN address, and one sent to 127.0.0.1. The same LAN datagram to a 0.0.0.0
 * socket is the positive control — without it, silence could mean the network
 * dropped everything, not that the bind refused it.
 */
describe.runIf(LAN_ADDRESS)('the loopback bind, on real sockets', () => {
	it(`drops a datagram sent to ${LAN_ADDRESS} and takes one sent to 127.0.0.1`, async (ctx) => {
		const ports = createPorts(configured(0));
		const control = dgram.createSocket('udp4');
		const sender = dgram.createSocket('udp4');
		const received = new Map<string, number>();
		const count = (name: string) => () => received.set(name, (received.get(name) ?? 0) + 1);
		const send = (address: string, port: number) =>
			new Promise<void>((resolve, reject) =>
				sender.send(PROBE, port, address, (err) => (err ? reject(err) : resolve()))
			);
		const settle = () => new Promise((resolve) => setTimeout(resolve, 250));
		try {
			await Promise.all(
				Object.values(ports).map(
					(port) =>
						new Promise<void>((resolve, reject) => {
							port.on('ready', () => resolve());
							port.on('error', (err) => reject(err));
							port.open();
						})
				)
			);
			await new Promise<void>((resolve) => control.bind(0, '0.0.0.0', () => resolve()));
			control.on('message', count('control'));
			for (const name of EXPECTED) ports[name].socket.on('message', count(name));

			for (const name of EXPECTED) {
				expect(ports[name].socket.address().address, name).toBe('127.0.0.1');
			}

			await send(LAN_ADDRESS as string, control.address().port);
			for (const name of EXPECTED) await send(LAN_ADDRESS as string, ports[name].socket.address().port);
			await settle();
			// No control means this machine's network dropped the LAN datagram
			// before any socket saw it (macOS's firewall in stealth mode did,
			// under the pre-push gate's load): the test can say nothing about
			// the bind then, so it is skipped rather than failed.
			if (!received.has('control')) return ctx.skip();
			expect(received.get('control'), 'positive control: the LAN datagram arrived more than once').toBe(1);
			expect(EXPECTED.filter((name) => received.has(name)), 'reached over the LAN address').toEqual([]);

			for (const name of EXPECTED) await send('127.0.0.1', ports[name].socket.address().port);
			await settle();
			expect(EXPECTED.filter((name) => received.get(name) !== 1), 'missed over loopback').toEqual([]);
		} finally {
			for (const port of Object.values(ports)) port.close();
			control.close();
			sender.close();
		}
	});
});
