/**
 * `/api/places/index.json`, `/api/places/<id>.json`, `/api/places/<id>-samples.json`
 * — the browser's catalog, served from the Places service at runtime
 * (onboarding.plan.md §6.1). The three files keep the shape they had under
 * `interface/static/data/places/`, so `placesAdapter.ts` reads them unchanged.
 *
 * Cached the way the static files were (§9): `no-cache` with an ETag, so a
 * page reload revalidates with one small request and reuses the body it
 * holds — Inst's catalog is 2.7 MB on the rig — while a change on the Mac
 * (the ETag carries a fingerprint of the Place's content) is a fresh body at
 * once, and an index write that changed nothing in the Place is not.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { placesService } from '$lib/server/places/service';

const HEADERS = { 'cache-control': 'no-cache' };
/**
 * The index's ETag carries this server's start as well as the service's
 * version: the version counts from the same number on every start, so a
 * client holding an older server's index under the same version kept it
 * through a 304 (found 2026-10-25, when a new build added the effects Place).
 */
const BOOT = Date.now().toString(36);

function reply(body: unknown, etag: string, request: Request): Response {
	if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ...HEADERS, etag } });
	return json(body, { headers: { ...HEADERS, etag } });
}

export const GET: RequestHandler = ({ params, request }) => {
	const file = params.file ?? '';
	const service = placesService();
	if (file === 'index.json') return reply(service.indexJson(), `"index-${BOOT}-${service.currentVersion}"`, request);
	const tag = service.fileTag(file);
	if (tag === null) return json({ ok: false, code: 'not-found', detail: `no catalog file ${file}` }, { status: 404, headers: { 'cache-control': 'no-store' } });
	if (request.headers.get('if-none-match') === tag) return new Response(null, { status: 304, headers: { ...HEADERS, etag: tag } });
	return json(service.fileJson(file), { headers: { ...HEADERS, etag: tag } });
};
