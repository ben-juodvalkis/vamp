/**
 * `PUT /api/places/ticks {"ticked": [key, …]}` — save which Places are
 * cataloged. The Mac keeps them in `logs/places.json`; the first save ends
 * the first run (onboarding.plan.md §2). Answers the new listing.
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
	const ticked = (body as { ticked?: unknown })?.ticked;
	if (!Array.isArray(ticked) || !ticked.every((k) => typeof k === 'string')) {
		return json({ ok: false, code: 'bad-request', detail: 'ticked must be a list of source keys' }, { status: 400 });
	}
	return json(placesService().setTicks(ticked), { headers: { 'cache-control': 'no-store' } });
};
