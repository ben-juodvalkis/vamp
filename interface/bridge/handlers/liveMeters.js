/**
 * What a device's panel shows in Live that the LOM does not carry, read off
 * Live's window by Vamp for Mac (ADR-541): a needle meter's gain reduction
 * (the Glue), a spectrum (the Auto Filter). This handler is the relay
 * between the app and the page, the tuner's pattern (ADR-539):
 *
 * - `/meter/watch <devicePath> <className> <levels JSON>` from a client,
 *   `levels` Live's device view outermost first as `[index, [names]]` (the
 *   track's devices, then a pad's or chain's): the page repeats it every 2 s
 *   while it shows a metered device (`''` stops). It goes to Vamp for Mac
 *   alone, the socket the capture recorder knows from its hellos; the app
 *   stops 5 s after the last.
 * - The app's readings go to every client, one address per kind:
 *   `/meter/reduction <devicePath> <dB> <status>` and
 *   `/meter/spectrum <devicePath> <status> <dB × 64>` (the standard grid,
 *   20 Hz–20 kHz log-spaced). The app sends them when they move, their
 *   status changes, or half a second passes.
 *
 * Behind the `liveMeters` switch: off, all of it is dropped here. Available
 * once the app has sent a reading since this process started.
 */

const FEATURE_ID = 'liveMeters';
const WATCH_ADDRESS = '/meter/watch';
const REDUCTION_ADDRESS = '/meter/reduction';
const SPECTRUM_ADDRESS = '/meter/spectrum';
const STOP = ['', '', '[]'];

function argValue(arg) {
    return arg && typeof arg === 'object' && 'value' in arg ? arg.value : arg;
}

/** A reading's args as they go on, or null for a malformed one. */
function validReading(address, args) {
    if (address === REDUCTION_ADDRESS) {
        const [path, db, status] = args;
        return typeof path === 'string' && typeof db === 'number' && typeof status === 'string' ? [path, db, status] : null;
    }
    const [path, status, ...bands] = args;
    if (typeof path !== 'string' || typeof status !== 'string') return null;
    return bands.every((v) => typeof v === 'number') ? [path, status, ...bands] : null;
}

/**
 * @param {Object} deps
 * @param {Object} deps.features the feature registry (utils/features.js)
 * @param {() => ((address: string, args: Array) => void) | null} deps.appSend
 *   a send to Vamp for Mac's socket, or null while it is not connected
 * @param {(address: string, args: Array) => void} deps.broadcast to every client
 */
function createLiveMeters({ features, appSend, broadcast }) {
    let seen = false;

    return {
        /**
         * A message from any client. Returns true when it was this handler's.
         *
         * @param {{address: string, args?: Array}} msg
         */
        onClientMessage(msg) {
            const { address } = msg;
            if (address !== WATCH_ADDRESS && address !== REDUCTION_ADDRESS && address !== SPECTRUM_ADDRESS) return false;
            if (!features.isEnabled(FEATURE_ID)) return true;
            const args = (msg.args || []).map(argValue);
            if (address === WATCH_ADDRESS) {
                const path = typeof args[0] === 'string' ? args[0] : '';
                const className = typeof args[1] === 'string' ? args[1] : '';
                const levels = typeof args[2] === 'string' ? args[2] : '';
                const send = appSend();
                if (send) send(WATCH_ADDRESS, path && className && levels.startsWith('[') ? [path, className, levels] : STOP);
                return true;
            }
            const reading = validReading(address, args);
            if (!reading) return true;
            if (!seen) {
                seen = true;
                features.setAvailability(FEATURE_ID, true);
            }
            broadcast(address, reading);
            return true;
        }
    };
}

module.exports = { createLiveMeters, FEATURE_ID, WATCH_ADDRESS, REDUCTION_ADDRESS, SPECTRUM_ADDRESS };
