/**
 * `GET /api/pair/state` → `{ pairing, trusted }`: whether pairing is on, and
 * whether this caller may drive Live (ADR-491). The page asks on load, so an
 * unpaired device shows the pairing screen instead of a dead interface.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { pairingEnabled, trustOf } from '$lib/server/pairing/service';

export const GET: RequestHandler = (event) => {
	const trust = trustOf(event);
	return json(
		{ pairing: pairingEnabled(), trusted: trust.trusted, via: trust.via },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
