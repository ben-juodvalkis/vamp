/**
 * The bridge's auth handshake, for the scripts that open its WebSocket
 * outside a browser (the perf scenarios, the shot capture).
 *
 * The bridge sends `/bridge/auth/challenge [salt]` as the first frame of
 * every connection while auth is on and refuses every other message from
 * the client until it answers `/bridge/auth [HMAC-SHA256(secret, salt)]`
 * (transport/WebSocketServer.js). A browser gets that proof from
 * `/api/ws-auth`; a script on the Mac reads the secret itself, the same way
 * the bridge does (`interface/bridge/utils/wsSecret.js`), and signs locally.
 * A bridge with auth off sends no challenge, so its first other frame means
 * the client may talk.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { computeProof, secretPath, SECRET_ENV_VAR } = require('../../interface/bridge/utils/wsSecret.js');

const AUTH_CHALLENGE = '/bridge/auth/challenge';
const AUTH = '/bridge/auth';
const AUTH_RESULT = '/bridge/auth/result';

/**
 * The secret the bridge uses, or null. Read only: unlike the bridge, a
 * client never generates one, which no running bridge would hold.
 */
export function bridgeSecret() {
	const fromEnv = process.env[SECRET_ENV_VAR];
	if (fromEnv && fromEnv.trim()) return fromEnv.trim();
	try {
		return readFileSync(secretPath(), 'utf8').trim() || null;
	} catch {
		return null;
	}
}

/**
 * Answer the challenge on an open socket (`ws`'s WebSocket or Node's global
 * one: both have addEventListener). Resolves once the client may send, with
 * `'auth-off'` or `'authenticated'`; rejects on a refused proof, a missing
 * secret, or no verdict within `timeoutMs`.
 */
export function authenticate(ws, { timeoutMs = 5000 } = {}) {
	return new Promise((resolve, reject) => {
		let challenged = false;
		const done = (fn, value) => {
			clearTimeout(timer);
			ws.removeEventListener('message', onMessage);
			fn(value);
		};
		const timer = setTimeout(
			() => done(reject, new Error('bridge auth: no verdict in time')),
			timeoutMs
		);
		function onMessage(event) {
			let msg;
			try {
				msg = JSON.parse(String(event.data));
			} catch {
				return;
			}
			if (msg?.address === AUTH_CHALLENGE) {
				challenged = true;
				const salt = Array.isArray(msg.args) ? msg.args[0] : null;
				const secret = bridgeSecret();
				if (!secret) {
					done(reject, new Error(`bridge auth: no secret (set ${SECRET_ENV_VAR} or create ${secretPath()})`));
					return;
				}
				ws.send(JSON.stringify({ address: AUTH, args: [computeProof(secret, String(salt))] }));
				return;
			}
			if (msg?.address === AUTH_RESULT) {
				if (Array.isArray(msg.args) && msg.args[0] === 1) done(resolve, 'authenticated');
				else done(reject, new Error(`bridge auth refused: ${msg.args?.[1] ?? 'unknown'}`));
				return;
			}
			// The challenge is the first frame when auth is on.
			if (!challenged) done(resolve, 'auth-off');
		}
		ws.addEventListener('message', onMessage);
	});
}
