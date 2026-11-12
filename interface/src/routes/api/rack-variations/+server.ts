/**
 * `GET /api/rack-variations?name=<rack name>&count=<n>` — the names of a
 * rack's macro variations, read from its preset file (ADR-531):
 * `{ names: string[] | null }`, null when no file named after the rack
 * holds exactly `count` variations. See `$lib/server/rackVariations`.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { rackVariationNames } from '$lib/server/rackVariations';

export const GET: RequestHandler = ({ url }) => {
	const name = url.searchParams.get('name') ?? '';
	const count = Number(url.searchParams.get('count'));
	const { names } = rackVariationNames(name, count);
	return json({ names }, { headers: { 'cache-control': 'no-store' } });
};
