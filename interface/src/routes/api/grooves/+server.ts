/**
 * `GET /api/grooves` — Live's groove files with their grid and timing picture,
 * and which are ticked for the Groove view, in tick order.
 * `PUT /api/grooves {"ticked": [name, …]}` — save the ticks in that order;
 * answers the new listing. See `$lib/server/grooves`.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { join } from 'node:path';
import { groovesListing, writeGrooveTicks } from '$lib/server/grooves';
import { repoRoot } from '$lib/server/runtimeConfig';

const NO_STORE = { 'cache-control': 'no-store' };

export const GET: RequestHandler = () => json(groovesListing(), { headers: NO_STORE });

export const PUT: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, code: 'bad-request', detail: 'body must be JSON' }, { status: 400 });
	}
	const ticked = (body as { ticked?: unknown })?.ticked;
	if (!Array.isArray(ticked) || !ticked.every((k) => typeof k === 'string')) {
		return json({ ok: false, code: 'bad-request', detail: 'ticked must be a list of groove names' }, { status: 400 });
	}
	writeGrooveTicks(join(repoRoot(), 'logs', 'grooves.json'), ticked);
	return json(groovesListing(), { headers: NO_STORE });
};
