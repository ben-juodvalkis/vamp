/**
 * Pairing relay (ADR-491, docs/plans/general-release/security.plan.md).
 *
 * Pairing itself lives in the interface server, which owns HTTP, cookies and
 * `/api/ws-auth`. What it cannot reach are the two places a request has to
 * be seen: the trusted screens (this bridge's authenticated WebSocket
 * clients) and Live's status bar (the surface). So it POSTs each change
 * here, and this passes it on:
 *
 * - `{type: 'request', id, name, address, code}` → `/bridge/pairing` to the
 *   trusted screens (without the code: Allow is their way in, the code is
 *   for the person at the device) and the status bar line
 *   "Vamp: <name> (<address>) wants to connect. Code <code>" to the surface.
 * - `{type: 'resolved', id, outcome}` → `/bridge/pairing` again, so every
 *   banner for it closes, and an empty status bar message.
 *
 * The bridge's HTTP port is on every interface, so a request is taken only
 * from loopback AND with the WebSocket secret as a bearer token: the
 * interface server is on this Mac and reads the same secret file.
 */

const crypto = require('crypto');

const PAIRING_ADDRESS = '/bridge/pairing';
const SHOW_MESSAGE_ADDRESS = '/looping/v3/session/show_message';
const PAIRING_PATH = '/pairing';
const MAX_BODY_BYTES = 4096;

function isLoopback(address) {
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function tokenMatches(header, secret) {
    if (typeof header !== 'string' || !secret) return false;
    const expected = Buffer.from(`Bearer ${secret}`);
    const given = Buffer.from(header);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** One line of text, short enough for Live's status bar. */
function clean(value, max) {
    return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

/**
 * @param {Object} opts
 * @param {string|null} opts.secret - the WebSocket secret (utils/wsSecret.js)
 * @param {(address: string, args: unknown[]) => void} opts.broadcast - to authenticated clients
 * @param {(text: string) => void} opts.showInLive - Live's status bar, through the surface
 * @param {{ info: Function, warn: Function }} opts.logger
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => void}
 */
function createPairingRelay({ secret, broadcast, showInLive, logger }) {
    function reply(res, status, body = '') {
        res.writeHead(status, { 'Content-Type': 'text/plain' });
        res.end(body);
    }

    function relay(event) {
        const id = clean(event.id, 64);
        if (!id) return false;
        if (event.type === 'request') {
            const name = clean(event.name, 40) || 'A device';
            const address = clean(event.address, 64);
            const code = clean(event.code, 12);
            broadcast(PAIRING_ADDRESS, [JSON.stringify({ type: 'request', id, name, address })]);
            showInLive(`Vamp: ${name}${address ? ` (${address})` : ''} wants to connect. Code ${code}`);
            logger.info('Pairing request relayed', { id, name, address });
            return true;
        }
        if (event.type === 'resolved') {
            const outcome = clean(event.outcome, 16);
            broadcast(PAIRING_ADDRESS, [JSON.stringify({ type: 'resolved', id, outcome })]);
            showInLive('');
            return true;
        }
        return false;
    }

    return function handle(req, res) {
        if (req.method !== 'POST') return reply(res, 405);
        if (!isLoopback(req.socket.remoteAddress)) return reply(res, 403);
        if (!tokenMatches(req.headers.authorization, secret)) return reply(res, 401);

        let body = '';
        let tooBig = false;
        req.on('data', (chunk) => {
            body += chunk;
            if (body.length > MAX_BODY_BYTES) {
                tooBig = true;
                req.destroy();
            }
        });
        req.on('end', () => {
            if (tooBig) return;
            let event;
            try {
                event = JSON.parse(body);
            } catch {
                return reply(res, 400, 'not json');
            }
            try {
                return relay(event) ? reply(res, 204) : reply(res, 400, 'unknown event');
            } catch (e) {
                logger.warn('Pairing relay failed', { error: e.message });
                return reply(res, 500);
            }
        });
    };
}

module.exports = {
    createPairingRelay,
    PAIRING_ADDRESS,
    PAIRING_PATH,
    SHOW_MESSAGE_ADDRESS
};
