// @vitest-environment node
/**
 * The pairing gate and flow through the real hook and routes (ADR-491): an
 * unpaired device on the Wi-Fi gets a 401 from every `/api/*` route but the
 * pairing ones, `/api/ws-auth` included; it asks, types the code, gets its
 * cookie, and is trusted from then on. The Mac, Vamp for iPad's relay
 * among it, never pairs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handle } from '../../../hooks.server';
import { POST as requestPairing } from '../../../routes/api/pair/request/+server';
import { POST as sendCode } from '../../../routes/api/pair/code/+server';
import { GET as pairState } from '../../../routes/api/pair/state/+server';
import { createDeviceStore } from '$lib/server/pairing/devices';
import { createPairingRequests, type PairingEvent } from '$lib/server/pairing/requests';
import { DEVICE_COOKIE, _setPairingForTests } from '$lib/server/pairing/service';

vi.mock('$app/environment', () => ({ building: true }));

class FakeCookies {
	jar = new Map<string, string>();
	setCalls: { name: string; value: string; opts: Record<string, unknown> }[] = [];
	get(name: string) {
		return this.jar.get(name);
	}
	set(name: string, value: string, opts: Record<string, unknown>) {
		this.jar.set(name, value);
		this.setCalls.push({ name, value, opts });
	}
}

function event(path: string, address: string, cookies = new FakeCookies(), body?: unknown) {
	const url = new URL(`http://looping-studio-3.local:8889${path}`);
	return {
		url,
		cookies,
		getClientAddress: () => address,
		request: new Request(url, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) })
	} as never;
}

async function through(path: string, address: string, cookies?: FakeCookies): Promise<number> {
	const resolved = vi.fn(async () => new Response('ok'));
	const res = await handle({ event: event(path, address, cookies), resolve: resolved } as never);
	return res.status;
}

let events: PairingEvent[];
beforeEach(() => {
	events = [];
	const store = createDeviceStore(join(mkdtempSync(join(tmpdir(), 'vamp-gate-')), 'devices.json'));
	_setPairingForTests(store, createPairingRequests({ store, notify: (e) => events.push(e), newCode: () => '482913' }));
});
afterEach(() => _setPairingForTests(null, null));

const WIFI = '192.168.50.40';

describe('the gate', () => {
	it('refuses an unpaired device every API route but the pairing flow', async () => {
		expect(await through('/api/ws-auth', WIFI)).toBe(401);
		expect(await through('/api/places/rebuild', WIFI)).toBe(401);
		expect(await through('/api/network', WIFI)).toBe(401);
		expect(await through('/api/pair/devices', WIFI)).toBe(401);
		expect(await through('/api/pair/decide', WIFI)).toBe(401);
		expect(await through('/api/pair/state', WIFI)).toBe(200);
		expect(await through('/api/pair/request', WIFI)).toBe(200);
	});

	it('leaves the page itself open: it is what shows the pairing screen', async () => {
		expect(await through('/', WIFI)).toBe(200);
		expect(await through('/_app/immutable/entry/start.js', WIFI)).toBe(200);
	});

	it('lets the Mac through, and so Vamp for iPad, whose relay is on loopback', async () => {
		expect(await through('/api/ws-auth', '127.0.0.1')).toBe(200);
		expect(await through('/api/ws-auth', '::1')).toBe(200);
	});
});

describe('pairing a device on the Wi-Fi', () => {
	it('asks, types the code, gets its cookie, and is trusted after', async () => {
		const cookies = new FakeCookies();
		const stateBefore = await (await pairState(event('/api/pair/state', WIFI, cookies))).json();
		expect(stateBefore).toMatchObject({ pairing: true, trusted: false });

		const asked = await (await requestPairing(event('/api/pair/request', WIFI, cookies, { name: 'iPad Safari' }))).json();
		expect(asked.id).toBeTruthy();
		expect(events[0]).toMatchObject({ type: 'request', code: '482913', address: WIFI });

		const wrong = await (await sendCode(event('/api/pair/code', WIFI, cookies, { id: asked.id, code: '111111' }))).json();
		expect(wrong).toEqual({ state: 'wrong', triesLeft: 4 });
		expect(cookies.get(DEVICE_COOKIE)).toBeUndefined();

		const right = await (await sendCode(event('/api/pair/code', WIFI, cookies, { id: asked.id, code: '482913' }))).json();
		expect(right).toEqual({ state: 'approved' });
		const set = cookies.setCalls.find((c) => c.name === DEVICE_COOKIE)!;
		expect(set.opts).toMatchObject({ httpOnly: true, sameSite: 'strict', secure: false, path: '/' });
		expect(set.opts.maxAge).toBeGreaterThan(300 * 24 * 3600);

		expect(await through('/api/ws-auth', WIFI, cookies)).toBe(200);
		// From another address too: the cookie is the device, not the network.
		expect(await through('/api/ws-auth', '10.0.0.9', cookies)).toBe(200);
	});

	it('a forged cookie is no cookie', async () => {
		const cookies = new FakeCookies();
		cookies.jar.set(DEVICE_COOKIE, 'made-up-token');
		expect(await through('/api/ws-auth', WIFI, cookies)).toBe(401);
	});
});
