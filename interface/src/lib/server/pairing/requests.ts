/**
 * Pairing requests (ADR-491, security.plan.md "Pairing").
 *
 * A device that is not trusted asks to pair; the Mac shows a 6-digit code in
 * Live's status bar and an Allow banner on the trusted screens, and the
 * request is approved by the code typed on the device or by Allow. The
 * device polls about once a second and collects its token on the poll that
 * finds it approved.
 *
 * The code is good for 2 minutes and 5 tries; a request is tied to the
 * address that made it, so another device cannot collect its token; and a
 * device may open a request no more than once every 10 s and 6 times in 10
 * minutes, so nobody can flood the status bar or the banners.
 */
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { DeviceStore } from './devices';
import { normalizeAddress } from './trust';

export const CODE_TTL_MS = 2 * 60 * 1000;
export const MAX_TRIES = 5;
export const MIN_REQUEST_GAP_MS = 10 * 1000;
export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const MAX_REQUESTS_PER_WINDOW = 6;
/** Settled requests are kept this long, so a slow poll still learns how it ended. */
const SETTLED_KEEP_MS = 5 * 60 * 1000;

export type RequestState = 'waiting' | 'approved' | 'refused' | 'expired';

interface PairRequest {
	id: string;
	name: string;
	address: string;
	code: string;
	expiresAt: number;
	tries: number;
	state: RequestState;
	settledAt: number;
	/** Held from approval until the device's next poll collects it. */
	token: string | null;
}

export type PairingEvent =
	| { type: 'request'; id: string; name: string; address: string; code: string }
	| { type: 'resolved'; id: string; outcome: RequestState };

export interface RequestsOptions {
	store: DeviceStore;
	notify: (event: PairingEvent) => void;
	now?: () => number;
	newCode?: () => string;
}

export function createPairingRequests({
	store,
	notify,
	now = Date.now,
	newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0')
}: RequestsOptions) {
	const requests = new Map<string, PairRequest>();
	const opened = new Map<string, number[]>();

	function settle(r: PairRequest, state: RequestState): void {
		if (r.state !== 'waiting') return;
		r.state = state;
		r.settledAt = now();
		notify({ type: 'resolved', id: r.id, outcome: state });
	}

	function sweep(): void {
		const t = now();
		for (const r of requests.values()) {
			if (r.state === 'waiting' && t >= r.expiresAt) settle(r, 'expired');
			if (r.state !== 'waiting' && t - r.settledAt > SETTLED_KEEP_MS) requests.delete(r.id);
		}
	}

	function approve(r: PairRequest): void {
		r.token = store.issue(r.name, r.address);
		settle(r, 'approved');
	}

	/** How a request stands, for the device that made it; the token once, when approved. */
	function status(id: string, address: string): { state: RequestState | 'unknown'; token?: string } {
		const r = mine(id, address);
		if (!r) return { state: 'unknown' };
		if (r.state === 'approved' && r.token) {
			const token = r.token;
			r.token = null;
			return { state: 'approved', token };
		}
		return { state: r.state };
	}

	function mine(id: string, address: string): PairRequest | null {
		sweep();
		const r = requests.get(id);
		return r && r.address === normalizeAddress(address) ? r : null;
	}

	return {
		open(name: string, rawAddress: string):
			| { ok: true; id: string; expiresInMs: number }
			| { ok: false; reason: 'rate-limited'; retryInMs: number } {
			sweep();
			const address = normalizeAddress(rawAddress);
			const t = now();
			const times = (opened.get(address) ?? []).filter((x) => t - x < RATE_WINDOW_MS);
			const last = times[times.length - 1];
			if (last !== undefined && t - last < MIN_REQUEST_GAP_MS)
				return { ok: false, reason: 'rate-limited', retryInMs: MIN_REQUEST_GAP_MS - (t - last) };
			if (times.length >= MAX_REQUESTS_PER_WINDOW)
				return { ok: false, reason: 'rate-limited', retryInMs: RATE_WINDOW_MS - (t - times[0]) };
			times.push(t);
			opened.set(address, times);

			// One live request per device: a new one replaces its earlier one.
			for (const r of requests.values()) if (r.address === address) settle(r, 'expired');

			const r: PairRequest = {
				id: randomBytes(16).toString('base64url'),
				name: name.trim().slice(0, 40) || 'A device',
				address,
				code: newCode(),
				expiresAt: t + CODE_TTL_MS,
				tries: 0,
				state: 'waiting',
				settledAt: 0,
				token: null
			};
			requests.set(r.id, r);
			notify({ type: 'request', id: r.id, name: r.name, address: r.address, code: r.code });
			return { ok: true, id: r.id, expiresInMs: CODE_TTL_MS };
		},

		status,

		/** The code typed on the device. */
		tryCode(
			id: string,
			address: string,
			code: string
		): { state: RequestState | 'unknown' | 'wrong'; triesLeft?: number; token?: string } {
			const r = mine(id, address);
			if (!r) return { state: 'unknown' };
			if (r.state !== 'waiting') return status(id, address);
			const given = Buffer.from(String(code).replace(/\D/g, ''));
			const expected = Buffer.from(r.code);
			if (given.length === expected.length && timingSafeEqual(given, expected)) {
				approve(r);
				return status(id, address);
			}
			r.tries += 1;
			if (r.tries >= MAX_TRIES) {
				settle(r, 'refused');
				return { state: 'refused' };
			}
			return { state: 'wrong', triesLeft: MAX_TRIES - r.tries };
		},

		/** Allow or Ignore, from a trusted screen. */
		decide(id: string, allow: boolean): boolean {
			sweep();
			const r = requests.get(id);
			if (!r || r.state !== 'waiting') return false;
			if (allow) approve(r);
			else settle(r, 'refused');
			return true;
		},

		/** Requests still waiting, for a trusted screen that opens after they were announced. */
		waiting(): { id: string; name: string; address: string }[] {
			sweep();
			return [...requests.values()]
				.filter((r) => r.state === 'waiting')
				.map((r) => ({ id: r.id, name: r.name, address: r.address }));
		}
	};
}

export type PairingRequests = ReturnType<typeof createPairingRequests>;
