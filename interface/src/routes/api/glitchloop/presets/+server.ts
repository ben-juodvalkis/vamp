/**
 * `GET /api/glitchloop/presets` — GlitchLoop's preset bank, read from the
 * owner's glitchloop checkout (`paths.glitchLoopRoot`, this Mac's local
 * config): `max/glitchloop_presets.json`, which glitchloop's params.py
 * generates and checks, so it is never copied here and never drifts.
 *
 *   { bank: [name, …], presets: { name: { parameterName: value } },
 *     untouched: [parameterName, …] }
 *
 * Values are in Live's API units, keyed by the parameter names Live
 * reports. 404 `not-configured` without the path, `not-found` without the
 * file: the Glitch view then shows no presets.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configPath } from '$lib/server/runtimeConfig';

const NO_STORE = { 'cache-control': 'no-store' };

export const GET: RequestHandler = () => {
	const root = configPath('glitchLoopRoot');
	if (!root) return json({ ok: false, code: 'not-configured' }, { status: 404, headers: NO_STORE });
	let text: string;
	try {
		text = readFileSync(join(root, 'max', 'glitchloop_presets.json'), 'utf8');
	} catch {
		return json({ ok: false, code: 'not-found' }, { status: 404, headers: NO_STORE });
	}
	try {
		return json(JSON.parse(text), { headers: NO_STORE });
	} catch {
		return json({ ok: false, code: 'bad-file' }, { status: 500, headers: NO_STORE });
	}
};
