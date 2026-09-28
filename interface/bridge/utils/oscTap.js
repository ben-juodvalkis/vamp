/**
 * OSC Tap — fixture capture for the M4L → Python migration.
 *
 * Records every OSC message the bridge forwards, in either direction,
 * as NDJSON lines for later slicing into per-flow fixtures under
 * `surface/tests/fixtures/flows/`.
 *
 * Off by default. Enabled by setting the OSC_TAP_FILE environment
 * variable to an output path before starting the bridge:
 *
 *     OSC_TAP_FILE=/tmp/session.ndjson npm run dev
 *
 * When OSC_TAP_FILE is unset, both exports are no-ops with zero
 * runtime cost.
 *
 * Record shape (one JSON object per line):
 *   { ts: <ms>, dir: "in"|"out", target: <string>, address: <string>, args: <array> }
 *
 * `dir` is the direction the bridge sees:
 *   - "out" = UI → DAW (WebSocket inbound, forwarded to a UDP backend).
 *   - "in"  = DAW → UI (UDP inbound from a backend, broadcast to clients).
 *
 * `target` is the backend name (`pythonSurface`, `loopingRecorder`,
 * `totalmix`).
 * It is the `routingTarget` on outbound and the `source` on inbound.
 *
 * See Looping's documentation/archive/m4l-to-python/05-migration-plan.md §0.1.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

// Resolve OSC_TAP_FILE against the repo root, not the bridge's cwd.
// `npm run dev` launches the bridge with `cd interface/bridge && …`,
// so a relative path in the env var would otherwise resolve inside
// `interface/bridge/`. __dirname is `.../interface/bridge/utils`, so
// three parents up is the repo root.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const rawTapPath = process.env.OSC_TAP_FILE;
const tapPath = rawTapPath
    ? (path.isAbsolute(rawTapPath) ? rawTapPath : path.resolve(REPO_ROOT, rawTapPath))
    : null;
let stream = null;

if (tapPath) {
    try {
        fs.mkdirSync(path.dirname(tapPath), { recursive: true });
        stream = fs.createWriteStream(tapPath, { flags: 'a' });
        stream.on('error', (err) => {
            logger.error('OSC tap stream error — disabling tap', { path: tapPath, error: err.message });
            stream = null;
        });
        logger.info('OSC tap enabled', { path: tapPath });
    } catch (err) {
        logger.error('Failed to open OSC tap file — tap disabled', { path: tapPath, error: err.message });
        stream = null;
    }
}

function write(record) {
    if (!stream) return;
    try {
        stream.write(JSON.stringify(record) + '\n');
    } catch (err) {
        // Don't let tap failures break bridge traffic. Log once and move on.
        logger.error('OSC tap write failed', { error: err.message });
    }
}

/**
 * Record a UI → DAW message (from WebSocket, about to send via UDP).
 * Called from WebSocketServer.routeMessageToUDP.
 *
 * @param {string} target - Routing target (e.g., 'pythonSurface', 'totalmix')
 * @param {{address: string, args: any[]}} message - The OSC message
 */
function recordOutbound(target, message) {
    if (!stream || !message) return;
    write({
        ts: Date.now(),
        dir: 'out',
        target,
        address: message.address,
        args: message.args || []
    });
}

/**
 * Record a DAW → UI message (from a UDP backend, about to broadcast to clients).
 * Called from enhanced-osc-bridge.handleIncomingOSC.
 *
 * @param {string} source - Backend that produced the message
 * @param {{address: string, args: any[]}} oscMessage - The OSC message
 */
function recordInbound(source, oscMessage) {
    if (!stream || !oscMessage) return;
    write({
        ts: Date.now(),
        dir: 'in',
        target: source,
        address: oscMessage.address,
        args: oscMessage.args || []
    });
}

/** True if the tap is actively writing. Exposed for smoke tests. */
function isEnabled() {
    return stream !== null;
}

module.exports = {
    recordOutbound,
    recordInbound,
    isEnabled
};
