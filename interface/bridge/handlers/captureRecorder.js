/**
 * The capture recorder behind REC: Vamp-Capture.amxd, loaded onto the track
 * it records (capture.plan.md, issue #9).
 *
 * Every edition has it: it is our own device and needs only Max for Live,
 * so it is not a feature switch, and REC needs no setup. The bridge owns
 * three facts about it:
 *
 * **Which tracks have one?** Every copy says `/capture/hello <track>` once a
 * second, `<track>` being Live's index of the track it sits on. A track has a
 * recorder while its hellos arrive. The old Vamp-Recorder on Return A says
 * hello with no track; it is ignored, and nothing is sent to its port.
 *
 * **Load, then record.** `/capture/start <track> [source] [channel]` from a
 * client: a track with a recorder starts at once. One without gets one: the
 * surface loads Vamp-Capture at the end of its chain (`device/load`, the
 * Vamp Devices Place), and the start goes out when that copy's first hello
 * arrives, or fails after `loadTimeoutMs` with `/capture/error
 * recorder-not-loaded`. A stop before then cancels the start. The recorder
 * stays on the track afterwards: removing it would add an undo step.
 *
 * **Where does an unsaved set record?** Live gives every unsaved set a real
 * project folder as it opens: `<YYYY-MM-DD HHMMSS> Temp Project` under its
 * temporary folder, holding `Ableton Project Info` (measured 2026-09-27: Live
 * started 12:09:14, its temp project appeared 12:09:22). The LOM does not name
 * it, and the device's Max JS cannot read this config, so the bridge finds
 * the newest one and sends it as `/capture/folder <path>` just before every
 * start. The device uses it only while the set is unsaved; a saved set
 * records beside its `.als`. The temporary folder is a Live preference,
 * `paths.liveRecordingsDir` here (Live's default); Preferences.cfg holds it
 * with no key to read it by.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const FEATURE_ID = 'captureRecorder';
const HELLO_ADDRESS = '/capture/hello';
const BYE_ADDRESS = '/capture/bye';
const FOLDER_ADDRESS = '/capture/folder';
const START_ADDRESS = '/capture/start';
const STOP_ADDRESS = '/capture/stop';
const ERROR_ADDRESS = '/capture/error';
const STATE_ADDRESS = '/capture/state';

const DEVICE_LOAD_ADDRESS = '/looping/v3/device/load';
const DEVICE_SOURCE = 'place:Vamp Devices';
const DEVICE_REL = 'Vamp-Capture/Vamp-Capture.amxd';

/** Three missed hellos at the device's 1 s beat. */
const SILENCE_MS = 3000;
/** A Max device's first load in a set takes longest. */
const LOAD_TIMEOUT_MS = 8000;

const TEMP_PROJECT_SUFFIX = ' Temp Project';
const LIVE_PROJECT_MARKER = 'Ableton Project Info';

