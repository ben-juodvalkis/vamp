/**
 * RME TotalMix monitor link (ADR-423).
 *
 * The bridge owns the UDP conversation with the mixer. Everything on this
 * link speaks **dB** — TotalMix's Global OSC protocol takes and reports dB
 * floats, the Max for Live device drives `live.gain~` objects which are
 * dB-native, and the iPad store holds dB. Nothing here normalises; the only
 * place 0..1 exists is the UI's fader *rendering*, which owns that curve
 * (`interface/src/lib/utils/totalmixScale.ts`).
 *
 * Why the bridge and not the Max side: Global OSC has no read verb, so a
 * client that has just come up cannot ask the mixer anything — it can only be
 * told. This process outlives every one of them, so it caches the last dB per
 * channel and replays that the moment one says hello.
 *
 * That used to be argued as "Live tears the device down on every set load",
 * the `autoCaptureOverride.js` (ADR-405) argument. It no longer holds:
 * `b679e56` stripped the TotalMix chain out of `Track Key Controls.amxd` and
 * the hello now comes from `owner/Max Patches/Max Utility 1.0.maxpat`, a standalone
 * patch a set load does not touch. The cache is still right; only the reason
 * changed. It also filters the mixer's 811-address
 * state dump down to the five channels anyone cares about, keeping that burst
 * out of Live's process entirely.
 *
 * Protocol facts that shape this module, all measured against the hardware
 * rather than read off a spec (see ADR-423 §Measurements):
 *
 * - **An argument-less message is a WRITE of 1.0, not a query.** There is no
 *   read verb. Bootstrap comes from TotalMix's own "Send all data on start
 *   (enable)" dump, never from poking an address.
 * - **Writes are not echoed** ("Re-send received" is off), so a device-side
 *   echo loop is structurally impossible — the device's own write cannot come
 *   back and re-drive its fader.
 * - The mixer's fader floor is -65 dB; below that it reads -oo. A write at or
 *   under `minDb` is sent as `silenceDb` (-300) so the bottom of a fader is
 *   actually silent.
 */

/** Outbound write address (from the UI / device) → this prefix + channel. */
const WRITE_PREFIX = '/totalmix/';
/** Address the device announces itself on. */
const HELLO_ADDRESS = '/totalmix/hello';
/** Address levels are broadcast to WS clients and the device on. */
const BROADCAST_PREFIX = '/looping/v3/totalmix/';
/** Address the five live signal meters go to WS clients on, as one frame. */
const METERS_ADDRESS = '/looping/v3/totalmix_meters';

/**
 * `osc.totalmix` from constants.json, read when it is asked for and never
 * when this file is required. The bridge requires this module whatever its
 * `totalmix` switch says, and a config with the switch off carries no TotalMix
 * block at all (general-release audit §7b) — a read at require time took the
 * whole bridge down on exactly that config. The bridge passes its own copy of
 * the block; this default serves the tests.
 *
 * @returns {Object|undefined}
 */
function readTotalMixConfig() {
    return require('../../../config/constants.json').osc?.totalmix;
}

/** The three dB limits the clamp needs, out of one `osc.totalmix` block. */
function limitsOf(cfg) {
    return { minDb: cfg.minDb, maxDb: cfg.maxDb, silenceDb: cfg.silenceDb };
}

/**
 * Clamp a dB value to the mixer's usable range, mapping the bottom of the
 * fader to true silence.
 *
 * The clamp is the safety net the design leans on: this controls what a room
 * full of people hears, so a value that arrives wrong — a unit mix-up, a
 * device sending a raw parameter position — must land somewhere quiet rather
 * than at full scale.
 *
 * @param {number} db
 * @param {{minDb: number, maxDb: number, silenceDb: number}} [limits] the
 *   link's own; constants.json's when omitted
 * @returns {number|null} dB to send, or null when the input isn't a number
 */
