/**
 * `POST /api/places/exists {"paths": ["<abs preset path>", …]}` — which of
 * these preset files are on this Mac, `{ exists: { [path]: boolean } }`, so
 * the chain's recents never offer a file that is gone (ADR-498). Preset
 * files only (.adv, .adg, .amxd, .aupreset, .fxp), at most 64 a call: it
 * answers whether a file is there and nothing about what is in it.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { existsSync } from 'node:fs';
import { posix } from 'node:path';
import { normalizeSamplePath } from '$lib/server/sampleRoots';

const PRESET_EXTENSIONS = new Set(['.adv', '.adg', '.amxd', '.aupreset', '.fxp']);
const MAX_PATHS = 64;

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, code: 'bad-request', detail: 'body must be JSON' }, { status: 400 });
	}
	const paths = (body as { paths?: unknown })?.paths;
	if (!Array.isArray(paths) || paths.length > MAX_PATHS || !paths.every((p) => typeof p === 'string')) {
		return json({ ok: false, code: 'bad-request', detail: `paths must be a list of at most ${MAX_PATHS} paths` }, { status: 400 });
	}
	const exists: Record<string, boolean> = {};
	for (const raw of paths as string[]) {
		const path = normalizeSamplePath(raw);
		if (!path || !PRESET_EXTENSIONS.has(posix.extname(path).toLowerCase())) continue;
		exists[raw] = existsSync(path);
	}
	return json({ exists }, { headers: { 'cache-control': 'no-store' } });
};
