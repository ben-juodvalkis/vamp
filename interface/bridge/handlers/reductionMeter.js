/**
 * The gain reduction a device's meter shows in Live (ADR-541).
 *
 * Live puts no gain reduction on the LOM. Vamp for Mac reads the needle Live
 * draws: it finds the device in Live's device view through Accessibility and
 * captures just the meter's panel of Live's window. This handler is the
 * relay between it and the page, the tuner's pattern (ADR-539):
 *
 * - `/meter/reduction/watch <devicePath> <className> <levels JSON>` from a
 *   client, `levels` Live's device view outermost first as `[index, [names]]`
 *   (the track's devices, then a pad's or chain's): the page repeats it every
 *   2 s while it shows a device with a meter (`''` stops). It goes to Vamp for
 *   Mac alone, the socket the
 *   capture recorder knows from its hellos; the app stops 5 s after the last.
 * - `/meter/reduction <devicePath> <dB> <status>` from the app goes to every
 *   client. The app sends it when the reading moves by 0.05 dB, its status
 *   changes, or half a second passes.
 *
 * Behind the `reductionMeter` switch: off, both are dropped here. Available
 * once the app has sent a reading since this process started.
 */

const FEATURE_ID = 'reductionMeter';
const WATCH_ADDRESS = '/meter/reduction/watch';
const READING_ADDRESS = '/meter/reduction';

function argValue(arg) {
    return arg && typeof arg === 'object' && 'value' in arg ? arg.value : arg;
}

/**
 * @param {Object} deps
 * @param {Object} deps.features the feature registry (utils/features.js)
 * @param {() => ((address: string, args: Array) => void) | null} deps.appSend
 *   a send to Vamp for Mac's socket, or null while it is not connected
 * @param {(address: string, args: Array) => void} deps.broadcast to every client
 */
function createReductionMeter({ features, appSend, broadcast }) {
    let seen = false;

    return {
        /**
         * A message from any client. Returns true when it was this handler's.
         *
         * @param {{address: string, args?: Array}} msg
         */
        onClientMessage(msg) {
            if (msg.address !== WATCH_ADDRESS && msg.address !== READING_ADDRESS) return false;
            if (!features.isEnabled(FEATURE_ID)) return true;
            const args = (msg.args || []).map(argValue);
            if (msg.address === WATCH_ADDRESS) {
                const path = typeof args[0] === 'string' ? args[0] : '';
                const className = typeof args[1] === 'string' ? args[1] : '';
                const levels = typeof args[2] === 'string' ? args[2] : '';
                const send = appSend();
                if (send) send(WATCH_ADDRESS, path && className && levels.startsWith('[') ? [path, className, levels] : ['', '', '[]']);
                return true;
            }
            const [path, db, status] = args;
            if (typeof path !== 'string' || typeof db !== 'number' || typeof status !== 'string') return true;
            if (!seen) {
                seen = true;
                features.setAvailability(FEATURE_ID, true);
            }
            broadcast(READING_ADDRESS, [path, db, status]);
            return true;
        }
    };
}

module.exports = { createReductionMeter, FEATURE_ID, WATCH_ADDRESS, READING_ADDRESS };
