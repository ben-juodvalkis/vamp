/**
 * `GET /api/places/preset-params?path=<abs .adv>` — a device preset's saved
 * values, `{ className, params }` (`$lib/server/places/presetParams`), so a
 * browser tile can draw the preset's curve (ADR-478). Only an `.adv` inside
 * a Place the browser has a catalog of: anything else is a 403 before the
 * file is opened, and the normalized path is the one opened.
 */
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { posix } from 'node:path';
import { placesService } from '$lib/server/places/service';
import { readPresetParams } from '$lib/server/places/presetParams';
import { isUnderRoot, normalizeSamplePath } from '$lib/server/sampleRoots';

export const GET: RequestHandler = async ({ url }) => {
	const path = normalizeSamplePath(url.searchParams.get('path'));
	if (!path || !['.adv', '.adg'].includes(posix.extname(path).toLowerCase())) error(400, 'path must be an absolute .adv or .adg');
	if (!placesService().catalogRoots().some((root) => isUnderRoot(path, root))) error(403, 'not in a cataloged Place');
	try {
		return json(await readPresetParams(path), { headers: { 'cache-control': 'private, max-age=60' } });
	} catch (err) {
		error(404, String(err));
	}
};
