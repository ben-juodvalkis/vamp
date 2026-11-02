/**
 * The browser demo's stand-in for the interface server's `/api/*` routes.
 *
 * A static build has no server, so every route the page reaches is answered
 * here: the Places catalog from the demo's own library
 * (`scripts/shot/demo-catalog.mjs`), the Settings list and the network card
 * from the harness's fixtures (`scripts/shot/screenshot-page.mjs`). What needs the Mac's disk or
 * Live's index (sample peaks, reverb IRs, similar samples, grooves) answers
 * the way that route does on a Mac without the file: a 404 the UI already
 * draws as "not available".
 */

import placesList from '$shot/fixtures/places-list.json';
import { demoPlaceFiles } from '$shot/demo-catalog.mjs';

/** The demo's own library: a few presets per rail button (`demo-catalog.mjs`). */
const PLACE_FILES: Record<string, unknown> = demoPlaceFiles();

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** An empty Place file (`screenshot-page.mjs`'s `emptyPlaceBody`). */
function emptyPlace(name: string) {
	const generatedAt = '2026-08-30T00:00:00.000Z';
	if (name === 'index.json') {
		return {
			metadata: { generatedAt, sidebarRoot: '', source: 'folders', totalItems: 0 },
			places: [],
			aliases: { rules: [], exceptions: {} }
		};
	}
	const placeId = name.replace(/(-samples)?\.json$/, '');
	return {
		metadata: { placeId, name: placeId, path: '', role: null, generatedAt, totalItems: 0, kinds: {} },
		tree: { folders: {}, presets: [] }
	};
}

export function demoApiResponse(url: URL): Response {
	const path = url.pathname;

	if (path === '/api/places/list') {
		return json({
			firstRun: false,
			version: 1,
			m4lDevices: { path: '/Vamp Devices', place: 'Vamp Devices', exact: true },
			source: 'index',
			indexState: { ok: true, note: '', file: null },
			libraryCfg: null,
			sources: (placesList as { sources: unknown[] }).sources
		});
	}
	if (path === '/api/network') {
		return json({ hostname: 'vamp-demo.local', addresses: [] });
	}
	const place = /^\/api\/places\/([^/]+\.json)$/.exec(path);
	if (place) return json(PLACE_FILES[place[1]] ?? emptyPlace(place[1]));
	if (path === '/api/places/events') return new Response(null, { status: 204 });
	if (path === '/api/similar-samples') {
		return json({ ok: false, code: 'not-indexed', detail: 'not in the demo' }, 404);
	}
	return json({ ok: false, code: 'not-in-demo', detail: `${path} needs a Mac running Vamp` }, 404);
}
