/**
 * Bridge Health Monitor
 *
 * Silent-when-healthy monitor for the three choke points where
 * "worked for 1 minute then broke" actually happens:
 *
 *   1. Inbound meter rate per source. If the Python Surface stops
 *      emitting /looping/v3 meter addresses while a client is
 *      connected, something died in MetersComponent (structural
 *      rebind missed, listeners wedged on dead track wrappers,
 *      UDP buffer stall).
 *
 *   2. Per-client WebSocket `bufferedAmount`. A growing buffer means
 *      the client (iPad Safari, typically) stopped draining — either
 *      the tab got suspended or the link-local route is flapping.
 *      Socket stays `ESTABLISHED` in lsof, so the only visible signal
 *      is the buffer.
 *
 *   3. Broadcast throw rate. If `client.send` starts throwing, frames
 *      are being dropped silently.
 *
 * Runs every `SNAPSHOT_INTERVAL_MS`. Emits to `bridge.log` at:
 *   - WARN once per anomaly onset (dedup keyed by anomaly kind + client)
 *   - WARN once per anomaly clear ("recovered")
 *   - INFO (console only) for the periodic snapshot when anything is
 *     anomalous; console-only so the healthy idle case stays silent
 *     in the persistent log.
 *
 * Thresholds are deliberately loose — the goal is "pipeline is dead
 * right now, and here's which segment," not perf profiling.
 */

const { logger } = require('./logger');

const SNAPSHOT_INTERVAL_MS = 10_000;

// If any client's send buffer grows past this, something's wrong.
// Typical healthy bufferedAmount is 0 or a few KB between ticks.
const BUFFER_WARN_BYTES = 256 * 1024;
const BUFFER_ERROR_BYTES = 1024 * 1024;

// If we have connected clients and meter traffic goes silent from a
// source for longer than this, raise a stall alert. Python Surface
// fires meters ~30 Hz per track, so ~5 seconds is ~150 dropped fires.
const METER_STALL_MS = 5_000;

// If the Python control-thread heartbeat (1 Hz from
// LoopingSurface._tick) stops arriving, the tick itself is wedged —
// distinct failure from "listener dispatch wedged but tick still
// runs." Threshold > heartbeat period so one skipped beat doesn't
// fire; 3s = 2 missed beats.
const HEARTBEAT_STALL_MS = 3_000;

// Addresses we treat as "meter" traffic for stall detection. Kept
// explicit so unrelated address changes don't silently re-define
// health.
const METER_ADDRESS_PREFIXES = [
    '/looping/v3/track/meter',
    '/looping/v3/master/meter'
];

const HEARTBEAT_ADDRESS = '/looping/v3/bridge/heartbeat';

function isMeterAddress(address) {
    if (!address) return false;
    for (let i = 0; i < METER_ADDRESS_PREFIXES.length; i++) {
        if (address.startsWith(METER_ADDRESS_PREFIXES[i])) return true;
    }
    return false;
}

function isHeartbeatAddress(address) {
    return address === HEARTBEAT_ADDRESS;
}

