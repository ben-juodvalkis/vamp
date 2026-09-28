/**
 * One-shot startup bootstrap for the TotalMix level cache (ADR-423).
 *
 * Global OSC has **no read verb**. Its only state dump fires when TotalMix
 * enables a remote controller — TotalMix's startup, not this bridge's — and
 * an argument-less message, the usual OSC convention for a query, is a WRITE
 * of 1.0 in that protocol. So a bridge starting after TotalMix (the normal
 * case, since TotalMix runs continuously and the bridge starts with
 * `npm run dev`) has no way to learn current levels and would sit with an
 * empty cache until somebody physically touched a fader.
 *
 * The legacy TouchOSC-emulation protocol on remote controller 1 *does*
 * answer: assert a bus row and the mixer dumps that row's eight strips
 * unprompted. That is the read machinery ADR-423 removed from the Utility
 * patch — and it is worth being precise about why reviving it here is not a
 * regression. In the patch it ran **continuously**, driving dials, with no
 * request/reply correlation, so a knob turn mid-read made one channel adopt
 * another's level. Here it runs **once**, serialized, before anything is
 * cached, in a process that holds no dials and can clobber nothing. The
 * failure mode is an empty cache, which leaves the device's gates shut and
 * no write reaching hardware.
 *
 * Two safety properties worth stating:
 *
 * - **Names are checked, not just slots.** The legacy bank window is never
 *   pinned, so "slot 2 of the output row" can silently be a different
 *   channel than it was yesterday. Every read asserts the strip's
 *   `trackname` matches what we measured; a mismatch skips that channel
 *   rather than seeding a wrong monitor level.
 * - **dB comes from the mixer's own text.** The dump carries
 *   `/1/volume<n>Val` strings ("-19.2 dB", "-oo") alongside the normalised
 *   fader position, so this never has to model RME's fader taper. Cost is
 *   0.1 dB of resolution on the seed — an order of magnitude below audible,
 *   and replaced by an exact value the first time the fader moves.
 *
 * The socket is bound for well under a second and then closed, so port 7001
 * is not contended for the rest of the run.
 */

const dgram = require('dgram');
const osc = require('osc');

/**
 * constants.json, loaded when a bootstrap runs rather than when this file is
 * required: the bridge requires it whatever its `totalmix` switch says, and a
 * config with that switch off carries no TotalMix blocks at all (general-
 * release audit §7b). The bridge passes its own blocks; this serves the tests.
 */
const loadConstants = () => require('../../../config/constants.json');

/**
 * channel → { bus, slot, expectName }, minus the `_`-prefixed doc keys.
 *
 * @param {Object} [legacy] the `osc.totalmixLegacy` block
 */
function legacyReads(legacy = loadConstants().osc.totalmixLegacy) {
    return Object.fromEntries(
        Object.entries(legacy.reads).filter(([key]) => !key.startsWith('_'))
    );
}

/**
 * Parse one of the mixer's own dB strings.
 *
 * The mixer writes silence as `-oo`, which becomes the Global OSC protocol's
 * -300 so the seeded value is in the same units as everything downstream.
 *
 * @param {string} text e.g. "-19.2 dB", "0.0 dB", "-oo"
 * @param {number} [silenceDb] `osc.totalmix.silenceDb`
 * @returns {number|null} dB, or null when the string isn't one
 */
function parseDbString(text, silenceDb = loadConstants().osc.totalmix.silenceDb) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (trimmed === '-oo' || trimmed === '-∞') return silenceDb;
    const match = /^(-?\d+(?:\.\d+)?)\s*dB$/i.exec(trimmed);
    if (!match) return null;
    const db = Number(match[1]);
    return Number.isFinite(db) ? db : null;
}

