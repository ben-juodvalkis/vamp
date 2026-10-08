/**
 * Ben's Adaptive Tone Shaper's graph, relayed to the iPad (2026-10-07).
 *
 * The device (`Vamp Devices/ToneShaper`) draws its own face from two things
 * Live's API never carries: the spectrum it hears and the curve it is
 * applying, 59 sixth-octave bands each. Every instance in the set sends them
 * thirty times a second as `/toneshaper/frame <devicePath> <59 levels>
 * <59 gains>` over its own UDP port (`osc.toneShaper`), the way the capture
 * recorder has a port of its own. Nothing goes the other way: there is one
 * port and many instances, so the bridge, not the device, decides who hears
 * what.
 *
 * A client says which device it is looking at — `/toneshaper/watch
 * <devicePath>` (bridge-terminated; `''` to stop) — and the frames of the
 * watched paths go on to every client while the rest are dropped here, so
 * nine idle instances cost the iPad nothing. The device names its path the
 * way the v3 wire does (`tracks/0/devices/1`), read from Live once a second.
 */

const FRAME_ADDRESS = '/toneshaper/frame';
const WATCH_ADDRESS = '/toneshaper/watch';

function createToneShaper() {
    /** clientId → the device path that client is looking at. */
    const watched = new Map();

    function isWatched(devicePath) {
        for (const p of watched.values()) if (p === devicePath) return true;
        return false;
    }

    return {
        /** A client's `/toneshaper/watch`: its one device, or none. */
        watch(clientId, devicePath) {
            if (typeof devicePath === 'string' && devicePath !== '') watched.set(clientId, devicePath);
            else watched.delete(clientId);
        },

        /** The client is gone; so is its watch. */
        forget(clientId) {
            watched.delete(clientId);
        },

        isWatched,

        /**
         * Every packet from a device. Returns true when the bridge has
         * consumed it: a frame nobody is looking at stops here.
         *
         * @param {{address: string, args: Array}} msg
         */
        onDeviceMessage(msg) {
            if (msg.address !== FRAME_ADDRESS) return false;
            const path = msg.args && msg.args[0];
            return !isWatched(typeof path === 'string' ? path : path && path.value);
        },

        /** Exposed for tests. */
        watchedPaths() {
            return Array.from(new Set(watched.values()));
        }
    };
}

module.exports = {
    createToneShaper,
    FRAME_ADDRESS,
    WATCH_ADDRESS
};
