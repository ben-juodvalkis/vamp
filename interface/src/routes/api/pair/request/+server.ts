/**
 * `POST /api/pair/request {name}` → `{id, expiresInMs}`: ask to pair
 * (ADR-491). The Mac shows a code in Live's status bar and an Allow banner on
 * the trusted screens. A trusted caller gets `{trusted: true}`; one asking
 * too often gets a 429 with how long to wait.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { callerAddress, pairingRequests, trustOf } from '$lib/server/pairing/service';

export const POST: RequestHandler = async (event) => {
	if (trustOf(event).trusted) return json({ trusted: true });
	let name = '';
	try {
		const body = await event.request.json();
		name = typeof body?.name === 'string' ? body.name : '';
	} catch {
		/* no body: a nameless device */
	}
	const opened = pairingRequests().open(name, callerAddress(event));
	if (!opened.ok) return json(opened, { status: 429 });
	return json({ id: opened.id, expiresInMs: opened.expiresInMs }, { headers: { 'cache-control': 'no-store' } });
};
