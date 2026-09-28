/**
 * Bridge Profiler — per-address message-rate roll-ups for the bridge.
 *
 * Counts every OSC message the bridge handles, separated into inbound
 * (UDP source → WebSocket fan-out) and outbound (WebSocket client →
 * UDP target). Once per ``BRIDGE_PROFILE_WINDOW_MS`` (default 1000 ms)
 * a JSON record per address is appended to the dump file:
 *
 *   {
 *     ts: <epoch ms at window close>,
 *     windowMs: 1000,
 *     wsClients: <count of OPEN ws clients at window close>,
 *     inbound: {
 *       "<source>:<address>": {
 *         count, bytes, fanout, p50Ms, p99Ms, maxMs
 *       }, ...
 *     },
 *     outbound: {
 *       "<target>:<address>": { count, bytes }, ...
 *     }
 *   }
 *
 * ``fanout`` is summed `count * wsOpenAtRecord`, so the integrated
 * downstream cost is visible (not just message count).
 *
 * Off by default. Enabled with:
 *
 *     BRIDGE_PROFILE=1 npm run dev
 *
 * Optional ``BRIDGE_PROFILE_FILE`` overrides the default
 * ``logs/bridge-profile.ndjson``. Optional ``BRIDGE_PROFILE_WINDOW_MS``
 * overrides the 1000 ms roll-up window.
 *
 * Zero-overhead when disabled — both ``recordInbound`` and
 * ``recordOutbound`` short-circuit on the first line if no stream is
 * attached.
 *
 * Why a separate module from oscTap.js: tap captures every full
 * record (NDJSON of every message) for fixture replay; profiler
 * captures aggregates for perf analysis. Different cardinality, same
 * env-gate idiom.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const enabled = process.env.BRIDGE_PROFILE === '1' || process.env.BRIDGE_PROFILE === 'true';
const rawFile = process.env.BRIDGE_PROFILE_FILE;
const windowMs = parseInt(process.env.BRIDGE_PROFILE_WINDOW_MS || '1000', 10);

const dumpPath = enabled
    ? (rawFile
        ? (path.isAbsolute(rawFile) ? rawFile : path.resolve(REPO_ROOT, rawFile))
        : path.resolve(REPO_ROOT, 'logs', 'bridge-profile.ndjson'))
    : null;

let stream = null;
let timer = null;
let getWsClientCount = () => 0;

if (enabled && dumpPath) {
    try {
        fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
        stream = fs.createWriteStream(dumpPath, { flags: 'a' });
        stream.on('error', (err) => {
            logger.error('Bridge profiler stream error — disabling', { path: dumpPath, error: err.message });
            stream = null;
            if (timer) { clearInterval(timer); timer = null; }
        });
        logger.info('Bridge profiler enabled', { path: dumpPath, windowMs });
    } catch (err) {
        logger.error('Failed to open bridge profiler file — disabled', { path: dumpPath, error: err.message });
        stream = null;
    }
}

/**
 * @typedef {Object} InboundBucket
 * @property {number} count
 * @property {number} bytes
 * @property {number} fanout  cumulative count*wsClientsAtRecord
 */

/** @type {Map<string, InboundBucket>} */
let inboundCounters = new Map();
/** @type {Map<string, {count: number, bytes: number}>} */
let outboundCounters = new Map();

function approxBytes(message) {
    if (!message) return 0;
    let b = (message.address && message.address.length) || 0;
    const args = message.args || [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (typeof a === 'string') b += a.length;
        else if (typeof a === 'number') b += 8;
        else if (typeof a === 'boolean') b += 1;
        else if (a && typeof a === 'object' && 'value' in a) {
            // typed OSC arg shape from convertToTypedOSCArgs
            const v = a.value;
            if (typeof v === 'string') b += v.length;
            else b += 8;
        }
    }
    return b;
}

function bucketKey(target, address) {
    return target + ':' + (address || '<no-address>');
}

function recordInbound(source, message) {
    if (!stream || !message) return;
    const key = bucketKey(source, message.address);
    let bucket = inboundCounters.get(key);
    if (!bucket) {
        bucket = { count: 0, bytes: 0, fanout: 0 };
        inboundCounters.set(key, bucket);
    }
    bucket.count += 1;
    bucket.bytes += approxBytes(message);
    bucket.fanout += getWsClientCount();
}

function recordOutbound(target, message) {
    if (!stream || !message) return;
    const key = bucketKey(target, message.address);
    let bucket = outboundCounters.get(key);
    if (!bucket) {
        bucket = { count: 0, bytes: 0 };
        outboundCounters.set(key, bucket);
    }
    bucket.count += 1;
    bucket.bytes += approxBytes(message);
}

function snapshot() {
    if (!stream) return null;
    const inbound = {};
    for (const [k, v] of inboundCounters) inbound[k] = v;
    const outbound = {};
    for (const [k, v] of outboundCounters) outbound[k] = v;
    return {
        ts: Date.now(),
        windowMs,
        wsClients: getWsClientCount(),
        inbound,
        outbound
    };
}

function flush() {
    if (!stream) return;
    if (inboundCounters.size === 0 && outboundCounters.size === 0) return;
    try {
        stream.write(JSON.stringify(snapshot()) + '\n');
    } catch (err) {
        logger.error('Bridge profiler write failed', { error: err.message });
    }
    inboundCounters = new Map();
    outboundCounters = new Map();
}

function start({ wsClientCount }) {
    if (!stream || timer) return;
    if (typeof wsClientCount === 'function') getWsClientCount = wsClientCount;
    timer = setInterval(flush, windowMs);
    if (timer.unref) timer.unref();
}

function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    flush();
    if (stream) {
        try {
            stream.end();
        } catch (err) {
            // Stream might already be closed/destroyed; debug-level
            // since this fires during shutdown and isn't actionable.
            logger.debug('Bridge profiler stream.end() failed during stop', {
                error: err && err.message,
            });
        }
        stream = null;
    }
}

function isEnabled() {
    return stream !== null;
}

module.exports = {
    recordInbound,
    recordOutbound,
    snapshot,
    flush,
    start,
    stop,
    isEnabled
};
