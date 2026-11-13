/**
 * The owner's MIDI controllers, read by the bridge itself (ADR-537).
 *
 * What `owner/Max Patches/Max Utility 1.0.maxpat` did in standalone Max,
 * minus what Ben cut on 2026-11-13 (scale mode, the drum-chain knob, the
 * SoftStep/EV-1 passthrough into Live, the Move startup sysex, Max's own
 * level sliders):
 *
 * - **Move pad hold** (ADR-432). A Move pad held for
 *   `ui.gestures.momentaryHoldMs` sends `/looping/v3/move/pad_hold <note> 1`,
 *   its release `... <note> 0`. A pad released sooner sends nothing, so a
 *   drum hit is never a hold. The step buttons (`move.ignoreNotes`) are not
 *   pads.
 * - **Move track-volume knob.** Its CC's raw relative value goes to
 *   `/looping/v3/selected_track/volume_relative`, as the patch sent it; the
 *   surface's `move_volume_knob` setting still decides whether it acts.
 * - **Move TotalMix knobs.** Value 1 nudges a monitor level up one step,
 *   127 down one. A channel the bridge has no level for yet is left alone:
 *   a nudge from an unknown level would be a jump to a guess.
 * - **The piano pedal.** A CC (67 unless the Settings page saved another)
 *   from any input but the Move, on any channel: pressed above 64, a tap or
 *   a hold at `osc.footTrigger.holdThresholdMs`, sent as `/looping/v3/foot/tap`
 *   or `/looping/v3/foot/hold`. Its on/off and CC are a user setting with
 *   Learn, saved to `logs/piano-pedal.json`.
 *
 * Pure logic: `transport/MidiInputs.js` hands each message in as
 * `(portName, bytes)`. Nothing here touches CoreMIDI, so the tests drive it
 * with plain arrays and fake timers.
 */

const fs = require('fs');
const path = require('path');

const PIANO_PEDAL_ADDRESS = '/bridge/piano_pedal';
const PIANO_PEDAL_ENABLED_ADDRESS = '/bridge/piano_pedal/enabled';
const PIANO_PEDAL_LEARN_ADDRESS = '/bridge/piano_pedal/learn';

const PAD_HOLD_ADDRESS = '/looping/v3/move/pad_hold';
const TRACK_VOLUME_ADDRESS = '/looping/v3/selected_track/volume_relative';
const FOOT_TAP_ADDRESS = '/looping/v3/foot/tap';
const FOOT_HOLD_ADDRESS = '/looping/v3/foot/hold';

/**
 * One MIDI message as bytes → `{type, channel, a, b}`, or null for anything
 * but a note or a CC. Channels are 1-16. A note-on at velocity 0 is a
 * note-off, as every keyboard means it.
 */
function parseMidi(bytes) {
    if (!bytes || bytes.length < 3) return null;
    const status = bytes[0] & 0xf0;
    const channel = (bytes[0] & 0x0f) + 1;
    const a = bytes[1];
    const b = bytes[2];
    if (status === 0x90) return { type: b === 0 ? 'noteoff' : 'noteon', channel, a, b };
    if (status === 0x80) return { type: 'noteoff', channel, a, b };
    if (status === 0xb0) return { type: 'cc', channel, a, b };
    return null;
}

const int = (value) => ({ type: 'i', value });

/**
 * @param {Object} deps
 * @param {Object} deps.config the `midiControllers` block of constants.json
 * @param {number} deps.padHoldMs
 * @param {number} deps.pedalHoldMs
 * @param {(msg: {address: string, args: Array}) => void} deps.sendToSurface
 * @param {(channel: string) => (number|undefined)} [deps.getTotalMixLevel]
 *   null/absent while TotalMix is off: the TotalMix knobs then do nothing
 * @param {(channel: string, db: number) => void} [deps.writeTotalMix]
 * @param {(state: Object) => void} [deps.onPedalState] the pedal's state changed
 * @param {string} [deps.settingsPath] where the pedal setting is saved
 * @param {Object} [deps.logger]
 * @param {Object} [deps.timers] `{setTimeout, clearTimeout}`, for tests
 */