function createHealthMonitor({ wss, connectionStatus }) {
    // Per-source inbound counters. Keyed by source name
    // (`pythonSurface`, `loopingRecorder`, etc.) with
    // separate rollups for meter vs non-meter traffic.
    const inboundBySource = new Map();

    // Per-client state. Keyed by `clientId`. Values carry the active
    // anomaly set so we can log onset/clear edges, plus the latest
    // `bufferedAmount` sample for the snapshot.
    const clientState = new Map();

    // Active anomalies at the monitor level (not per-client). Keys
    // are short tags like `meter-stall:pythonSurface`.
    const activeAnomalies = new Set();

    // Global broadcast counters since last snapshot.
    let broadcastsOk = 0;
    let broadcastsFailed = 0;

    // Broadcast counters since the monitor started — used for a
    // one-shot "has this source ever emitted?" check at startup so
    // we don't fire a stall alert for a source that's legitimately
    // idle (e.g., M4L observer that no UI is subscribed to).
    function ensureSource(source) {
        let s = inboundBySource.get(source);
        if (!s) {
            s = {
                total: 0,
                meter: 0,
                nonMeter: 0,
                heartbeat: 0,
                lastMeterTs: 0,
                lastHeartbeatTs: 0,
                lastAnyTs: 0
            };
            inboundBySource.set(source, s);
        }
        return s;
    }

    function recordInbound(source, address) {
        const s = ensureSource(source);
        const now = Date.now();
        s.total += 1;
        s.lastAnyTs = now;
        if (isMeterAddress(address)) {
            s.meter += 1;
            s.lastMeterTs = now;
        } else if (isHeartbeatAddress(address)) {
            s.heartbeat += 1;
            s.lastHeartbeatTs = now;
            s.nonMeter += 1;
        } else {
            s.nonMeter += 1;
        }
    }

    function recordBroadcastResult(ok) {
        if (ok) broadcastsOk += 1;
        else broadcastsFailed += 1;
    }

    function onClientDisconnect(clientId) {
        const id = clientId || 'unknown';
        clientState.delete(id);
        // The per-client buffer check below only iterates LIVE clients, so a
        // client that disconnects while wedged never reaches its `clear()`
        // branch and its `ws-buffer:` tag stays in `activeAnomalies` forever.
        // That flips the monitor from silent-when-healthy to permanently
        // noisy after the first suspended iPad.
        clear(`ws-buffer:${id}`, { reason: 'client disconnected' });
    }

    // Anomaly edge helpers. Fire WARN on transition into anomaly,
    // WARN on transition out. De-dup by `tag` so a persistent anomaly
    // doesn't flood the log.
    function raise(tag, context) {
        if (activeAnomalies.has(tag)) return;
        activeAnomalies.add(tag);
        logger.warn(`Health anomaly: ${tag}`, context);
    }

    function clear(tag, context) {
        if (!activeAnomalies.has(tag)) return;
        activeAnomalies.delete(tag);
        logger.warn(`Health recovered: ${tag}`, context);
    }

    function snapshot() {
        const now = Date.now();
        const clients = Array.from(wss.clients);
        const hasClients = clients.length > 0;

        // --- per-client buffer pressure ---------------------------
        for (const client of clients) {
            const id = client.clientId || 'unknown';
            const buffered = client.bufferedAmount || 0;
            let st = clientState.get(id);
            if (!st) {
                st = { lastBuffered: 0 };
                clientState.set(id, st);
            }
            st.lastBuffered = buffered;

            const tag = `ws-buffer:${id}`;
            if (buffered >= BUFFER_ERROR_BYTES) {
                if (!activeAnomalies.has(tag)) {
                    activeAnomalies.add(tag);
                    logger.error(`Health anomaly: ${tag}`, {
                        bufferedBytes: buffered,
                        threshold: BUFFER_ERROR_BYTES,
                        hint: 'Client WS send buffer is growing — tab likely suspended or link flapping'
                    });
                }
            } else if (buffered >= BUFFER_WARN_BYTES) {
                raise(tag, { bufferedBytes: buffered, threshold: BUFFER_WARN_BYTES });
            } else {
                clear(tag, { bufferedBytes: buffered });
            }
        }

        // Prune state for clients that vanished without a close event —
        // and their anomaly tags with them, since no close event means
        // `onClientDisconnect` never ran either.
        const liveIds = new Set(clients.map(c => c.clientId || 'unknown'));
        for (const id of clientState.keys()) {
            if (!liveIds.has(id)) clientState.delete(id);
        }
        for (const tag of Array.from(activeAnomalies)) {
            if (!tag.startsWith('ws-buffer:')) continue;
            if (!liveIds.has(tag.slice('ws-buffer:'.length))) {
                clear(tag, { reason: 'client gone without close event' });
            }
        }

        // --- meter stall detection --------------------------------
        // Only meaningful if a client is actually consuming. If
        // nobody's connected, the Python Surface may throttle or
        // idle, so a stall wouldn't be actionable.
        for (const [source, s] of inboundBySource.entries()) {
            const meterTag = `meter-stall:${source}`;
            if (s.lastMeterTs > 0) {
                const sinceMeter = now - s.lastMeterTs;
                if (hasClients && sinceMeter > METER_STALL_MS) {
                    raise(meterTag, {
                        sinceLastMeterMs: sinceMeter,
                        threshold: METER_STALL_MS,
                        totalMeters: s.meter,
                        lastHeartbeatMs: s.lastHeartbeatTs ? now - s.lastHeartbeatTs : null,
                        hint: 'Meter emits stopped. If heartbeat still flowing, listener-dispatch is wedged; if heartbeat also stalled, tick is wedged.'
                    });
                } else {
                    clear(meterTag, { sinceLastMeterMs: sinceMeter });
                }
            }

            // Heartbeat stall is a distinct signal — only applies
            // to the Python surface source but keyed by source name
            // for consistency. Fires independently of client
            // presence: the surface emits unconditionally, so
            // silence always means "tick wedged."
            const hbTag = `tick-stall:${source}`;
            if (s.lastHeartbeatTs > 0) {
                const sinceHb = now - s.lastHeartbeatTs;
                if (sinceHb > HEARTBEAT_STALL_MS) {
                    raise(hbTag, {
                        sinceLastHeartbeatMs: sinceHb,
                        threshold: HEARTBEAT_STALL_MS,
                        totalHeartbeats: s.heartbeat,
                        hint: 'Python control-thread tick stopped firing. Check Log.txt for surface-side exceptions or GIL contention.'
                    });
                } else {
                    clear(hbTag, { sinceLastHeartbeatMs: sinceHb });
                }
            }
        }

        // --- broadcast throw rate ---------------------------------
        const sendTotal = broadcastsOk + broadcastsFailed;
        if (sendTotal > 0) {
            const failRate = broadcastsFailed / sendTotal;
            const tag = 'broadcast-failures';
            if (failRate > 0.05 && broadcastsFailed >= 5) {
                raise(tag, { failed: broadcastsFailed, ok: broadcastsOk, rate: failRate.toFixed(3) });
            } else {
                clear(tag, { failed: broadcastsFailed, ok: broadcastsOk });
            }
        }
        // Snapshot these BEFORE zeroing — the snapshot log below reads them,
        // and reading the live counters after the reset made every snapshot
        // report broadcastOk: 0 regardless of actual traffic.
        const broadcastOkThisWindow = broadcastsOk;
        const broadcastFailedThisWindow = broadcastsFailed;
        broadcastsOk = 0;
        broadcastsFailed = 0;

        // --- periodic snapshot (console only, INFO) ---------------
        // Only log the snapshot if there's anything anomalous or if
        // clients exist and we've seen traffic. Healthy idle stays
        // silent. This prevents the bridge console from scrolling
        // endlessly when nothing interesting is happening.
        if (activeAnomalies.size > 0 || (hasClients && sendTotal > 0)) {
            const sources = {};
            for (const [name, s] of inboundBySource.entries()) {
                sources[name] = {
                    meter: s.meter,
                    nonMeter: s.nonMeter,
                    sinceMeterMs: s.lastMeterTs ? now - s.lastMeterTs : null
                };
            }
            const clientsInfo = clients.map(c => ({
                id: c.clientId,
                buffered: c.bufferedAmount || 0,
                readyState: c.readyState
            }));
            logger.info('Health snapshot', {
                clients: clientsInfo,
                sources,
                broadcastOk: broadcastOkThisWindow,
                broadcastFailed: broadcastFailedThisWindow,
                anomalies: Array.from(activeAnomalies),
                connectionStatus
            });
        }
    }

    const timer = setInterval(snapshot, SNAPSHOT_INTERVAL_MS);
    if (timer.unref) timer.unref();

    return {
        recordInbound,
        recordBroadcastResult,
        onClientDisconnect,
        snapshot,  // exposed for tests
        _internals: { inboundBySource, clientState, activeAnomalies }
    };
}

module.exports = {
    createHealthMonitor,
    isMeterAddress,
    isHeartbeatAddress,
    HEARTBEAT_ADDRESS,
    SNAPSHOT_INTERVAL_MS,
    BUFFER_WARN_BYTES,
    BUFFER_ERROR_BYTES,
    METER_STALL_MS,
    HEARTBEAT_STALL_MS
};
