/**
 * `GET /api/pair/status?id=` → `{state}` for the device that asked (ADR-491).
 * The poll that finds the request approved sets the device's cookie: from
 * then on it is trusted.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { callerAddress, DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, pairingRequests } from '$lib/server/pairing/service';

export const GET: RequestHandler = (event) => {
	const id = event.url.searchParams.get('id') ?? '';
	const { state, token } = pairingRequests().status(id, callerAddress(event));
	if (token) event.cookies.set(DEVICE_COOKIE, token, DEVICE_COOKIE_OPTIONS);
	return json({ state }, { headers: { 'cache-control': 'no-store' } });
};
