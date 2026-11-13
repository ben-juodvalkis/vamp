/**
 * Every pedal, read by the bridge from any MIDI input (ADR-538).
 *
 * Three roles, each a user setting with Learn on the Settings page's Pedals
 * card, saved to `logs/pedals.json`:
 *
 * - **loop** — the loop trigger: one or more pedals (a USB foot switch, a
 *   piano's sustain or soft pedal), each a channel (0 = any) and CC, into
 *   `/looping/v3/foot/tap` and `/looping/v3/foot/hold`. A momentary pedal
 *   taps on a release before `osc.footTrigger.holdThresholdMs` and holds at
 *   it; a latching one taps on every stomp and never holds. Learn tells them
 *   apart (the surface's rule since 2026-09-26): the opposite side of 64 on
 *   the same CC within `learnReleaseWindowMs` is a momentary release, and
 *   the first value's side is the press; nothing is latching.
 * - **wahToe** — the expression pedal's toe switch into
 *   `/looping/v3/wah/engage`, on **either** edge: it latches, so each
 *   physical press flips it (ADR-422's measurement).
 * - **wahSweep** — the expression pedal's sweep, every value into
 *   `/looping/v3/wah/freq [0-127]`.
 *
 * The wah roles act only while `wahEnabled` (the `expressionPedal` switch).
 * The Move's own ports never reach a pedal, not even during Learn: its knobs
 * send 127 on every turn down. Its External Port does, since a pedal plugged
 * into the Move arrives there (`isExcludedPort` is the orchestrator's). Until 2026-11-13 the foot switch and the wah
 * reached the surface as MIDI on its own Input in Live (ADR-422) and the
 * piano pedal reached the bridge (ADR-537); the surface's half is gone.
 *
 * With nothing saved, `midiPedals` in constants seeds the roles once:
 * `footSwitchCC` (on `channel`) and `pianoPedalCC` (any channel) as loop
 * pedals, `wahToeSwitchCC` and `wahExpressionCC` on `channel`. A config
 * naming none is no pedal at all, as before: a stranger's keyboard never
 * loops by default.
 *
 * Pure logic: `transport/MidiInputs.js` hands each message in as
 * `(portName, bytes)`; the tests drive it with arrays and fake timers.
 */

const fs = require('fs');
const path = require('path');
const { parseMidi } = require('./midiControllers');

const PEDALS_ADDRESS = '/bridge/pedals';
const PEDALS_ENABLED_ADDRESS = '/bridge/pedals/enabled';
const PEDALS_LEARN_ADDRESS = '/bridge/pedals/learn';
const PEDALS_FORGET_ADDRESS = '/bridge/pedals/forget';

const FOOT_TAP_ADDRESS = '/looping/v3/foot/tap';
const FOOT_HOLD_ADDRESS = '/looping/v3/foot/hold';
const WAH_ENGAGE_ADDRESS = '/looping/v3/wah/engage';
const WAH_FREQ_ADDRESS = '/looping/v3/wah/freq';

const ROLES = Object.freeze(['loop', 'wahToe', 'wahSweep']);
const MOMENTARY = 'momentary';
const LATCHING = 'latching';
/** Both switches split high from low here, the MIDI switch convention. */
const PRESS_MIN = 64;
/** Loop pedals kept at once; Learn past it replaces the oldest. */
const MAX_LOOP_PEDALS = 4;

const isInt = (v) => Number.isInteger(v);

/** A saved or seeded pedal, or null for anything malformed. */
function validPedal(p, { loop = false } = {}) {
    if (!p || typeof p !== 'object') return null;
    if (!isInt(p.channel) || p.channel < 0 || p.channel > 16) return null;
    if (!isInt(p.cc) || p.cc < 0 || p.cc > 127) return null;
    if (!loop) return { channel: p.channel, cc: p.cc };
    const mode = p.mode === LATCHING ? LATCHING : MOMENTARY;
    const pressHigh = p.pressHigh !== false;
    return { channel: p.channel, cc: p.cc, mode, pressHigh };
}

const matches = (pedal, msg) => pedal.cc === msg.a && (pedal.channel === 0 || pedal.channel === msg.channel);
const keyOf = (p) => `${p.channel}:${p.cc}`;

/** The roles `midiPedals` names, for a Mac with nothing saved. */
function seedFromConfig(midiPedals) {
    const cfg = midiPedals && typeof midiPedals === 'object' ? midiPedals : {};
    const channel = isInt(cfg.channel) && cfg.channel >= 0 && cfg.channel <= 16 ? cfg.channel : 10;
    const loop = [];
    if (isInt(cfg.footSwitchCC)) loop.push(validPedal({ channel, cc: cfg.footSwitchCC }, { loop: true }));
    if (isInt(cfg.pianoPedalCC)) loop.push(validPedal({ channel: 0, cc: cfg.pianoPedalCC }, { loop: true }));
    return {
        loop: { enabled: true, pedals: loop.filter(Boolean) },
        wahToe: isInt(cfg.wahToeSwitchCC) ? validPedal({ channel, cc: cfg.wahToeSwitchCC }) : null,
        wahSweep: isInt(cfg.wahExpressionCC) ? validPedal({ channel, cc: cfg.wahExpressionCC }) : null
    };
}

