/** `POST /api/places/rebuild` — forget every built catalog and build again (the script's `FORCE=1`). */
import { json, type RequestHandler } from '@sveltejs/kit';
import { placesService } from '$lib/server/places/service';

export const POST: RequestHandler = () => {
	const service = placesService();
	const t = Date.now();
	service.rebuild();
	return json({ ok: true, version: service.currentVersion, ms: Date.now() - t }, { headers: { 'cache-control': 'no-store' } });
};
