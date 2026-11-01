/**
 * `PUT /api/places/effects {"place": "<sidebar name>" | ""}` — save the
 * effects folder (ADR-498): the Place + Effect opens and the app's own
 * effects are found in, '' for Live's Audio Effects. The Mac keeps it in
 * `logs/effects.json`. Answers the new listing; a name no Place has is a 400.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { placesService } from '$lib/server/places/service';

export const PUT: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, code: 'bad-request', detail: 'body must be JSON' }, { status: 400 });
	}
	const place = (body as { place?: unknown })?.place;
	if (typeof place !== 'string') {
		return json({ ok: false, code: 'bad-request', detail: 'place must be a sidebar name, or "" for Live\'s Audio Effects' }, { status: 400 });
	}
	const listing = placesService().setEffectsPlace(place);
	if (!listing) return json({ ok: false, code: 'unknown-place', detail: `no Place named ${place}` }, { status: 400 });
	return json(listing, { headers: { 'cache-control': 'no-store' } });
};
