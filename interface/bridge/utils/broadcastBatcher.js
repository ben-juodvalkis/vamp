/**
 * Broadcast Batcher — coalesces Surf→UI WebSocket frames.
 *
 * See ADR-386 for the full rationale, wire contract, and testing scheme.
 *
 * The bridge fans out one WS frame per OSC message per client. On a
 * 30 Hz meter pulse across 8 tracks + master + sundry param echoes,
 * that's ~10 separate `JSON.stringify` + `client.send` per ~33 ms
 * window per client. This batcher accumulates messages in a short
 * (default 10 ms) window and emits one envelope per window:
 *
 *     { address: '/bridge/batch', messages: [...], source: 'bridge' }
 *
 * The client unpacks the envelope and re-dispatches each inner
 * message. Order is preserved (FIFO queue, single drain).
 *
 * Single-item windows skip the envelope and ship the raw message —
 * matches Knobbler v59's tweak ("sending single-item batches as raw
 * OSC messages, skipping the /batch wrapper overhead"). The latency
 * floor is the same either way (one window's wait), but the bytes
 * and parse cost drop to the unbatched baseline.
 *
 * Direction: Surf→UI only. UI→Surf writes (param/set, etc.) go
 * straight to UDP through `routeMessageToUDP` and never touch this
 * batcher — adding window latency to click input would be a
 * regression. The batcher sits inside `broadcastToClients`'s call
 * path and only affects frames that fan out to WebSocket clients.
 *
 * Env knobs:
 *   BRIDGE_BATCH_WINDOW_MS  default 10. Set to 0 to disable batching
 *                           entirely (every enqueue flushes synchronously,
 *                           preserving the old one-frame-per-message behavior).
 *
 * Lifecycle: the orchestrator calls `flush()` from SIGINT/SIGTERM so
 * the last window's pending messages reach the wire before the
 * sockets close.
 */

const { logger } = require('./logger');

function readWindowMs() {
    const raw = process.env.BRIDGE_BATCH_WINDOW_MS;
    if (raw === undefined || raw === '') return 10;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) {
        logger.warn('Invalid BRIDGE_BATCH_WINDOW_MS — falling back to 10ms', { raw });
        return 10;
    }
    return n;
}

/**
 * Create a broadcast batcher.
 *
 * @param {Object} opts
 * @param {(message: Object) => void} opts.send  Underlying send-to-all
 *        primitive. Receives either a raw OSC-shaped message (single-item
 *        window) or a `/bridge/batch` envelope.
 * @param {number} [opts.windowMs]  Override the env-driven default.
 * @returns {{ enqueue(message: Object): void, flush(): void, isBatching(): boolean }}
 */
function createBroadcastBatcher({ send, windowMs }) {
    const effectiveWindowMs = windowMs !== undefined ? windowMs : readWindowMs();
    const batchingEnabled = effectiveWindowMs > 0;

    /** @type {Object[]} */
    let queue = [];
    /** @type {ReturnType<typeof setTimeout>|null} */
    let timer = null;

    function flushNow() {
        const activeTimer = timer;
        timer = null;
        if (activeTimer) clearTimeout(activeTimer);
        if (queue.length === 0) return;
        const drained = queue;
        queue = [];
        if (drained.length === 1) {
            // Single-item passthrough — no envelope overhead.
            send(drained[0]);
            return;
        }
        send({
            address: '/bridge/batch',
            messages: drained,
            source: 'bridge'
        });
    }

    /** @param {Object} message */
    function enqueue(message) {
        if (!batchingEnabled) {
            send(message);
            return;
        }
        queue.push(message);
        if (!timer) {
            timer = setTimeout(flushNow, effectiveWindowMs);
            // Don't keep the event loop alive on this timer alone —
            // SIGINT/SIGTERM flushes explicitly before close.
            if (timer.unref) timer.unref();
        }
    }

    if (batchingEnabled) {
        logger.info('Broadcast batcher enabled', { windowMs: effectiveWindowMs });
    } else {
        logger.info('Broadcast batcher disabled (BRIDGE_BATCH_WINDOW_MS=0)');
    }

    return {
        enqueue,
        flush: flushNow,
        isBatching: () => batchingEnabled
    };
}

module.exports = { createBroadcastBatcher };