function clampDb(db, limits = limitsOf(readTotalMixConfig())) {
    if (typeof db !== 'number' || !Number.isFinite(db)) return null;
    if (db <= limits.minDb) return limits.silenceDb;
    if (db > limits.maxDb) return limits.maxDb;
    return db;
}

/**
 * Parse the first OSC arg as a dB number.
 * @param {Array} args
 * @returns {number|null}
 */
function parseDb(args) {
    if (!Array.isArray(args) || args.length === 0) return null;
    const raw = args[0];
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (typeof raw === 'string') {
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

/**
 * @param {Object} [deps]
 * @param {{ info?: Function, warn?: Function, debug?: Function }} [deps.logger]
 * @param {Object} [deps.config] the `osc.totalmix` block; constants.json's
 *   when omitted
 */
function createTotalMixLink({ logger, config = readTotalMixConfig() } = {}) {
    // constants.json carries `_`-prefixed documentation keys alongside real
    // entries; strip them so a doc string can never be mistaken for a channel.
    const CHANNELS = Object.fromEntries(
        Object.entries(config.channels).filter(([key]) => !key.startsWith('_'))
    );
    const WRITABLE = new Set(config.writable);
    const LIMITS = limitsOf(config);

    /** Mixer address → channel name. Inverse of CHANNELS, built once. */
    const ADDRESS_TO_CHANNEL = new Map(
        Object.entries(CHANNELS).map(([channel, address]) => [address, channel])
    );

    /** @type {Map<string, number>} last dB heard per channel, this process's lifetime */
    const levels = new Map();

    // Live signal meters. The mixer sends one dB float per `/level/...`
    // address while that channel sounds and nothing while it is silent, so
    // each reading carries the time it arrived and a stale one reads as
    // silence. A stereo pair is two addresses; the channel shows the louder.
    const METERS = Object.fromEntries(
        Object.entries(config.meters || {}).filter(([key]) => !key.startsWith('_'))
    );
    const METER_ADDRESS_TO_CHANNEL = new Map(
        Object.entries(METERS).flatMap(([channel, addresses]) =>
            addresses.map((address) => [address, channel])
        )
    );
    const METER_STALE_MS = config.meterStaleMs ?? 300;
    /** @type {Map<string, {db: number, at: number}>} per meter address */
    const meterReadings = new Map();
    /** The last frame sent, so an unchanged one is not sent again. */
    let lastMeterFrame = null;

    return {
        HELLO_ADDRESS,
        WRITE_PREFIX,
        BROADCAST_PREFIX,
        METERS_ADDRESS,

        /** Channel names in a stable order, for replay and tests. */
        channels: () => Object.keys(CHANNELS),

        /** Last known dB for a channel, or undefined. */
        get: (channel) => levels.get(channel),

        /** Snapshot of every cached level. */
        snapshot: () => Object.fromEntries(levels),

        /**
         * Seed the cache from the startup bootstrap.
         *
         * Only fills channels that are still unknown, so a level that
         * arrived from the mixer while the bootstrap was in flight always
         * wins — the bootstrap reads a slower, 0.1 dB-resolution path, and a
         * real change event is both fresher and exact.
         *
         * @param {Object<string, number>} seed channel → dB
         * @returns {string[]} channels actually seeded
         */
        seed(seed) {
            const applied = [];
            for (const [channel, db] of Object.entries(seed || {})) {
                if (!(channel in CHANNELS)) continue;
                if (levels.has(channel)) continue;
                if (typeof db !== 'number' || !Number.isFinite(db)) continue;
                levels.set(channel, db);
                applied.push(channel);
            }
            return applied;
        },

        /**
         * Translate one inbound mixer message.
         *
         * Called for every packet arriving from TotalMix — including the full
         * state dump, which is ~811 addresses of which five matter. Returns
         * null for everything else so the caller drops it without a broadcast.
         *
         * @param {string} address mixer address, e.g. '/mix/pb/2/2/fader'
         * @param {Array} args
         * @returns {{ channel: string, db: number, address: string }|null}
         */
        fromMixer(address, args) {
            const channel = ADDRESS_TO_CHANNEL.get(address);
            if (!channel) return null;
            const db = parseDb(args);
            if (db === null) {
                logger?.warn?.('totalmix non-numeric level from mixer', { address, args });
                return null;
            }
            levels.set(channel, db);
            return { channel, db, address: BROADCAST_PREFIX + channel };
        },

        /**
         * Take one live-level message from the mixer, if it is one of the
         * meters a channel shows. Returns whether it was.
         *
         * @param {string} address e.g. '/level/pb/0'
         * @param {Array} args [db]
         * @param {number} now ms
         * @returns {boolean}
         */
        meterFromMixer(address, args, now) {
            if (!METER_ADDRESS_TO_CHANNEL.has(address)) return false;
            const db = parseDb(args);
            if (db !== null) meterReadings.set(address, { db, at: now });
            return true;
        },

        /**
         * The five channels' current meter levels, in `channels()` order, to
         * 0.1 dB — or null when nothing moved since the last frame returned,
         * so a silent mixer costs the iPad nothing. A channel with no reading
         * fresher than `meterStaleMs` is `silenceDb`.
         *
         * @param {number} now ms
         * @returns {number[]|null}
         */
        meterFrame(now) {
            const frame = Object.keys(CHANNELS).map((channel) => {
                let loudest = LIMITS.silenceDb;
                for (const address of METERS[channel] || []) {
                    const reading = meterReadings.get(address);
                    if (reading && now - reading.at <= METER_STALE_MS && reading.db > loudest) {
                        loudest = reading.db;
                    }
                }
                return Math.round(loudest * 10) / 10;
            });
            if (lastMeterFrame && frame.every((db, i) => db === lastMeterFrame[i])) return null;
            lastMeterFrame = frame;
            return frame;
        },

        /**
         * Translate one outbound write from the UI or the device.
         *
         * @param {string} address e.g. '/totalmix/click'
         * @param {Array} args [db]
         * @returns {{ channel: string, db: number, address: string }|null}
         *   null when the address isn't a writable channel or the value is junk
         */
        toMixer(address, args) {
            if (!address.startsWith(WRITE_PREFIX)) return null;
            const channel = address.slice(WRITE_PREFIX.length);
            if (!WRITABLE.has(channel)) {
                // `main` is deliberately read-only; anything else is a typo.
                logger?.warn?.('totalmix write to non-writable channel', { channel });
                return null;
            }
            const db = clampDb(parseDb(args), LIMITS);
            if (db === null) {
                logger?.warn?.('totalmix non-numeric write', { channel, args });
                return null;
            }
            // Cache the intent immediately. The mixer does not echo writes, so
            // without this the cache would go stale the moment anyone moves a
            // fader from the UI, and a device saying hello would be replayed a
            // level the room is no longer at.
            levels.set(channel, db);
            return { channel, db, address: CHANNELS[channel] };
        },

        /**
         * Everything a freshly-loaded device needs to adopt current state.
         *
         * The device holds no meaningful stored values — its faders come up at
         * whatever the set saved — so this is what makes them true. Channels
         * never heard from are omitted rather than guessed: a fader that stays
         * where it is beats one that jumps to a fiction.
         *
         * @returns {Array<{ address: string, db: number }>}
         */
        helloReplay() {
            return Object.keys(CHANNELS)
                .filter((channel) => levels.has(channel))
                .map((channel) => ({
                    address: BROADCAST_PREFIX + channel,
                    db: levels.get(channel)
                }));
        }
    };
}

module.exports = {
    createTotalMixLink,
    clampDb,
    parseDb,
    HELLO_ADDRESS,
    WRITE_PREFIX,
    BROADCAST_PREFIX,
    METERS_ADDRESS
};
