// @vitest-environment node
/**
 * Pairing (ADR-491, security.plan.md): who is the Mac, what is kept of a
 * paired device, and the rules a request lives by.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isTheMac, normalizeAddress } from '$lib/server/pairing/trust';
import { createDeviceStore, hashToken } from '$lib/server/pairing/devices';
import {
	CODE_TTL_MS,
	MAX_TRIES,
	MIN_REQUEST_GAP_MS,
	createPairingRequests,
	type PairingEvent
} from '$lib/server/pairing/requests';

const OWN = new Set(['192.168.50.12', '169.254.72.248', 'fe80::1']);

describe('the Mac itself', () => {
	it('is loopback, in any spelling', () => {
		for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.4.5.6']) expect(isTheMac(a, OWN)).toBe(true);
	});

	it("is one of the Mac's own addresses: a browser on the Mac using its LAN address", () => {
		expect(isTheMac('192.168.50.12', OWN)).toBe(true);
		expect(isTheMac('::ffff:192.168.50.12', OWN)).toBe(true);
		expect(isTheMac('fe80::1%en0', OWN)).toBe(true);
	});

	it('is not a device on the Wi-Fi, nor an iPad on the self-assigned cable link', () => {
		expect(isTheMac('192.168.50.40', OWN)).toBe(false);
		// The Mac's own link-local address is trusted; the iPad's end is not.
		expect(isTheMac('169.254.110.138', OWN)).toBe(false);
		expect(isTheMac('', OWN)).toBe(false);
	});

	it('normalizes mapped and zoned addresses', () => {
		expect(normalizeAddress('::FFFF:10.0.0.2')).toBe('10.0.0.2');
		expect(normalizeAddress('fe80::2%en15')).toBe('fe80::2');
	});
});

describe('the paired-device store', () => {
	let file: string;
	beforeEach(() => {
		file = join(mkdtempSync(join(tmpdir(), 'vamp-pair-')), '.paired-devices.json');
	});

	it('keeps only the hash of a token, in a file only the owner can read', () => {
		const store = createDeviceStore(file);
		const token = store.issue('iPad Safari', '192.168.50.40');
		const disk = readFileSync(file, 'utf8');
		expect(disk).not.toContain(token);
		expect(disk).toContain(hashToken(token));
		expect(statSync(file).mode & 0o777).toBe(0o600);
	});

	it('knows a paired token, and not another', () => {
		const store = createDeviceStore(file);
		const token = store.issue('iPad Safari', '192.168.50.40');
		expect(store.verify(token)?.name).toBe('iPad Safari');
		expect(store.verify('not-a-token')).toBeNull();
		expect(store.verify(undefined)).toBeNull();
		// A fresh store reads the same file.
		expect(createDeviceStore(file).verify(token)?.name).toBe('iPad Safari');
	});

	it('forgets one device, or all of them', () => {
		const store = createDeviceStore(file);
		const a = store.issue('A', '10.0.0.1');
		const b = store.issue('B', '10.0.0.2');
		expect(store.forget(hashToken(a))).toBe(true);
		expect(store.verify(a)).toBeNull();
		expect(store.verify(b)?.name).toBe('B');
		expect(store.forgetAll()).toBe(1);
		expect(store.list()).toEqual([]);
	});
});

describe('a pairing request', () => {
	let now = 1_000_000;
	let events: PairingEvent[];
	let requests: ReturnType<typeof createPairingRequests>;
	let store: ReturnType<typeof createDeviceStore>;

	beforeEach(() => {
		now = 1_000_000;
		events = [];
		store = createDeviceStore(join(mkdtempSync(join(tmpdir(), 'vamp-pair-')), 'devices.json'), () => now);
		requests = createPairingRequests({
			store,
			notify: (e) => events.push(e),
			now: () => now,
			newCode: () => '482913'
		});
	});

	function open(address = '192.168.50.40') {
		const r = requests.open('iPad Safari', address);
		if (!r.ok) throw new Error('rate-limited');
		return r.id;
	}

	it('announces itself with its code, and pairs on the right code', () => {
		const id = open();
		expect(events[0]).toMatchObject({ type: 'request', name: 'iPad Safari', address: '192.168.50.40', code: '482913' });
		const answer = requests.tryCode(id, '192.168.50.40', '482 913');
		expect(answer.state).toBe('approved');
		expect(store.verify(answer.token)?.name).toBe('iPad Safari');
		expect(events.at(-1)).toMatchObject({ type: 'resolved', outcome: 'approved' });
	});

	it('hands the token out once', () => {
		const id = open();
		requests.decide(id, true);
		const first = requests.status(id, '192.168.50.40');
		expect(first.state).toBe('approved');
		expect(first.token).toBeTruthy();
		expect(requests.status(id, '192.168.50.40')).toEqual({ state: 'approved' });
	});

	it('answers only the device that asked: another address cannot collect its token', () => {
		const id = open('192.168.50.40');
		requests.decide(id, true);
		expect(requests.status(id, '192.168.50.66')).toEqual({ state: 'unknown' });
		expect(requests.tryCode(id, '192.168.50.66', '482913')).toEqual({ state: 'unknown' });
		expect(requests.status(id, '192.168.50.40').token).toBeTruthy();
	});

	it(`refuses after ${MAX_TRIES} wrong codes`, () => {
		const id = open();
		for (let i = 1; i < MAX_TRIES; i++) {
			expect(requests.tryCode(id, '192.168.50.40', '000000')).toEqual({ state: 'wrong', triesLeft: MAX_TRIES - i });
		}
		expect(requests.tryCode(id, '192.168.50.40', '000000')).toEqual({ state: 'refused' });
		expect(requests.tryCode(id, '192.168.50.40', '482913').state).toBe('refused');
		expect(store.list()).toHaveLength(0);
	});

	it('runs out after two minutes', () => {
		const id = open();
		now += CODE_TTL_MS;
		expect(requests.status(id, '192.168.50.40').state).toBe('expired');
		expect(requests.tryCode(id, '192.168.50.40', '482913').state).toBe('expired');
		expect(events.at(-1)).toMatchObject({ type: 'resolved', outcome: 'expired' });
	});

	it('Ignore refuses it, and a settled request takes no decision', () => {
		const id = open();
		expect(requests.decide(id, false)).toBe(true);
		expect(requests.status(id, '192.168.50.40').state).toBe('refused');
		expect(requests.decide(id, true)).toBe(false);
	});

	it('limits how often one device may ask, and a new request replaces its earlier one', () => {
		const first = open();
		expect(requests.open('again', '192.168.50.40')).toMatchObject({ ok: false, reason: 'rate-limited' });
		now += MIN_REQUEST_GAP_MS;
		const second = open();
		expect(requests.status(first, '192.168.50.40').state).toBe('expired');
		expect(requests.waiting().map((r) => r.id)).toEqual([second]);
	});

	it('limits a device to six requests in ten minutes, but not other devices', () => {
		for (let i = 0; i < 6; i++) {
			open();
			now += MIN_REQUEST_GAP_MS;
		}
		expect(requests.open('seventh', '192.168.50.40')).toMatchObject({ ok: false, reason: 'rate-limited' });
		expect(requests.open('other', '192.168.50.41').ok).toBe(true);
	});

	it('lists the waiting requests for a screen that opens late, without codes', () => {
		open('192.168.50.40');
		const waiting = requests.waiting();
		expect(waiting).toEqual([{ id: expect.any(String), name: 'iPad Safari', address: '192.168.50.40' }]);
		expect(JSON.stringify(waiting)).not.toContain('482913');
	});
});
