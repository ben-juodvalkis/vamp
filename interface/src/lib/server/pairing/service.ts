/**
 * Pairing, wired for the server (ADR-491): the switch, the one device store
 * and request list, the bridge relay, the cookie, and `trustOf`, the single
 * answer to "may this caller drive Live?" that `hooks.server.ts` and the
 * pairing routes ask.
 *
 * Trusted: everyone while the switch is off (`osc.webSocket.auth.pairing`
 * false); else the Mac itself — Vamp for iPad over the cable included, see
 * `trust.ts` — and a device whose cookie is a paired token.
 */
import type { Cookies } from '@sveltejs/kit';
import { configSection, repoRoot } from '$lib/server/runtimeConfig';
import { resolveSecret } from '$lib/server/wsSecret';
import { createDeviceStore, defaultDevicesFile, type DeviceStore, type PairedDevice } from './devices';
import { createPairingRequests, type PairingEvent, type PairingRequests } from './requests';
import { isTheMac } from './trust';

export const DEVICE_COOKIE = 'vamp_device';
const YEAR_S = 365 * 24 * 60 * 60;

/** HttpOnly and SameSite=Strict; not Secure, because the page is plain HTTP. */
export const DEVICE_COOKIE_OPTIONS = {
	path: '/',
	httpOnly: true,
	sameSite: 'strict' as const,
	secure: false,
	maxAge: YEAR_S
};

/** On unless the config says `false`, like the auth gate it extends. */
export function pairingEnabled(): boolean {
	const ws = configSection<{ webSocket?: { auth?: { pairing?: unknown } } }>('osc').webSocket;
	return ws?.auth?.pairing !== false;
}

async function notifyBridge(event: PairingEvent): Promise<void> {
	const secret = resolveSecret();
	const port = configSection<{ webSocket?: { port?: number } }>('osc').webSocket?.port ?? 8081;
	if (!secret) return;
	try {
		await fetch(`http://127.0.0.1:${port}/pairing`, {
			method: 'POST',
			headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
			body: JSON.stringify(event),
			signal: AbortSignal.timeout(2000)
		});
	} catch {
		// No bridge: the device still pairs by Allow from a trusted screen
		// that is open, or later; only the status bar line is lost.
	}
}

let store: DeviceStore | null = null;
let requests: PairingRequests | null = null;

export function deviceStore(): DeviceStore {
	store ??= createDeviceStore(defaultDevicesFile(repoRoot()));
	return store;
}

export function pairingRequests(): PairingRequests {
	requests ??= createPairingRequests({ store: deviceStore(), notify: (e) => void notifyBridge(e) });
	return requests;
}

/** Test seam: swap in a store and a request list built on it. */
export function _setPairingForTests(s: DeviceStore | null, r: PairingRequests | null): void {
	store = s;
	requests = r;
}

export interface TrustCaller {
	getClientAddress: () => string;
	cookies: Cookies;
}

export type Trust =
	| { trusted: true; via: 'off' | 'mac' }
	| { trusted: true; via: 'device'; device: PairedDevice }
	| { trusted: false; via: 'none'; address: string };

export function callerAddress(event: TrustCaller): string {
	try {
		return event.getClientAddress();
	} catch {
		return '';
	}
}

export function trustOf(event: TrustCaller): Trust {
	if (!pairingEnabled()) return { trusted: true, via: 'off' };
	const address = callerAddress(event);
	if (isTheMac(address)) return { trusted: true, via: 'mac' };
	const token = event.cookies.get(DEVICE_COOKIE);
	const device = deviceStore().verify(token);
	if (device && token) {
		// Renewed on each use: a year from the last time it was seen.
		event.cookies.set(DEVICE_COOKIE, token, DEVICE_COOKIE_OPTIONS);
		return { trusted: true, via: 'device', device };
	}
	return { trusted: false, via: 'none', address };
}

/** Routes an unpaired device may reach: the pairing flow itself. */
export const OPEN_PAIRING_ROUTES = ['/api/pair/state', '/api/pair/request', '/api/pair/status', '/api/pair/code'];
