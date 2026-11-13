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
 * recorder-not-loaded`. A stop before then cancels the start.
 *
 * **Delete it after the take** (Ben, 2026-10-31). The device's
 * `/capture/file <wav> <devicePath>` names itself; `deleteAfterMs` later,
 * once `sfrecord~` has finished the file, the surface deletes it
 * (`device/delete`) and the track counts as having none, so the next REC
 * loads a fresh one. Each take costs two undo steps in Live: Insert Device
 * and Delete Device.
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
 *
 * **An input device Vamp for Mac records** (ADR-533). REC on Input with a
 * device picked in Settings → Capture is no Live device's work: Vamp for Mac
 * opens that Core Audio device itself and records the channel or pair named.
 * The app is a WebSocket client like the page; it says `/capture/input/hello
 * <devices JSON>` once a second, and while it does its devices are offered to
 * every client as `/capture/input/devices <JSON>`. A start names the device by
 * its Core Audio UID; the bridge asks the surface where the set is saved
 * (`/looping/v3/session/file_path/query`), takes its folder, or the newest
 * temp project for an unsaved set or a surface that does not answer, and
 * sends the app `/capture/input/start <folder> <uid> <channel>`. The app's
 * `/capture/input/{state,meter,file,error}` go to every client as the
 * device's `/capture/*` would, so REC and the Simpler that follows cannot tell
 * which recorder made the take. Nothing is loaded into Live and nothing is
 * deleted after. While Settings shows the picker it asks `/capture/input/monitor
 * <uid>` every couple of seconds; the bridge passes that to the app, and the
 * app's `/capture/input/levels <uid> <levels JSON> <access>` back to every
 * client, for the meters. A start with no device named still goes through Vamp-Capture
 * and Live's Ext. In, as before.
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

const FILE_ADDRESS = '/capture/file';
const DEVICE_LOAD_ADDRESS = '/looping/v3/device/load';
const DEVICE_DELETE_ADDRESS = '/looping/v3/device/delete';
const DEVICE_SOURCE = 'place:Vamp Devices';
const DEVICE_REL = 'Vamp-Capture/Vamp-Capture.amxd';

/** Three missed hellos at the device's 1 s beat. */
const SILENCE_MS = 3000;
/** A Max device's first load in a set takes longest. */
const LOAD_TIMEOUT_MS = 8000;
/** Time for `sfrecord~` to close the file before its device goes. */
const DELETE_AFTER_MS = 500;

const APP_PREFIX = '/capture/input/';
const APP_HELLO = '/capture/input/hello';
const APP_DEVICES = '/capture/input/devices';
const APP_DEVICES_QUERY = '/capture/input/devices/query';
const APP_START = '/capture/input/start';
const APP_STOP = '/capture/input/stop';
/** A page's ask for live levels of one device (`''` to stop), to the app. */
const APP_MONITOR = '/capture/input/monitor';
/** The app's levels for that device, to every client as they are. */
const APP_LEVELS = '/capture/input/levels';
/**
 * The input the sidebar's REC records, one for the rig: every screen shows
 * and sets the same (2026-11-13: kept per screen, the iPad had none while
 * the Mac had the Babyface). `{uid, name, inputs, channel}`, kept on disk.
 */
const CHOICE = '/capture/input/choice';
const CHOICE_SET = '/capture/input/choice/set';
const CHOICE_QUERY = '/capture/input/choice/query';
const SET_PATH_QUERY = '/looping/v3/session/file_path/query';
/** An app recorder's own replies, renamed to what the device would say. */
const APP_RELAYED = new Map([
    ['/capture/input/state', '/capture/state'],
    ['/capture/input/meter', '/capture/meter'],
    ['/capture/input/file', FILE_ADDRESS],
    ['/capture/input/error', ERROR_ADDRESS]
]);
/** The surface answers in a few ms; one that predates the query never does. */
const SET_PATH_TIMEOUT_MS = 1000;

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

/**
 * The devices an app's hello offers: `[{uid, name, inputs}]`, anything else
 * dropped. `inputs` is the device's count of input channels.
 *
 * @param {unknown} json
 */
function parseDevices(json) {
    let list;
    try {
        list = JSON.parse(String(json));
    } catch {
        return [];
    }
    if (!Array.isArray(list)) return [];
    return list.filter((d) => d && typeof d.uid === 'string' && d.uid
        && typeof d.name === 'string' && Number.isInteger(d.inputs) && d.inputs > 0)
        .map(({ uid, name, inputs }) => ({ uid, name, inputs }));
}

/**
 * A choice as the page sends it, or null when it is not one. `uid` `''` is
 * Live's own input.
 *
 * @param {unknown} json
 */
