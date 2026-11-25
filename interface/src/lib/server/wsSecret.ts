/**
 * The bridge's WebSocket secret, read where the bridge writes it
 * (`interface/bridge/utils/wsSecret.js`): `LOOPING_WS_SECRET`, else
 * `.ws-secret` in the data folder's `config/` (`dataDir('config')`, the
 * same folder `dataPaths.js` gives the bridge: `VAMP_DATA/config` when
 * installed, the checkout's `config/` otherwise). `/api/ws-auth` signs the
 * bridge's challenge with it, and pairing (ADR-491) presents it to the
 * bridge's relay as a bearer token.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '$lib/server/runtimeConfig';

const SECRET_ENV_VAR = 'LOOPING_WS_SECRET';
const SECRET_FILENAME = '.ws-secret';

/** Resolve the secret, or null when it cannot be found. */
export function resolveSecret(): string | null {
	const fromEnv = process.env[SECRET_ENV_VAR];
	if (fromEnv && fromEnv.trim()) return fromEnv.trim();

	let file: string;
	try {
		file = join(dataDir('config'), SECRET_FILENAME);
	} catch {
		// No checkout above cwd and no VAMP_DATA: nowhere to read it from.
		return null;
	}
	if (!existsSync(file)) return null;

	const secret = readFileSync(file, 'utf8').trim();
	return secret || null;
}
