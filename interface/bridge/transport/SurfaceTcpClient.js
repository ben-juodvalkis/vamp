/**
 * Surface TCP client — the bridge's end of the bridge↔surface stream.
 *
 * Why this exists
 * ---------------
 *
 * A darwin UDP datagram cannot exceed 9,216 bytes. `state/full` is
 * 389 KB on a realistic set, so it used to ship as ~99 chunks wrapped
 * in a `begin → chunk… → end` envelope, with an FNV-1a checksum so the
 * UI could tell a torn bundle from a whole one and a 453-line
 * reassembler to put it back together. Ordered, unbounded delivery
 * made all of that deletable, and protocol 3.6.0 deleted it: the tree
 * is one `state/full/tree` message now, and **this leg is the only
 * wire it has**. When no peer is connected the surface publishes
 * nothing and republishes on connect — so a dial-in here is what ends
 * the UI's tree-less window, not merely what speeds it up.
 *
 * Only this leg moves. The UI's connection model is untouched — the
 * bridge stays, because it owns TotalMix, the AX click handler, Save
 * As, four other OSC backends and a 378-line audio-decode route.
 * Between two of our own processes on loopback there is no reason to
 * pay for WebSocket framing either: a 4-byte length prefix is the
 * whole protocol.
 *
 * Wire format
 * -----------
 *
 *     [4-byte big-endian unsigned length][OSC message bytes]
 *
 * The payload is exactly what the surface's `osc_codec` already
 * produces, so this is a transport swap and not a codec change.
 *
 * Connection model
 * ----------------
 *
 * The surface listens; this dials. **Reconnect is the whole reason
 * this file is more than thirty lines.** UDP was connectionless, so a
 * Live restart was invisible to the bridge — the datagrams simply
 * resumed. TCP is connection-oriented, so a Live restart drops the
 * socket and something has to redial. That something must not give
 * up, must not spin, and must not let the UI notice: the UI's
 * WebSocket to the bridge is a separate connection that stays up
 * throughout, and a client that re-handshakes on its own schedule
 * repopulates the tree.
 *
 * Degrading is safe by construction: if this never connects, the
 * surface keeps emitting over UDP exactly as it always has.
 *
 * Outbound (ADR-489)
 * ------------------
 *
 * Every message the bridge sends the surface rides this leg while it is
 * connected — UI writes, the handshake hello, the server-presence
 * heartbeat, the swap and Group hops — through `SurfaceLink.js`, which
 * falls back to the UDP port only while this is down. The surface drains
 * its UDP socket from Live's pump, so a stalled tick plus a full buffer
 * dropped datagrams; a stream holds them in order until the pump runs.
 * `kick()` shortens the fallback window after a Live restart, and the
 * outbound cap keeps a hung Live from growing this process.
 */

const net = require('net');
const osc = require('osc');

const { logger, LogLevel } = require('../utils/logger');

/** Frame header: big-endian uint32 payload length. */
const HEADER_BYTES = 4;

/**
 * Refuse a frame claiming to be larger than this.
 *
 * Mirrors the surface's own ceiling. A corrupt length prefix would
 * otherwise have us buffer toward 4 GiB; the largest thing legitimately
 * sent is the pathological `state/full` at ~1.2 MB.
 */
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** Reconnect backoff, matching the UI's own curve in shape. */
const BASE_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 10_000;

/**
 * At most one kick-started dial a second (ADR-489). A kick comes from
 * every datagram the surface sends while this leg is down — meters
 * included — so without a floor a surface whose listener failed to
 * bind would be dialled dozens of times a second.
 */
const KICK_MIN_INTERVAL_MS = 1_000;

/**
 * Stop writing to a surface that has stopped reading (ADR-489).
 *
 * Every bridge→surface message rides this leg now, and Node buffers a
 * write the kernel will not take without limit. A Live that has hung
 * would otherwise grow the bridge toward an OOM and, if it ever came
 * back, replay minutes of stale fader writes at it. Past this many
 * bytes queued a frame is dropped and counted — the same fate a
 * datagram met in a full UDP receive buffer. A 12 s tick stall at
 * gesture rate queues tens of KB, so this is far from normal traffic.
 */
const MAX_PENDING_OUT_BYTES = 1024 * 1024;