function expandHome(p) {
    return typeof p === 'string' && p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

const str = (value) => ({ type: 's', value: String(value) });

/**
 * The newest temp project in Live's temporary folder, or '' when there is
 * none. Live names each by the moment it made it, so the names sort in
 * creation order; a folder's mtime would not, since a capture written into
 * an older one moves it.
 *
 * @param {string} dir Live's temporary folder
 * @param {{readdirSync: Function, existsSync: Function}} [fsImpl]
 */
function newestTempProject(dir, fsImpl = fs) {
    let names;
    try {
        names = fsImpl.readdirSync(dir);
    } catch {
        return '';
    }
    const candidates = names.filter((n) => n.endsWith(TEMP_PROJECT_SUFFIX)).sort().reverse();
    for (const name of candidates) {
        const folder = path.join(dir, name);
        if (fsImpl.existsSync(path.join(folder, LIVE_PROJECT_MARKER))) return folder;
    }
    return '';
}

/** An OSC arg's value, whether it came wrapped ({type, value}) or bare. */
function argValue(arg) {
    return arg && typeof arg === 'object' && 'value' in arg ? arg.value : arg;
}

/**
 * @param {Object} deps
 * @param {Object} deps.features the feature registry (utils/features.js)
 * @param {(msg: {address: string, args: Array}) => void} deps.sendToDevice every copy's port
 * @param {(address: string, args: Array<string|number>) => void} deps.sendToSurface
 * @param {(address: string, args: Array) => void} deps.broadcast to every client
 * @param {string} [deps.recordingsDir] Live's temporary folder; `~/` expands
 * @param {Object} [deps.logger]
 * @param {Object} [deps.fsImpl]
 * @param {number} [deps.silenceMs]
 * @param {number} [deps.loadTimeoutMs]
 */
function createCaptureRecorder({
    features, sendToDevice, sendToSurface, broadcast, recordingsDir, logger,
    fsImpl = fs, silenceMs = SILENCE_MS, loadTimeoutMs = LOAD_TIMEOUT_MS
}) {
    const tempRoot = expandHome(recordingsDir || '~/Music/Ableton/Live Recordings');
    /** track index → when its recorder last said hello */
    const lastHello = new Map();
    /** A start waiting for the recorder it loaded: {track, args, timer}. */
    let waiting = null;

    // REC can always load a recorder, so it is never greyed out for want of one.
    features.setAvailability(FEATURE_ID, true);

    function hasRecorder(track) {
        const at = lastHello.get(track);
        return at !== undefined && Date.now() - at < silenceMs;
    }

    function sendProjectFolder() {
        const folder = newestTempProject(tempRoot, fsImpl);
        if (!folder) logger?.warn?.('No Live temp project found for an unsaved set\'s capture', { tempRoot });
        sendToDevice({ address: FOLDER_ADDRESS, args: [str(folder)] });
        return folder;
    }

    function sendStart(track, rest) {
        sendProjectFolder();
        sendToDevice({
            address: START_ADDRESS,
            args: [{ type: 'i', value: track }, ...rest.map(str)]
        });
    }

    function cancelWaiting() {
        if (!waiting) return;
        clearTimeout(waiting.timer);
        waiting = null;
    }

    function refuse(code, detail) {
        broadcast(ERROR_ADDRESS, [code, detail]);
        broadcast(STATE_ADDRESS, ['idle']);
    }

    return {
        /**
         * Every packet from a device. Returns true when the bridge has
         * consumed it: hellos and byes are for the bridge alone, and would
         * otherwise flood every client.
         *
         * @param {{address: string, args?: Array}} msg
         */
        onDeviceMessage(msg) {
            if (msg.address === HELLO_ADDRESS) {
                const track = Number(argValue(msg.args?.[0]));
                if (Number.isInteger(track) && track >= 0) {
                    lastHello.set(track, Date.now());
                    if (waiting && waiting.track === track) {
                        const { args } = waiting;
                        cancelWaiting();
                        sendStart(track, args);
                    }
                }
                return true;
            }
            // A bye does not say which track; its hellos stop, which does.
            return msg.address === BYE_ADDRESS;
        },

        /**
         * A client's `/capture/start <track> [source] [channel]`.
         *
         * @param {Array} args
         */
        start(args = []) {
            const track = Number(argValue(args[0]));
            const rest = args.slice(1, 3).map(argValue).filter((v) => typeof v === 'string' && v);
            if (!Number.isInteger(track) || track < 0) {
                refuse('no-track', 'REC records the selected track, and none is selected');
                return;
            }
            cancelWaiting();
            if (hasRecorder(track)) {
                sendStart(track, rest);
                return;
            }
            logger?.info?.('Loading Vamp-Capture for a capture', { track });
            sendToSurface(DEVICE_LOAD_ADDRESS, [`tracks/${track}`, '', '', DEVICE_SOURCE, DEVICE_REL]);
            waiting = {
                track,
                args: rest,
                timer: setTimeout(() => {
                    waiting = null;
                    refuse('recorder-not-loaded', `Vamp-Capture did not load on track ${track + 1}`);
                }, loadTimeoutMs)
            };
            waiting.timer.unref?.();
        },

        /** A client's stop: a start still waiting for its recorder is dropped. */
        stop() {
            cancelWaiting();
            sendToDevice({ address: STOP_ADDRESS, args: [] });
        },

        sendProjectFolder,

        /** For Settings and tests: the tracks that have a recorder now. */
        tracksWithRecorder() {
            return [...lastHello.keys()].filter(hasRecorder).sort((a, b) => a - b);
        },

        dispose() {
            cancelWaiting();
        }
    };
}

module.exports = {
    createCaptureRecorder,
    newestTempProject,
    FEATURE_ID,
    HELLO_ADDRESS,
    BYE_ADDRESS,
    FOLDER_ADDRESS,
    DEVICE_LOAD_ADDRESS,
    DEVICE_SOURCE,
    DEVICE_REL
};