function parseChoice(json) {
    let c;
    try {
        c = JSON.parse(String(json));
    } catch {
        return null;
    }
    if (!c || typeof c !== 'object') return null;
    const { uid, name, inputs, channel } = c;
    if (typeof uid !== 'string' || typeof channel !== 'string' || !/^\d+(\/\d+)?$/.test(channel)) return null;
    if (uid && (typeof name !== 'string' || !Number.isInteger(inputs) || inputs < 1)) return null;
    return uid ? { uid, name, inputs, channel } : { uid: '', name: '', inputs: 0, channel };
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
 * @param {number} [deps.deleteAfterMs]
 * @param {number} [deps.setPathTimeoutMs]
 * @param {string} [deps.choicePath] where the input choice is kept; none, not kept
 */
function createCaptureRecorder({
    features, sendToDevice, sendToSurface, broadcast, recordingsDir, logger,
    fsImpl = fs, silenceMs = SILENCE_MS, loadTimeoutMs = LOAD_TIMEOUT_MS,
    deleteAfterMs = DELETE_AFTER_MS, setPathTimeoutMs = SET_PATH_TIMEOUT_MS,
    choicePath = ''
}) {
    const tempRoot = expandHome(recordingsDir || '~/Music/Ableton/Live Recordings');
    /** track index → when its recorder last said hello */
    const lastHello = new Map();
    /** A start waiting for the recorder it loaded: {track, args, timer}. */
    let waiting = null;
    /** Deletes scheduled after a take, cleared on dispose. */
    const deleteTimers = new Set();
    /**
     * Vamp for Mac's recorder while its hellos arrive: how to reach it, the
     * devices it offers (as JSON, to tell a change), and the timer that
     * forgets it after `silenceMs` of quiet.
     */
    let app = null;
    /** Starts for the app waiting on the surface's set path, in order. */
    const pathWaiters = [];

    /** The rig's input choice (see CHOICE), null until a screen sets one. */
    let choice = null;
    if (choicePath) {
        try {
            choice = parseChoice(fsImpl.readFileSync(choicePath, 'utf8'));
        } catch {
            choice = null;
        }
    }
    function offerChoice() {
        broadcast(CHOICE, [choice ? JSON.stringify(choice) : '']);
    }
    function keepChoice() {
        if (!choicePath) return;
        try {
            fsImpl.writeFileSync(choicePath, JSON.stringify(choice), 'utf8');
        } catch (err) {
            logger?.warn?.('Could not keep the capture input choice', { choicePath, error: err.message });
        }
    }

    function offerDevices() {
        broadcast(APP_DEVICES, [app ? app.devicesJson : '[]']);
    }

    function forgetApp() {
        if (!app) return;
        clearTimeout(app.timer);
        app = null;
        offerDevices();
    }

    function deleteAfterTake(devicePath) {
        const m = /^tracks\/(\d+)\/devices\/\d+$/.exec(devicePath);
        if (!m) return;
        // Gone as far as REC is concerned: the next start loads a fresh one.
        lastHello.delete(Number(m[1]));
        const timer = setTimeout(() => {
            deleteTimers.delete(timer);
            sendToSurface(DEVICE_DELETE_ADDRESS, [devicePath]);
        }, deleteAfterMs);
        timer.unref?.();
        deleteTimers.add(timer);
    }

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

    /** Where a take for the app goes: beside the saved set, else the temp project. */
    function folderFromSetPath(setPath) {
        if (setPath) return path.dirname(setPath);
        const folder = newestTempProject(tempRoot, fsImpl);
        if (!folder) logger?.warn?.('No Live temp project found for an unsaved set\'s capture', { tempRoot });
        return folder;
    }

    function startOnApp(rest) {
        const [, channel = '', uid = ''] = rest;
        if (!app || !app.devices.some((d) => d.uid === uid)) {
            refuse('no-input-device', 'Vamp for Mac is not offering that input device');
            return;
        }
        const waiter = { channel, uid, timer: null };
        waiter.timer = setTimeout(() => answerPath(waiter, ''), setPathTimeoutMs);
        waiter.timer.unref?.();
        pathWaiters.push(waiter);
        sendToSurface(SET_PATH_QUERY, []);
    }

    function answerPath(waiter, setPath) {
        const at = pathWaiters.indexOf(waiter);
        if (at < 0) return;
        pathWaiters.splice(at, 1);
        clearTimeout(waiter.timer);
        const folder = folderFromSetPath(setPath);
        if (!folder) {
            refuse('no-project-folder', 'the set is unsaved and Live\'s temp project was not found');
            return;
        }
        if (!app) {
            refuse('no-input-device', 'Vamp for Mac went away');
            return;
        }
        app.send(APP_START, [folder, waiter.uid, waiter.channel]);
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
            if (msg.address === FILE_ADDRESS) {
                const devicePath = argValue(msg.args?.[1]);
                if (typeof devicePath === 'string' && devicePath) deleteAfterTake(devicePath);
                return false;
            }
            // A bye does not say which track; its hellos stop, which does.
            return msg.address === BYE_ADDRESS;
        },

        /**
         * A client's `/capture/start <track> [source] [channel] [device]`.
         * Input with a device names a Vamp for Mac input (its Core Audio
         * UID), which the app records; without one, Vamp-Capture does.
         *
         * @param {Array} args
         */
        start(args = []) {
            const track = Number(argValue(args[0]));
            const extra = args.slice(1, 4).map(argValue).map((v) => (typeof v === 'string' ? v : ''));
            if (extra[0] === 'input' && extra[2]) {
                cancelWaiting();
                startOnApp(extra);
                return;
            }
            const rest = extra.slice(0, 2).filter(Boolean);
            if (!Number.isInteger(track) || track < 0) {
                refuse('no-track', 'REC records the selected track, and none is selected');
                return;
            }
            // Already loading one for this track: this start replaces that
            // one's arguments; a second load would put two on the track.
            if (waiting && waiting.track === track) {
                waiting.args = rest;
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
            for (const waiter of pathWaiters.splice(0)) clearTimeout(waiter.timer);
            sendToDevice({ address: STOP_ADDRESS, args: [] });
            app?.send(APP_STOP, []);
        },

        /**
         * A message from a client under `/capture/input/`: Vamp for Mac's
         * recorder. Returns true when it was one.
         *
         * @param {(address: string, args: Array) => void} send to that client alone
         * @param {{address: string, args?: Array}} msg
         */
        onAppMessage(send, msg) {
            if (!msg.address.startsWith(APP_PREFIX)) return false;
            if (msg.address === APP_HELLO) {
                const devices = parseDevices(argValue(msg.args?.[0]));
                const devicesJson = JSON.stringify(devices);
                const changed = !app || app.devicesJson !== devicesJson;
                if (app) clearTimeout(app.timer);
                app = { send, devices, devicesJson, timer: setTimeout(forgetApp, silenceMs) };
                app.timer.unref?.();
                if (changed) offerDevices();
                return true;
            }
            if (msg.address === APP_DEVICES_QUERY) {
                offerDevices();
                offerChoice();
                return true;
            }
            if (msg.address === CHOICE_QUERY) {
                offerChoice();
                return true;
            }
            if (msg.address === CHOICE_SET) {
                const next = parseChoice(argValue(msg.args?.[0]));
                if (next) {
                    choice = next;
                    keepChoice();
                }
                offerChoice();
                return true;
            }
            if (msg.address === APP_MONITOR) {
                const uid = argValue(msg.args?.[0]);
                app?.send(APP_MONITOR, [typeof uid === 'string' ? uid : '']);
                return true;
            }
            if (msg.address === APP_LEVELS) {
                broadcast(APP_LEVELS, (msg.args || []).map(argValue));
                return true;
            }
            const relayed = APP_RELAYED.get(msg.address);
            if (relayed) broadcast(relayed, (msg.args || []).map(argValue));
            return true;
        },

        /**
         * Every packet from the surface. Returns true for the set-path reply,
         * which is for the bridge alone.
         *
         * @param {{address: string, args?: Array}} msg
         */
        onSurfaceMessage(msg) {
            if (msg.address !== SET_PATH_QUERY) return false;
            const setPath = argValue(msg.args?.[0]);
            if (pathWaiters.length > 0) answerPath(pathWaiters[0], typeof setPath === 'string' ? setPath : '');
            return true;
        },

        /** For tests: the rig's input choice. */
        inputChoice() {
            return choice;
        },

        /** For tests: the devices Vamp for Mac offers now. */
        inputDevices() {
            return app ? app.devices : [];
        },

        sendProjectFolder,

        /** For Settings and tests: the tracks that have a recorder now. */
        tracksWithRecorder() {
            return [...lastHello.keys()].filter(hasRecorder).sort((a, b) => a - b);
        },

        dispose() {
            cancelWaiting();
            for (const waiter of pathWaiters.splice(0)) clearTimeout(waiter.timer);
            if (app) clearTimeout(app.timer);
            app = null;
            for (const timer of deleteTimers) clearTimeout(timer);
            deleteTimers.clear();
        }
    };
}

module.exports = {
    createCaptureRecorder,
    newestTempProject,
    parseDevices,
    parseChoice,
    FEATURE_ID,
    CHOICE,
    CHOICE_SET,
    CHOICE_QUERY,
    APP_DEVICES,
    APP_START,
    APP_STOP,
    APP_MONITOR,
    APP_LEVELS,
    SET_PATH_QUERY,
    HELLO_ADDRESS,
    BYE_ADDRESS,
    FOLDER_ADDRESS,
    DEVICE_LOAD_ADDRESS,
    DEVICE_DELETE_ADDRESS,
    DEVICE_SOURCE,
    DEVICE_REL
};