/**
 * Create the surface TCP client.
 *
 * @param {Object} opts
 * @param {string} opts.host
 * @param {number} opts.port
 * @param {(msg: {address: string, args: unknown[]}) => void} opts.onMessage
 *        Called per decoded frame. Wire this to the same
 *        `handleIncomingOSC` the UDP leg uses, with the same `source`,
 *        so nothing downstream can tell which leg a message arrived on.
 * @param {(state: string, detail?: Object) => void} [opts.onStatus]
 * @param {number} [opts.maxPendingOutBytes] - test seam for the outbound cap
 * @returns {{ start(): void, stop(): void, kick(): boolean, send(address: string, args?: unknown[]): boolean, isConnected(): boolean, stats(): Object }}
 */
function createSurfaceTcpClient({ host, port, onMessage, onStatus, maxPendingOutBytes = MAX_PENDING_OUT_BYTES }) {
    /** @type {net.Socket|null} */
    let socket = null;
    /** The attempt in flight, so a kick never opens a second one. */
    /** @type {net.Socket|null} */
    let dialing = null;
    /** @type {NodeJS.Timeout|null} */
    let reconnectTimer = null;
    let attempts = 0;
    let stopped = false;
    let lastKickAt = 0;
    let inbox = Buffer.alloc(0);

    const stats = {
        connects: 0,
        disconnects: 0,
        framesIn: 0,
        framesOut: 0,
        bytesIn: 0,
        decodeErrors: 0,
        kicks: 0,
        droppedOut: 0,
        lastError: ''
    };

    function setStatus(state, detail) {
        if (onStatus) {
            try {
                onStatus(state, detail);
            } catch (e) {
                logger.warn('Surface TCP status callback threw', { error: e.message });
            }
        }
    }

    function scheduleReconnect(reason) {
        if (stopped || reconnectTimer) return;
        const delay = Math.min(
            BASE_RECONNECT_MS * Math.pow(2, attempts),
            MAX_RECONNECT_MS
        );
        attempts += 1;
        // Debug, not warn: a Live restart is a normal event and the
        // retry loop is expected to run for as long as Live is closed.
        // Logging each attempt at warn would fill bridge.log with
        // noise that says nothing except "Live is still not running".
        logger.debug('Surface TCP reconnect scheduled', { delayMs: delay, attempts, reason });
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, delay);
        // Never hold the process open on the retry timer alone.
        if (reconnectTimer.unref) reconnectTimer.unref();
    }

    function teardown(reason) {
        const dying = socket;
        socket = null;
        inbox = Buffer.alloc(0);
        if (dying) {
            stats.disconnects += 1;
            dying.removeAllListeners();
            dying.destroy();
            logger.info('Surface TCP disconnected', { reason });
            setStatus('disconnected', { reason });
        }
        scheduleReconnect(reason);
    }

    function connect() {
        if (stopped || socket || dialing) return;

        const pending = net.createConnection({ host, port });
        dialing = pending;
        // Bundles go out as a burst of frames; Nagle would sit on the
        // tail waiting for an ACK that only matters on a WAN.
        pending.setNoDelay(true);

        pending.on('connect', () => {
            if (dialing === pending) dialing = null;
            socket = pending;
            attempts = 0;
            stats.connects += 1;
            inbox = Buffer.alloc(0);
            logger.info('Surface TCP connected', { host, port });
            setStatus('connected', { host, port });
        });

        pending.on('data', (chunk) => {
            stats.bytesIn += chunk.length;
            inbox = inbox.length === 0 ? chunk : Buffer.concat([inbox, chunk]);
            drainFrames();
        });

        pending.on('error', (err) => {
            // ECONNREFUSED every retry while Live is closed is the
            // expected steady state, not an incident.
            stats.lastError = err.message;
            if (err.code !== 'ECONNREFUSED') {
                logger.warn('Surface TCP error', { error: err.message, code: err.code });
            }
            if (dialing === pending) dialing = null;
            if (socket === pending || socket === null) {
                socket = null;
                pending.removeAllListeners();
                pending.destroy();
                scheduleReconnect(err.code || 'error');
            }
        });

        pending.on('close', () => {
            if (dialing === pending) dialing = null;
            if (socket === pending) teardown('closed');
        });
    }

    function drainFrames() {
        for (;;) {
            if (inbox.length < HEADER_BYTES) return;
            const length = inbox.readUInt32BE(0);
            if (length > MAX_FRAME_BYTES) {
                // A stream cannot resynchronise past a corrupt length —
                // every subsequent offset is wrong too. Drop and redial.
                logger.error('Surface TCP frame over cap; dropping connection', {
                    length,
                    max: MAX_FRAME_BYTES
                });
                teardown('oversized frame');
                return;
            }
            if (inbox.length < HEADER_BYTES + length) return; // partial

            const payload = inbox.subarray(HEADER_BYTES, HEADER_BYTES + length);
            inbox = inbox.subarray(HEADER_BYTES + length);
            stats.framesIn += 1;

            let message;
            try {
                message = osc.readPacket(payload, { metadata: false });
            } catch (e) {
                // Unlike UDP, this is not a bad packet — framing already
                // guaranteed we have exactly the bytes the surface sent.
                // It means a codec disagreement, which is worth noticing
                // but is not a reason to tear down a stream still in sync.
                stats.decodeErrors += 1;
                stats.lastError = e.message;
                logger.warn('Surface TCP decode failed', { error: e.message, length });
                continue;
            }

            try {
                onMessage(message);
            } catch (e) {
                // One bad handler must not cost the frames behind it.
                logger.error('Surface TCP message handler threw', {
                    address: message && message.address,
                    error: e.message
                });
            }
        }
    }

    return {
        start() {
            stopped = false;
            connect();
        },

        stop() {
            stopped = true;
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            for (const dying of [socket, dialing]) {
                if (!dying) continue;
                dying.removeAllListeners();
                dying.destroy();
            }
            socket = null;
            dialing = null;
        },

        /**
         * Dial now if this leg is down and waiting out a backoff
         * (ADR-489). The orchestrator calls it on every datagram the
         * surface sends over UDP: a surface that is talking is a surface
         * whose listener is up, and every message sent before the redial
         * lands takes the UDP fallback. Without it a Live restart or set
         * load could leave writes on UDP for up to MAX_RECONNECT_MS after
         * the surface was back — exactly when a set load stalls its tick.
         * No-op while connected or dialling, and at most once a second.
         * Returns true when it started a dial.
         */
        kick() {
            if (stopped || socket || dialing || !reconnectTimer) return false;
            const now = Date.now();
            if (now - lastKickAt < KICK_MIN_INTERVAL_MS) return false;
            lastKickAt = now;
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
            stats.kicks += 1;
            logger.debug('Surface TCP redial kicked by surface traffic', { attempts });
            connect();
            return true;
        },

        /**
         * Send one OSC message over the stream.
         *
         * Returns false when there is no connection — the caller falls
         * back to UDP rather than queue, because a queued command
         * delivered after an unknown delay is worse than one that never
         * arrived. Also false for a frame dropped by the outbound cap or
         * an encode failure, both counted and logged here; a caller that
         * needs to tell those apart checks `isConnected()` first.
         */
        send(address, args = []) {
            if (!socket) return false;
            if (socket.writableLength > maxPendingOutBytes) {
                stats.droppedOut += 1;
                logger.rate(
                    'surface-tcp-backed-up',
                    LogLevel.WARN,
                    'Surface TCP backed up; dropping writes until it drains',
                    { pendingBytes: socket.writableLength, address }
                );
                return false;
            }
            try {
                const payload = Buffer.from(
                    osc.writePacket({ address, args }, { metadata: false })
                );
                const header = Buffer.alloc(HEADER_BYTES);
                header.writeUInt32BE(payload.length, 0);
                socket.write(Buffer.concat([header, payload]));
                stats.framesOut += 1;
                return true;
            } catch (e) {
                stats.lastError = e.message;
                logger.warn('Surface TCP send failed', { address, error: e.message });
                return false;
            }
        },

        isConnected() {
            return socket !== null;
        },

        stats() {
            return { ...stats, connected: socket !== null, pendingIn: inbox.length };
        }
    };
}

module.exports = {
    createSurfaceTcpClient,
    HEADER_BYTES,
    MAX_FRAME_BYTES,
    MAX_PENDING_OUT_BYTES
};
