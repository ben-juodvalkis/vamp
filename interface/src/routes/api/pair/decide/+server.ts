/**
 * Allow or Ignore, from a trusted screen's banner (ADR-491).
 * `GET` → the requests still waiting (for a screen opened after they were
 * announced); `POST {id, allow}` → `{ok}`. Behind the hook's trust gate.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { pairingRequests } from '$lib/server/pairing/service';

export const GET: RequestHandler = () =>
	json({ waiting: pairingRequests().waiting() }, { headers: { 'cache-control': 'no-store' } });

export const POST: RequestHandler = async ({ request }) => {
	let id = '';
	let allow = false;
	try {
		const body = await request.json();
		id = String(body?.id ?? '');
		allow = body?.allow === true;
	} catch {
		return json({ ok: false }, { status: 400 });
	}
	return json({ ok: pairingRequests().decide(id, allow) });
};