function createMidiControllers({
    config,
    padHoldMs,
    pedalHoldMs,
    sendToSurface,
    getTotalMixLevel = null,
    writeTotalMix = null,
    onPedalState = () => {},
    settingsPath = null,
    logger = null,
    timers = { setTimeout, clearTimeout }
}) {
    const move = config.move;
    const pedalConfig = config.pianoPedal;
    const [ignoreLo, ignoreHi] = move.ignoreNotes || [16, 31];
    const totalmixKnobs = Object.fromEntries(
        Object.entries(move.totalmixKnobs || {}).filter(([key]) => !key.startsWith('_'))
    );
    const isMovePort = (portName) => portName.startsWith(move.portPrefix);

    // --- Move pads ----------------------------------------------------------
    /** note → {timer, fired} for every pad down right now */
    const pads = new Map();

    function padDown(note) {
        if (note >= ignoreLo && note <= ignoreHi) return;
        if (pads.has(note)) return;
        const pad = { fired: false, timer: null };
        pad.timer = timers.setTimeout(() => {
            pad.fired = true;
            sendToSurface({ address: PAD_HOLD_ADDRESS, args: [int(note), int(1)] });
        }, padHoldMs);
        pads.set(note, pad);
    }

    function padUp(note) {
        const pad = pads.get(note);
        if (!pad) return;
        pads.delete(note);
        timers.clearTimeout(pad.timer);
        if (pad.fired) sendToSurface({ address: PAD_HOLD_ADDRESS, args: [int(note), int(0)] });
    }

    // --- Move knobs ---------------------------------------------------------
    function knob(cc, value) {
        if (cc === move.trackVolumeCC) {
            sendToSurface({ address: TRACK_VOLUME_ADDRESS, args: [int(value)] });
            return;
        }
        const channel = totalmixKnobs[String(cc)];
        if (!channel || !getTotalMixLevel || !writeTotalMix) return;
        const step = value === 1 ? move.totalmixStepDb : value === 127 ? -move.totalmixStepDb : 0;
        if (!step) return;
        const current = getTotalMixLevel(channel);
        if (typeof current !== 'number' || !Number.isFinite(current)) {
            logger?.debug?.('Move TotalMix knob: no level yet, ignored', { channel });
            return;
        }
        // Round to the step's own resolution so a hundred clicks don't drift.
        writeTotalMix(channel, Math.round((current + step) * 10) / 10);
    }

    // --- Piano pedal --------------------------------------------------------
    const pedal = { enabled: true, cc: pedalConfig.defaultCC, learn: 'idle', heard: false };
    let pedalDown = false;
    let pedalHoldTimer = null;
    let pedalHeld = false;
    let learnTimer = null;

    if (settingsPath) {
        try {
            const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            if (typeof saved.enabled === 'boolean') pedal.enabled = saved.enabled;
            if (Number.isInteger(saved.cc) && saved.cc >= 0 && saved.cc <= 127) pedal.cc = saved.cc;
        } catch (e) {
            if (e.code !== 'ENOENT') logger?.warn?.('Piano pedal setting unreadable; using the default', { error: e.message });
        }
    }

    function savePedal() {
        if (!settingsPath) return;
        try {
            fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
            fs.writeFileSync(settingsPath, JSON.stringify({ enabled: pedal.enabled, cc: pedal.cc }, null, 2) + '\n');
        } catch (e) {
            logger?.warn?.('Could not save the piano pedal setting', { error: e.message });
        }
    }

    const pedalSnapshot = () => ({ ...pedal });
    const announce = () => onPedalState(pedalSnapshot());

    function releasePedal() {
        if (!pedalDown) return;
        pedalDown = false;
        timers.clearTimeout(pedalHoldTimer);
        pedalHoldTimer = null;
        if (!pedalHeld) sendToSurface({ address: FOOT_TAP_ADDRESS, args: [] });
        pedalHeld = false;
    }

    function pedalCC(value) {
        const pressed = value > pedalConfig.pressAbove;
        if (pressed === pedalDown) return;
        if (!pedal.heard) { pedal.heard = true; announce(); }
        if (!pressed) { releasePedal(); return; }
        pedalDown = true;
        pedalHeld = false;
        pedalHoldTimer = timers.setTimeout(() => {
            pedalHeld = true;
            pedalHoldTimer = null;
            sendToSurface({ address: FOOT_HOLD_ADDRESS, args: [] });
        }, pedalHoldMs);
    }

    function setLearn(on) {
        timers.clearTimeout(learnTimer);
        learnTimer = null;
        if (on) {
            pedal.learn = 'listening';
            learnTimer = timers.setTimeout(() => {
                learnTimer = null;
                pedal.learn = 'timeout';
                announce();
            }, pedalConfig.learnTimeoutMs);
        } else {
            pedal.learn = 'idle';
        }
        announce();
    }

    function learned(cc) {
        timers.clearTimeout(learnTimer);
        learnTimer = null;
        // A different CC may be mid-press; its release would never come.
        pedalDown = false;
        pedalHeld = false;
        timers.clearTimeout(pedalHoldTimer);
        pedal.cc = cc;
        pedal.enabled = true;
        pedal.learn = 'idle';
        pedal.heard = true;
        savePedal();
        logger?.info?.('Piano pedal learned', { cc });
        announce();
    }

    return {
        /** One MIDI message from one input. */
        handleMidi(portName, bytes) {
            const msg = parseMidi(bytes);
            if (!msg) return;
            if (isMovePort(portName)) {
                if (portName !== move.portName) return;
                if (msg.type === 'noteon') padDown(msg.a);
                else if (msg.type === 'noteoff') padUp(msg.a);
                else if (msg.type === 'cc' && msg.channel === move.knobChannel) knob(msg.a, msg.b);
                return;
            }
            if (msg.type !== 'cc') return;
            if (pedal.learn === 'listening') {
                if (msg.b > pedalConfig.pressAbove) learned(msg.a);
                return;
            }
            if (pedal.enabled && msg.a === pedal.cc) pedalCC(msg.b);
        },

        /** The inputs were reopened: anything held is gone. */
        inputsReset() {
            for (const note of [...pads.keys()]) padUp(note);
            releasePedal();
        },

        /**
         * A client's write to the pedal setting. Returns true when the
         * address was this module's.
         */
        onClientMessage(message) {
            const arg = Array.isArray(message.args) ? message.args[0] : undefined;
            const on = Number(arg?.value ?? arg) === 1;
            if (message.address === PIANO_PEDAL_ENABLED_ADDRESS) {
                pedal.enabled = on;
                if (!on) releasePedal();
                savePedal();
                announce();
                return true;
            }
            if (message.address === PIANO_PEDAL_LEARN_ADDRESS) {
                setLearn(on);
                return true;
            }
            return false;
        },

        pedalState: pedalSnapshot,
        wireArgs: () => [JSON.stringify(pedalSnapshot())]
    };
}

module.exports = {
    createMidiControllers,
    parseMidi,
    PIANO_PEDAL_ADDRESS,
    PIANO_PEDAL_ENABLED_ADDRESS,
    PIANO_PEDAL_LEARN_ADDRESS,
    PAD_HOLD_ADDRESS,
    TRACK_VOLUME_ADDRESS,
    FOOT_TAP_ADDRESS,
    FOOT_HOLD_ADDRESS
};
