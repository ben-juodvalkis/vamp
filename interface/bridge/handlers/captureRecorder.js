/**
 * The capture recorder: looping-recorder.amxd on Return A, behind REC
 * (general-release plan.md §4, `captureRecorder`).
 *
 * Every edition has it — it is our own device and needs only Max for Live —
 * so it is not a feature switch. The bridge owns two facts about it:
 *
 * **Is it there?** The device says `/capture/hello` once a second from the
 * moment its script loads, and `/capture/bye` when it is deleted. The feature
 * registry's `captureRecorder` entry is available while hellos arrive and
 * greyed out with a reason otherwise, so REC can tell the performer what to
 * do. `/capture/query` could not be this check: it replays the last file,
 * which the UI takes as a fresh capture.
 *
 * **Where does an unsaved set record?** Live gives every unsaved set a real
 * project folder as it opens — `<YYYY-MM-DD HHMMSS> Temp Project` under its
 * temporary folder, holding `Ableton Project Info` (measured 2026-09-27: Live
 * started 12:09:14, its temp project appeared 12:09:22). The LOM does not name
 * it, and the device's Max JS can neither list folders portably nor read this
 * config, so the bridge finds the newest one and sends it as
 * `/capture/folder <path>` just before every `/capture/start`. The device uses
 * it only while the set is unsaved; a saved set records beside its `.als`.
 * The temporary folder is a Live preference, `paths.liveRecordingsDir` here
 * (Live's default); Preferences.cfg holds it with no key to read it by.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const FEATURE_ID = 'captureRecorder';
const HELLO_ADDRESS = '/capture/hello';
const BYE_ADDRESS = '/capture/bye';
const FOLDER_ADDRESS = '/capture/folder';

/** Three missed hellos at the device's 1 s beat. */
const SILENCE_MS = 3000;

const REASON_WAITING = 'Waiting for the recorder';
const REASON_ABSENT = 'No recorder on Return A';

const TEMP_PROJECT_SUFFIX = ' Temp Project';
const LIVE_PROJECT_MARKER = 'Ableton Project Info';

function expandHome(p) {
    return typeof p === 'string' && p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

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
 * @param {Object} deps
 * @param {Object} deps.features the feature registry (utils/features.js)
 * @param {(msg: {address: string, args: Array}) => void} deps.sendToDevice
 * @param {string} [deps.recordingsDir] Live's temporary folder; `~/` expands
 * @param {Object} [deps.logger]
 * @param {Object} [deps.fsImpl]
 * @param {number} [deps.silenceMs]
 */
function createCaptureRecorder({ features, sendToDevice, recordingsDir, logger, fsImpl = fs, silenceMs = SILENCE_MS }) {
    const tempRoot = expandHome(recordingsDir || '~/Music/Ableton/Live Recordings');
    let silenceTimer = null;

    function absentAfterSilence() {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
            silenceTimer = null;
            features.setAvailability(FEATURE_ID, false, REASON_ABSENT);
        }, silenceMs);
        silenceTimer.unref?.();
    }

    features.setAvailability(FEATURE_ID, false, REASON_WAITING);
    absentAfterSilence();

    return {
        /**
         * Every packet from the device. Returns true when the bridge has
         * consumed it: the once-a-second hello and the bye are for the bridge
         * alone, and would otherwise flood every client.
         *
         * @param {{address: string}} msg
         */
        onDeviceMessage(msg) {
            if (msg.address === BYE_ADDRESS) {
                if (silenceTimer) clearTimeout(silenceTimer);
                silenceTimer = null;
                features.setAvailability(FEATURE_ID, false, REASON_ABSENT);
                return true;
            }
            // Any packet proves the device is there; state and file go on to
            // the clients.
            features.setAvailability(FEATURE_ID, true);
            absentAfterSilence();
            return msg.address === HELLO_ADDRESS;
        },

        /**
         * Tell the device where an unsaved set records, ahead of a start.
         * An empty path means none was found; the device then refuses to
         * record an unsaved set and says why (`/capture/error no-project-folder`).
         */
        sendProjectFolder() {
            const folder = newestTempProject(tempRoot, fsImpl);
            if (!folder) logger?.warn?.('No Live temp project found for an unsaved set\'s capture', { tempRoot });
            sendToDevice({ address: FOLDER_ADDRESS, args: [{ type: 's', value: folder }] });
            return folder;
        },

        stop() {
            if (silenceTimer) clearTimeout(silenceTimer);
            silenceTimer = null;
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
    REASON_WAITING,
    REASON_ABSENT
};
