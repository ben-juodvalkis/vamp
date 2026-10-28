// @vitest-environment node
/**
 * The bridge's pairing relay (ADR-491): the interface server POSTs each
 * request and its outcome; the relay passes them to the trusted screens and
 * Live's status bar. It must take them from this Mac, with the secret, only:
 * its port is on every interface, and a forged request would put a code in
 * Live's status bar and a banner on the performer's screen.
 */
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { createPairingRelay, PAIRING_ADDRESS } = nodeRequire('../../../../bridge/handlers/pairingRelay.js');

const SECRET = 'relay-test-secret';
let server: http.Server | null = null;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

async function relay() {
	const broadcasts: { address: string; args: unknown[] }[] = [];
	const shown: string[] = [];
	const handle = createPairingRelay({
		secret: SECRET,
		broadcast: (address: string, args: unknown[]) => broadcasts.push({ address, args }),
		showInLive: (text: string) => shown.push(text),
		logger: { info() {}, warn() {} }
	});
	server = http.createServer(handle);
	await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
	const port = (server!.address() as AddressInfo).port;
	const post = async (body: unknown, auth = `Bearer ${SECRET}`, method = 'POST') =>
		(
			await fetch(`http://127.0.0.1:${port}/pairing`, {
				method,
				headers: { authorization: auth },
				body: method === 'POST' ? JSON.stringify(body) : undefined
			})
		).status;
	return { broadcasts, shown, post };
}

describe('the pairing relay', () => {
	it('passes a request to the trusted screens without its code, and the code to Live', async () => {
		const r = await relay();
		const status = await r.post({ type: 'request', id: 'abc', name: 'iPad Safari', address: '192.168.50.40', code: '482913' });
		expect(status).toBe(204);
		expect(r.broadcasts).toHaveLength(1);
		expect(r.broadcasts[0].address).toBe(PAIRING_ADDRESS);
		const sent = JSON.parse(r.broadcasts[0].args[0] as string);
		expect(sent).toEqual({ type: 'request', id: 'abc', name: 'iPad Safari', address: '192.168.50.40' });
		expect(r.shown).toEqual(['Vamp: iPad Safari (192.168.50.40) wants to connect. Code 482913']);
	});

	it('closes the banners and clears the status bar when a request ends', async () => {
		const r = await relay();
		expect(await r.post({ type: 'resolved', id: 'abc', outcome: 'approved' })).toBe(204);
		expect(JSON.parse(r.broadcasts[0].args[0] as string)).toEqual({ type: 'resolved', id: 'abc', outcome: 'approved' });
		expect(r.shown).toEqual(['']);
	});

	it('refuses a request without the secret, and anything but a POST', async () => {
		const r = await relay();
		expect(await r.post({ type: 'request', id: 'x', code: '1' }, 'Bearer wrong')).toBe(401);
		expect(await r.post({ type: 'request', id: 'x', code: '1' }, '')).toBe(401);
		expect(await r.post(undefined, `Bearer ${SECRET}`, 'GET')).toBe(405);
		expect(r.broadcasts).toHaveLength(0);
		expect(r.shown).toHaveLength(0);
	});

	it('refuses what it cannot read', async () => {
		const r = await relay();
		expect(await r.post({ type: 'mystery', id: 'x' })).toBe(400);
		expect(await r.post({ type: 'request' })).toBe(400);
	});

	it('keeps a name to one short line', async () => {
		const r = await relay();
		await r.post({ type: 'request', id: 'a', name: 'iPad\nSafari\t' + 'x'.repeat(100), address: '', code: '1' });
		expect(r.shown[0]).toMatch(/^Vamp: iPad Safari x+ wants to connect\. Code 1$/);
		expect(r.shown[0].length).toBeLessThan(90);
	});
});
