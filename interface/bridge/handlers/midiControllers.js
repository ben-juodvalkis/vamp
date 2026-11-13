/**
 * The owner's Ableton Move, read by the bridge itself (ADR-537).
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
 * - **Move TotalMix knobs.** A relative encoder: 1..63 nudges a monitor
 *   level up that many steps, 65..127 down (1 and 127 are one step). A channel the bridge has no level for yet is left alone:
 *   a nudge from an unknown level would be a jump to a guess.
 *
 * The piano pedal that was here moved to `handlers/pedals.js` with every
 * other pedal (ADR-538).
 *
 * Pure logic: `transport/MidiInputs.js` hands each message in as
 * `(portName, bytes)`. Nothing here touches CoreMIDI, so the tests drive it
 * with plain arrays and fake timers.
 */

const PAD_HOLD_ADDRESS = '/looping/v3/move/pad_hold';
const TRACK_VOLUME_ADDRESS = '/looping/v3/selected_track/volume_relative';

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
 * @param {(msg: {address: string, args: Array}) => void} deps.sendToSurface
 * @param {(channel: string) => (number|undefined)} [deps.getTotalMixLevel]
 *   null/absent while TotalMix is off: the TotalMix knobs then do nothing
 * @param {(channel: string, db: number) => void} [deps.writeTotalMix]
 * @param {Object} [deps.logger]
 * @param {Object} [deps.timers] `{setTimeout, clearTimeout}`, for tests
 */
function createMidiControllers({
    config,
    padHoldMs,
    sendToSurface,
    getTotalMixLevel = null,
    writeTotalMix = null,
    logger = null,
    timers = { setTimeout, clearTimeout }
}) {
    const move = config.move;
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
        // A relative encoder: 1..63 up that many clicks, 65..127 down (128 −
        // value) clicks. The Move sends 2, 3, 126, 125 when turned fast
        // (measured 2026-11-13); the Max patch dropped those.
        const clicks = value >= 1 && value <= 63 ? value : value >= 65 ? value - 128 : 0;
        if (!clicks) return;
        const step = clicks * move.totalmixStepDb;
        const current = getTotalMixLevel(channel);
        if (typeof current !== 'number' || !Number.isFinite(current)) {
            logger?.debug?.('Move TotalMix knob: no level yet, ignored', { channel });
            return;
        }
        // Round to the step's own resolution so a hundred clicks don't drift.
        writeTotalMix(channel, Math.round((current + step) * 10) / 10);
    }

    return {
        /** One MIDI message from one input. */
        handleMidi(portName, bytes) {
            if (portName !== move.portName) return;
            const msg = parseMidi(bytes);
            if (!msg) return;
            if (msg.type === 'noteon') padDown(msg.a);
            else if (msg.type === 'noteoff') padUp(msg.a);
            else if (msg.type === 'cc' && msg.channel === move.knobChannel) knob(msg.a, msg.b);
        },

        /** The inputs were reopened: anything held is gone. */
        inputsReset() {
            for (const note of [...pads.keys()]) padUp(note);
        },

        /** Every port whose name marks it as the Move's; none reaches a pedal. */
        isMovePort
    };
}

module.exports = {
    createMidiControllers,
    parseMidi,
    PAD_HOLD_ADDRESS,
    TRACK_VOLUME_ADDRESS
};
