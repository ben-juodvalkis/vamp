/**
 * Shared secret for the WebSocket auth handshake.
 *
 * What this defends against, honestly
 * -----------------------------------
 *
 * The bridge binds `0.0.0.0:8081` with no gate, so anything on the LAN
 * that knows the port can drive Live. The HMAC challenge below closes
 * that: a client must prove it holds the secret before its messages
 * are routed, and the secret itself never crosses the wire.
 *
 * It raises the bar from **"anything that can reach port 8081"** to
 * **"anything that can load the app"**. It is not a defence against a
 * determined attacker already on the LAN, because the UI is a browser
 * page and the page has to answer somehow — it has the interface server
 * sign the salt (`/api/ws-auth`), and that server is also on the LAN.
 * Closing that last gap is device pairing, decided 2026-09-30 and not
 * built yet (docs/plans/general-release/security.plan.md).
 *
 * What it does buy, concretely: stray clients, stale tabs from another
 * machine, port scanners, and anything on the network that is not the
 * app can no longer send commands to Live.
 *
 * Where the secret lives
 * ----------------------
 *
 * Never in `constants.json` — that file is committed. Resolution order:
 *
 *   1. `LOOPING_WS_SECRET` env var, if set and non-empty.
 *   2. `config/.ws-secret`, gitignored.
 *   3. Generated here and written to (2).
 *
 * Auto-generation is what removes the "misconfigured" state entirely:
 * there is no first-run setup step and no way to end up with auth
 * enabled and no secret. A performer's rig should never fail to start
 * because of a missing env var.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { logger } = require('./logger');

/** Env override, checked first. */
const SECRET_ENV_VAR = 'LOOPING_WS_SECRET';

/** Gitignored file, relative to the repo root. */
const SECRET_FILENAME = path.join('config', '.ws-secret');

/** 256 bits, hex-encoded. */
const SECRET_BYTES = 32;

function repoRoot() {
    // utils/ -> bridge/ -> interface/ -> repo root
    return path.resolve(__dirname, '..', '..', '..');
}

function secretPath() {
    return path.join(repoRoot(), SECRET_FILENAME);
}

/**
 * Resolve the shared secret, generating and persisting one if needed.
 *
 * Returns `{ secret, source }`, or `{ secret: null, source: 'unavailable' }`
 * if no secret could be established — which callers must treat as
 * "cannot authenticate", not as "allow everything".
 */
function resolveWsSecret() {
    const fromEnv = process.env[SECRET_ENV_VAR];
    if (fromEnv && fromEnv.trim()) {
        return { secret: fromEnv.trim(), source: 'env' };
    }

    const file = secretPath();
    try {
        const existing = fs.readFileSync(file, 'utf8').trim();
        if (existing) return { secret: existing, source: 'file' };
    } catch (e) {
        if (e.code !== 'ENOENT') {
            logger.warn('Could not read WS secret file', { file, error: e.message });
        }
    }

    const generated = crypto.randomBytes(SECRET_BYTES).toString('hex');
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        // 0600: the whole point is that only this user can read it.
        fs.writeFileSync(file, generated + '\n', { mode: 0o600 });
        logger.info('Generated a new WebSocket secret', { file });
        return { secret: generated, source: 'generated' };
    } catch (e) {
        // The interface server reads the same file to hand the secret
        // to the page, so an in-memory-only secret cannot be shared
        // between the two processes — there is no way to authenticate.
        logger.error(
            'Could not write the WS secret file; WebSocket auth cannot be established',
            { file, error: e.message }
        );
        return { secret: null, source: 'unavailable' };
    }
}

/**
 * Constant-time comparison of a client's proof against the expected one.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself be
 * a length oracle if it escaped — so the lengths are checked first and
 * both paths return the same `false`.
 */
function proofMatches(expectedHex, receivedHex) {
    if (typeof receivedHex !== 'string' || typeof expectedHex !== 'string') return false;
    if (receivedHex.length !== expectedHex.length) return false;
    try {
        return crypto.timingSafeEqual(
            Buffer.from(expectedHex, 'hex'),
            Buffer.from(receivedHex, 'hex')
        );
    } catch {
        return false;
    }
}

/** HMAC-SHA256 of `salt` under `secret`, hex-encoded. Both sides use this. */
function computeProof(secret, salt) {
    return crypto.createHmac('sha256', secret).update(salt).digest('hex');
}

/** A fresh per-connection salt. Never reused. */
function makeSalt(bytes = 16) {
    return crypto.randomBytes(bytes).toString('hex');
}

module.exports = {
    resolveWsSecret,
    computeProof,
    proofMatches,
    makeSalt,
    secretPath,
    SECRET_ENV_VAR,
    SECRET_FILENAME
};