/** Flatten an OSC packet (TotalMix wraps everything in bundles). */
function collect(packet, into) {
    if (packet.packets) {
        for (const p of packet.packets) collect(p, into);
        return;
    }
    into.set(packet.address, (packet.args || []).map((a) => (a && typeof a === 'object' && 'value' in a ? a.value : a)));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read current monitor levels off the legacy protocol, once.
 *
 * Never throws: every failure path resolves to whatever was read so far
 * (possibly nothing). An empty result is a safe outcome, not an error — it
 * simply means the device's gates stay closed until a fader moves.
 *
 * @param {Object} [deps]
 * @param {{info?: Function, warn?: Function, debug?: Function}} [deps.logger]
 * @param {Object} [deps.legacy] the `osc.totalmixLegacy` block
 * @param {number} [deps.silenceDb] `osc.totalmix.silenceDb`
 * @param {() => void} [deps.onReply] called once, when the mixer first
 *   answers at all. A strip-name mismatch still counts: TotalMix is there,
 *   it is only the bank window that moved.
 * @returns {Promise<Object<string, number>>} channel → dB, partial allowed
 */
async function bootstrapFromLegacy({
    logger,
    legacy = loadConstants().osc.totalmixLegacy,
    silenceDb = loadConstants().osc.totalmix.silenceDb,
    onReply
} = {}) {
    const found = {};
    let rx;

    try {
        rx = await bindOrNull(legacy.localPort);
    } catch {
        rx = null;
    }
    if (!rx) {
        // Something else holds 7001 — most likely the old Utility patch is
        // still running. Not fatal: the cache fills on the first fader move.
        logger?.warn?.('TotalMix bootstrap: port busy, skipping', { port: legacy.localPort });
        return found;
    }

    const state = new Map();
    let answered = false;
    rx.on('message', (buf) => {
        try {
            collect(osc.readPacket(buf, { metadata: true }), state);
        } catch {
            /* not OSC we understand — ignore */
            return;
        }
        if (!answered) {
            answered = true;
            onReply?.();
        }
    });

    const tx = dgram.createSocket('udp4');
    const send = (address, value) =>
        new Promise((resolve) => {
            const buf = Buffer.from(
                osc.writePacket({ address, args: [{ type: 'f', value }] }, { metadata: true })
            );
            tx.send(buf, legacy.remotePort, legacy.host, () => resolve());
        });

    try {
        // Group the reads by bus row so each row is provoked once.
        const byBus = new Map();
        for (const [channel, spec] of Object.entries(legacyReads(legacy))) {
            if (!byBus.has(spec.bus)) byBus.set(spec.bus, []);
            byBus.get(spec.bus).push({ channel, ...spec });
        }

        /** Channels whose bus row provoked no dump at all. */
        const unanswered = [];

        for (const [bus, specs] of byBus) {
            state.clear();
            await send('/setSubmix', legacy.submix);
            await sleep(legacy.settleMs);
            await send(bus, 1);
            await sleep(legacy.dumpWaitMs);

            if (state.size === 0) {
                // Nothing came back for this row. Reported once, below:
                // checked per channel it read as five "strip name mismatch"
                // lines every start on a Mac with no mixer, blaming the bank
                // window for a TotalMix that is not there.
                unanswered.push(...specs.map(({ channel }) => channel));
                continue;
            }

            for (const { channel, slot, expectName } of specs) {
                const name = state.get(`/1/trackname${slot}`)?.[0];
                if (name !== expectName) {
                    // The bank window moved, or the mixer is configured
                    // differently than when this was measured. Seeding here
                    // would point a monitor fader at the wrong strip.
                    logger?.warn?.('TotalMix bootstrap: strip name mismatch, skipping', {
                        channel, slot, expected: expectName, actual: name ?? null
                    });
                    continue;
                }
                const db = parseDbString(state.get(`/1/volume${slot}Val`)?.[0], silenceDb);
                if (db === null) {
                    logger?.warn?.('TotalMix bootstrap: unreadable level, skipping', { channel, slot });
                    continue;
                }
                found[channel] = db;
            }
        }

        if (unanswered.length > 0) {
            logger?.warn?.(
                answered
                    ? 'TotalMix bootstrap: no dump for some bus rows, skipping'
                    : 'TotalMix bootstrap: no answer on controller 1 — is TotalMix FX running, with OSC on?',
                { channels: unanswered, port: legacy.localPort }
            );
        }
    } catch (err) {
        logger?.warn?.('TotalMix bootstrap failed midway; keeping partial result', {
            error: err?.message, got: Object.keys(found)
        });
    } finally {
        try { tx.close(); } catch { /* already closed */ }
        try { rx.close(); } catch { /* already closed */ }
    }

    return found;
}

/**
 * Bind a UDP socket, resolving to null rather than throwing when the port is
 * taken. A busy 7001 is an expected condition, not an exception.
 */
function bindOrNull(port) {
    return new Promise((resolve) => {
        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: false });
        const onError = () => { try { sock.close(); } catch { /* noop */ } resolve(null); };
        sock.once('error', onError);
        sock.bind(port, () => {
            sock.removeListener('error', onError);
            resolve(sock);
        });
    });
}

module.exports = { bootstrapFromLegacy, parseDbString, legacyReads };
