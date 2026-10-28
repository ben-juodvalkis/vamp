/**
 * The bridge's WebSocket secret, read where the bridge writes it
 * (`interface/bridge/utils/wsSecret.js`): `LOOPING_WS_SECRET`, else
 * `config/.ws-secret`. `/api/ws-auth` signs the bridge's challenge with it,
 * and pairing (ADR-491) presents it to the bridge's relay as a bearer token.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET_ENV_VAR = 'LOOPING_WS_SECRET';
const SECRET_FILENAME = join('config', '.ws-secret');

/**
 * Walk up for the repo root.
 *
 * `import.meta.url` resolves differently under `vite dev` and a built
 * server, so this walks rather than assuming a fixed depth — the same
 * hazard `config_loader.py` documents on the Python side.
 *
 * The walk is unbounded (it stops at the filesystem root) and starts
 * from both the module's own directory and the process working
 * directory. A bounded walk is what broke this before: the built
 * endpoint lands eight directories deep in
 * `.svelte-kit/output/server/entries/endpoints/api/ws-auth/`, one level
 * further from the repo root than an eight-step climb could reach, so
 * `npm run ipad` served a 503 while `npm run dev` — five levels deep in
 * `src/routes/` — was fine. Any fixed budget is a fresh version of that
 * bug the next time the output layout moves.
 */
function findSecretFile(): string | null {
	const starts = [dirname(fileURLToPath(import.meta.url)), process.cwd()];
	for (const start of starts) {
		let current = start;
		for (;;) {
			const candidate = join(current, SECRET_FILENAME);
			if (existsSync(candidate)) return candidate;
			const parent = resolve(current, '..');
			if (parent === current) break;
			current = parent;
		}
	}
	return null;
}

/** Resolve the secret, or null when it cannot be found. */
export function resolveSecret(): string | null {
	const fromEnv = process.env[SECRET_ENV_VAR];
	if (fromEnv && fromEnv.trim()) return fromEnv.trim();

	const file = findSecretFile();
	if (!file) return null;

	const secret = readFileSync(file, 'utf8').trim();
	return secret || null;
}
