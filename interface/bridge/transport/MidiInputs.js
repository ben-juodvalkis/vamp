/**
 * Every MIDI input on this Mac, opened by the bridge (ADR-537).
 *
 * Wraps `@julusian/midi` (RtMidi over CoreMIDI), an optional dependency:
 * the module is required only when `features.midiControllers` is on, so a
 * Mac without it, or the bundled general edition, never loads a native
 * binary. CoreMIDI lets any number of clients read one source, so Live's
 * own Move script keeps the Move Live Port while this reads it too.
 *
 * Inputs come and go (a Move unplugged, a piano switched on), and RtMidi
 * says nothing when they do, so the port names are polled every `pollMs`
 * and every input is reopened when the list changes.
 */

/**
 * @param {Object} deps
 * @param {(portName: string, bytes: number[]) => void} deps.onMessage
 * @param {() => void} [deps.onReopen] called after the inputs are reopened
 * @param {number} deps.pollMs
 * @param {Object} [deps.logger]
 * @param {Object} [deps.midi] the `@julusian/midi` module, for tests
 * @returns {{ ok: true, close: () => void, ports: () => string[] } | { ok: false, reason: string }}
 */
function openMidiInputs({ onMessage, onReopen = () => {}, pollMs, logger = null, midi = null }) {
    let lib = midi;
    if (!lib) {
        try {
            lib = require('@julusian/midi');
        } catch (e) {
            logger?.error?.('MIDI library missing: run npm install', { error: e.message });
            return { ok: false, reason: 'MIDI library missing' };
        }
    }

    const probe = new lib.Input();
    /** @type {Array<{name: string, input: Object}>} */
    let open = [];
    let names = [];

    const listNames = () => {
        const out = [];
        const count = probe.getPortCount();
        for (let i = 0; i < count; i++) out.push(probe.getPortName(i));
        return out;
    };

    function closeAll() {
        for (const { input } of open) {
            try { input.closePort(); } catch { /* already gone */ }
        }
        open = [];
    }

    function openAll(list) {
        closeAll();
        list.forEach((name, index) => {
            try {
                const input = new lib.Input();
                // Sysex, clock and active sensing never matter here.
                input.ignoreTypes(true, true, true);
                input.on('message', (_delta, bytes) => {
                    try {
                        onMessage(name, bytes);
                    } catch (e) {
                        logger?.error?.('MIDI message handler threw', { port: name, error: e.message });
                    }
                });
                input.openPort(index);
                open.push({ name, input });
            } catch (e) {
                logger?.warn?.('Could not open a MIDI input', { port: name, error: e.message });
            }
        });
        names = list;
        logger?.info?.('MIDI inputs open', { ports: open.map((o) => o.name) });
    }

    openAll(listNames());

    const timer = setInterval(() => {
        let now;
        try {
            now = listNames();
        } catch (e) {
            logger?.warn?.('Could not list MIDI inputs', { error: e.message });
            return;
        }
        if (now.length === names.length && now.every((n, i) => n === names[i])) return;
        openAll(now);
        onReopen();
    }, pollMs);
    if (timer.unref) timer.unref();

    return {
        ok: true,
        ports: () => open.map((o) => o.name),
        close() {
            clearInterval(timer);
            closeAll();
            try { probe.closePort(); } catch { /* never opened */ }
        }
    };
}

module.exports = { openMidiInputs };