/**
 * @param {Object} deps
 * @param {(msg: {address: string, args: Array}) => void} deps.sendToSurface
 * @param {number} deps.holdMs
 * @param {boolean} deps.wahEnabled
 * @param {(port: string) => boolean} deps.isExcludedPort the Move's ports
 * @param {Object} [deps.midiPedals] constants' `midiPedals`, the seed
 * @param {Object} [deps.timing] `{learnTimeoutMs, learnReleaseWindowMs}`
 * @param {string} [deps.settingsPath]
 * @param {(state: Object) => void} [deps.onState]
 * @param {Object} [deps.logger]
 * @param {Object} [deps.timers]
 */
function createPedals({
    sendToSurface,
    holdMs,
    wahEnabled,
    isExcludedPort,
    midiPedals = null,
    timing = {},
    settingsPath = null,
    onState = () => {},
    logger = null,
    timers = { setTimeout, clearTimeout }
}) {
    const learnTimeoutMs = timing.learnTimeoutMs ?? 10000;
    const releaseWindowMs = timing.learnReleaseWindowMs ?? 1500;

    let saved = null;
    if (settingsPath) {
        try {
            saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        } catch (e) {
            if (e.code !== 'ENOENT') logger?.warn?.('Pedal settings unreadable; seeding from the config', { error: e.message });
        }
    }
    const settings = saved && typeof saved === 'object'
        ? {
            loop: {
                enabled: saved.loop?.enabled !== false,
                pedals: (Array.isArray(saved.loop?.pedals) ? saved.loop.pedals : [])
                    .map((p) => validPedal(p, { loop: true })).filter(Boolean).slice(0, MAX_LOOP_PEDALS)
            },
            wahToe: validPedal(saved.wahToe),
            wahSweep: validPedal(saved.wahSweep)
        }
        : seedFromConfig(midiPedals);

    const heard = { loop: false, wahToe: false, wahSweep: false };
    /** `{role, state: 'listening'|'timeout', first, seq}` or null */
    let learn = null;
    let learnSeq = 0;
    let learnTimer = null;
    let windowTimer = null;
    /** per loop pedal key → {down, holdFired, timer} / {latchHigh} */
    const loopRuntime = new Map();
    let toeHigh = null;

    function save() {
        if (!settingsPath) return;
        try {
            fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        } catch (e) {
            logger?.warn?.('Could not save the pedal settings', { error: e.message });
        }
    }

    const snapshot = () => ({
        wah: wahEnabled,
        learn: learn ? { role: learn.role, state: learn.state } : null,
        loop: { enabled: settings.loop.enabled, pedals: settings.loop.pedals.map((p) => ({ ...p })), heard: heard.loop },
        wahToe: { pedal: settings.wahToe ? { ...settings.wahToe } : null, heard: heard.wahToe },
        wahSweep: { pedal: settings.wahSweep ? { ...settings.wahSweep } : null, heard: heard.wahSweep }
    });
    const announce = () => onState(snapshot());

    function markHeard(role) {
        if (heard[role]) return;
        heard[role] = true;
        announce();
    }

    // --- loop pedals ----------------------------------------------------------
    function resetLoop() {
        for (const rt of loopRuntime.values()) timers.clearTimeout(rt.timer);
        loopRuntime.clear();
    }

    function loopCC(pedal, value) {
        const high = value >= PRESS_MIN;
        const key = keyOf(pedal);
        let rt = loopRuntime.get(key);
        if (!rt) {
            rt = { down: false, holdFired: false, timer: null, latchHigh: null };
            loopRuntime.set(key, rt);
        }
        if (pedal.mode === LATCHING) {
            if (high === rt.latchHigh) return; // a level repeat, not a stomp
            rt.latchHigh = high;
            sendToSurface({ address: FOOT_TAP_ADDRESS, args: [] });
            return;
        }
        if (high === pedal.pressHigh) {
            if (rt.down) return; // a repeated press
            rt.down = true;
            rt.holdFired = false;
            rt.timer = timers.setTimeout(() => {
                rt.timer = null;
                if (!rt.down) return;
                rt.holdFired = true;
                sendToSurface({ address: FOOT_HOLD_ADDRESS, args: [] });
            }, holdMs);
            return;
        }
        if (!rt.down) return; // an unmatched release
        rt.down = false;
        timers.clearTimeout(rt.timer);
        rt.timer = null;
        if (!rt.holdFired) sendToSurface({ address: FOOT_TAP_ADDRESS, args: [] });
        rt.holdFired = false;
    }

    // --- Learn ----------------------------------------------------------------
    function clearLearnTimers() {
        timers.clearTimeout(learnTimer);
        timers.clearTimeout(windowTimer);
        learnTimer = null;
        windowTimer = null;
    }

    function startLearn(role) {
        clearLearnTimers();
        learnSeq += 1;
        const seq = learnSeq;
        learn = { role, state: 'listening', first: null, seq };
        learnTimer = timers.setTimeout(() => {
            if (!learn || learn.seq !== seq || learn.first) return;
            learn.state = 'timeout';
            announce();
        }, learnTimeoutMs);
        announce();
    }

    function stopLearn() {
        clearLearnTimers();
        learnSeq += 1;
        learn = null;
        announce();
    }

    function finishLearn(pedal) {
        const role = learn.role;
        clearLearnTimers();
        learnSeq += 1;
        learn = null;
        if (role === 'loop') {
            const kept = settings.loop.pedals.filter((p) => keyOf(p) !== keyOf(pedal));
            kept.push(pedal);
            settings.loop.pedals = kept.slice(-MAX_LOOP_PEDALS);
            settings.loop.enabled = true;
            resetLoop();
        } else {
            settings[role] = pedal;
            if (role === 'wahToe') toeHigh = null;
        }
        heard[role] = true;
        save();
        logger?.info?.('Pedal learned', { role, ...pedal });
        announce();
    }

    function learnEvent(msg) {
        const high = msg.b >= PRESS_MIN;
        if (learn.role !== 'loop') {
            // The toe switch and the sweep: the first CC heard is the pedal.
            finishLearn({ channel: msg.channel, cc: msg.a });
            return;
        }
        if (!learn.first) {
            learn.first = { channel: msg.channel, cc: msg.a, high };
            const seq = learn.seq;
            windowTimer = timers.setTimeout(() => {
                if (!learn || learn.seq !== seq) return;
                const f = learn.first;
                finishLearn({ channel: f.channel, cc: f.cc, mode: LATCHING, pressHigh: true });
            }, releaseWindowMs);
            return;
        }
        const f = learn.first;
        if (f.channel !== msg.channel || f.cc !== msg.a || f.high === high) return;
        finishLearn({ channel: f.channel, cc: f.cc, mode: MOMENTARY, pressHigh: f.high });
    }

    return {
        handleMidi(portName, bytes) {
            if (isExcludedPort(portName)) return;
            const msg = parseMidi(bytes);
            if (!msg || msg.type !== 'cc') return;
            if (learn && learn.state === 'listening') {
                learnEvent(msg);
                return;
            }
            if (settings.loop.enabled) {
                for (const pedal of settings.loop.pedals) {
                    if (!matches(pedal, msg)) continue;
                    markHeard('loop');
                    loopCC(pedal, msg.b);
                }
            }
            if (!wahEnabled) return;
            if (settings.wahToe && matches(settings.wahToe, msg)) {
                markHeard('wahToe');
                const high = msg.b >= PRESS_MIN;
                if (high !== toeHigh) {
                    toeHigh = high;
                    sendToSurface({ address: WAH_ENGAGE_ADDRESS, args: [] });
                }
            }
            if (settings.wahSweep && matches(settings.wahSweep, msg)) {
                markHeard('wahSweep');
                sendToSurface({ address: WAH_FREQ_ADDRESS, args: [{ type: 'i', value: msg.b }] });
            }
        },

        /** The inputs were reopened: a held pedal's release may never come. */
        inputsReset() {
            // A press cut off by an unplug is dropped, never tapped.
            resetLoop();
        },

        /** A client's write. Returns true when the address was this module's. */
        onClientMessage(message) {
            const args = Array.isArray(message.args) ? message.args.map((a) => (a && typeof a === 'object' ? a.value : a)) : [];
            if (message.address === PEDALS_ENABLED_ADDRESS) {
                settings.loop.enabled = Number(args[0]) === 1;
                if (!settings.loop.enabled) resetLoop();
                save();
                announce();
                return true;
            }
            if (message.address === PEDALS_LEARN_ADDRESS) {
                const role = String(args[0]);
                if (!ROLES.includes(role)) return true;
                if (role !== 'loop' && !wahEnabled) return true;
                if (Number(args[1]) === 1) startLearn(role);
                else stopLearn();
                return true;
            }
            if (message.address === PEDALS_FORGET_ADDRESS) {
                const role = String(args[0]);
                if (role === 'loop') {
                    settings.loop.pedals = [];
                    resetLoop();
                } else if (role === 'wahToe' || role === 'wahSweep') {
                    settings[role] = null;
                } else {
                    return true;
                }
                heard[role] = false;
                save();
                announce();
                return true;
            }
            return false;
        },

        state: snapshot,
        wireArgs: () => [JSON.stringify(snapshot())]
    };
}

module.exports = {
    createPedals,
    seedFromConfig,
    PEDALS_ADDRESS,
    PEDALS_ENABLED_ADDRESS,
    PEDALS_LEARN_ADDRESS,
    PEDALS_FORGET_ADDRESS,
    FOOT_TAP_ADDRESS,
    FOOT_HOLD_ADDRESS,
    WAH_ENGAGE_ADDRESS,
    WAH_FREQ_ADDRESS
};
