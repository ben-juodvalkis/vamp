/**
 * `POST /api/pair/code {id, code}` → `{state, triesLeft?}`: the code from
 * Live's status bar, typed on the device (ADR-491). Right, and the cookie is
 * set with the answer; wrong five times, and the request is refused.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { callerAddress, DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, pairingRequests } from '$lib/server/pairing/service';

export const POST: RequestHandler = async (event) => {
	let id = '';
	let code = '';
	try {
		const body = await event.request.json();
		id = String(body?.id ?? '');
		code = String(body?.code ?? '');
	} catch {
		return json({ state: 'unknown' }, { status: 400 });
	}
	const { token, ...answer } = pairingRequests().tryCode(id, callerAddress(event), code);
	if (token) event.cookies.set(DEVICE_COOKIE, token, DEVICE_COOKIE_OPTIONS);
	return json(answer, { headers: { 'cache-control': 'no-store' } });
};
