/**
 * WebSocket Server Manager
 *
 * Creates and manages the HTTP + WebSocket server for browser clients.
 * Handles connection lifecycle, message routing, and subscription management.
 *
 * CRITICAL CONSTRAINTS (see ADR-143):
 * - Port 8080 causes RSV1 protocol errors on macOS
 * - IPv6 dual-stack (::) causes frame corruption - must use IPv4 only (0.0.0.0)
 */

const http = require('http');
const WebSocket = require('ws');
const { logger, LogLevel } = require('../utils/logger');
const { getRoutingTarget } = require('../routing/messageRouter');
const { recordOutbound } = require('../utils/oscTap');
const bridgeProfiler = require('../utils/bridgeProfiler');
const { AUTO_CAPTURE_ADDRESS } = require('../handlers/autoCaptureOverride');
const {
    resolveWsSecret,
    computeProof,
    proofMatches,
    makeSalt
} = require('../utils/wsSecret');
const { originAllowed } = require('../utils/originCheck');

// --- WebSocket auth ------------------------------------------------------
//
// The bridge binds 0.0.0.0:8081, so without this anything on the LAN
// that knows the port can drive Live. See `utils/wsSecret.js` for what
// this does and does not defend against.

/** Server -> client: "prove you hold the secret against this salt." */
const AUTH_CHALLENGE_ADDRESS = '/bridge/auth/challenge';
/** Client -> server: HMAC-SHA256(secret, salt), hex. */
const AUTH_ADDRESS = '/bridge/auth';
/** Server -> client: the verdict, so the UI can show a real error. */
const AUTH_RESULT_ADDRESS = '/bridge/auth/result';

/**
 * The auth block, on unless it says `enabled: false`. A config with no
 * `auth` block, or one that can't be read, used to run with no gate at
 * all; now the gate is only ever off because someone wrote that down.
 */
function resolveAuthConfig(readAuth) {
    let auth;
    try {
        auth = readAuth();
    } catch (e) {
        logger.error('Could not read WS auth config; auth stays on', { error: e.message });
        auth = undefined;
    }
    const block = auth && typeof auth === 'object' ? auth : {};
    return { ...block, enabled: block.enabled !== false };
}

const authConfig = resolveAuthConfig(() => {
    const { loadConstants } = require('../utils/constants');
    return loadConstants().osc.webSocket.auth;
});

const authSaltBytes = authConfig.saltBytes || 16;
const authTimeoutMs = authConfig.timeoutMs || 5000;

// Resolved once at module load. A null secret means we cannot
// authenticate anybody, which is a configuration failure rather than a
// reason to silently drop the gate — so it is loud, and it fails OPEN
// rather than bricking a performance rig. That trade is deliberate and
// stated here so nobody has to infer it.
const { secret: authSecret, source: authSecretSource } = authConfig.enabled
    ? resolveWsSecret()
    : { secret: null, source: 'disabled' };

const authRequired = Boolean(authConfig.enabled && authSecret);

if (authConfig.enabled && !authSecret) {
    logger.error(
        'WebSocket auth is enabled but no secret could be established — '
        + 'running UNAUTHENTICATED so the rig still works. Fix the secret file.'
    );
} else if (authRequired) {
    logger.info('WebSocket auth enabled', { secretSource: authSecretSource });
} else {
    logger.warn('WebSocket auth disabled — 8081 accepts any LAN client');
}

/**
 * Verify a client's proof. Returns true if the client is now authed.
 *
 * Deliberately terse on failure: the client learns only that it failed,
 * never how close it got.
 */
function handleAuth(ws, message, context) {
    const auth = ws.loopingAuth;
    if (!auth || !auth.salt) return;
    const offered = Array.isArray(message.args) ? message.args[0] : null;
    const expected = computeProof(authSecret, auth.salt);

    if (proofMatches(expected, offered)) {
        auth.ok = true;
        // Burn the salt: a proof is good for exactly one connection, so
        // a replayed frame on a new socket cannot reuse it.
        auth.salt = null;
        logger.info('Client authenticated', { clientId: context.clientId });
        try {
            ws.send(JSON.stringify({
                address: AUTH_RESULT_ADDRESS, args: [1], source: 'bridge'
            }));
        } catch { /* client vanished mid-handshake */ }
        // After the verdict, never before it: the levels are set data, which
        // an unauthenticated client does not get (see broadcastToClients).
        replayTotalMixToClient(ws, context.totalmixLink, context.clientId);
        return;
    }

    logger.warn('Client failed authentication', { clientId: context.clientId });
    try {
        ws.send(JSON.stringify({
            address: AUTH_RESULT_ADDRESS, args: [0, 'bad-proof'], source: 'bridge'
        }));
        ws.close(4403, 'auth failed');
    } catch { /* already gone */ }
}

/**
 * Send one client every cached TotalMix level (ADR-423).
 *
 * The UI's level store starts empty on every load, and the mixer cannot be
 * asked for its levels (Global OSC has no read verb). Without this, a client
 * that connects after the startup bootstrap shows empty wells until a fader
 * moves. It is the same replay the device gets for `/totalmix/hello`, so
 * channels never heard from are omitted here too.
 *
 * No link, no replay: the parameter is optional, and the `features.totalmix`
 * switch (general-release audit §7c) is to pass null when TotalMix is off.
 */
function replayTotalMixToClient(ws, totalmixLink, clientId) {
    if (!totalmixLink) return;
    const replay = totalmixLink.helloReplay();
    for (const { address, db } of replay) {
        try {
            ws.send(JSON.stringify({ address, args: [db], source: 'bridge' }));
        } catch (err) {
            logger.error('Failed to replay TotalMix levels', { clientId, error: err.message });
            return;
        }
    }
    logger.debug('Replayed cached TotalMix levels', { clientId, cached: replay.length });
}

/**
 * Create and configure the WebSocket server
 * @param {Object} config - Configuration object
 * @param {number} config.port - WebSocket port
 * @param {string} config.host - Host to bind to
 * @param {Object} udpPorts - Map of UDP port instances
 * @param {Object} connectionStatus - Connection status object
 * @param {Object} metrics - Metrics object for tracking
 * @param {Object} [healthMonitor] - Health monitor instance
 * @param {Object} [captureOverride] - Bridge-lifetime auto_capture override
 *   memory (ADR-405); records every client write to the auto_capture set
 *   address so the orchestrator can replay it over a fresh surface's re-seed
 * @param {Object} [totalmixLink] - TotalMix monitor link (ADR-423); its cached
 *   levels are replayed to each client once the client is authenticated
 * @param {Object} [features] - the feature-switch registry (utils/features.js),
 *   whose snapshot each new client gets on connect as /bridge/features
 * @param {Object} [captureRecorder] - the recorder handler
 *   (handlers/captureRecorder.js), which hands the device its folder before a start
 * @returns {Object} { httpServer, wss }
 */
function createWebSocketServer(config, udpPorts, connectionStatus, metrics, healthMonitor, captureOverride, totalmixLink, axHelper = null, drumSwap = null, groupTracks = null, features = null, machine = null, captureRecorder = null) {

    // Launch mode ("dev" | "ipad"), announced to each client on connect via
    // /bridge/server_mode so WS clients (e.g. the menu-bar utility) can show
    // it — the UDP server-presence heartbeat carries `mode` to the surface
    // only. Defaults to "dev" if the caller didn't thread it through.
    const serverMode = config.serverMode || 'dev';

    // Create HTTP server first
    const httpServer = http.createServer((req, res) => {
        // Handle non-WebSocket HTTP requests (health check, etc.)
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', type: 'osc-bridge' }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`OSC Bridge WebSocket Server - Connect via ws://localhost:${config.port}\n`);
    });

    // Create WebSocket server attached to HTTP server (not standalone)
    const wss = new WebSocket.Server({
        server: httpServer,
        perMessageDeflate: false,
        // The control channel binds 0.0.0.0 and drives Live plus an osascript
        // AX click. An unauthenticated peer is already refused, but the frame
        // is buffered before auth can look at it, so a cap is the only thing
        // between the bridge and an OOM from one held socket. 64 KB is an
        // order of magnitude above the largest legitimate inbound frame
        // (a `/bridge/batch` of writes).
        maxPayload: 64 * 1024,
        // A page from another site gets a 403 before any challenge
        // (utils/originCheck.js).
        verifyClient: (info) => {
            if (originAllowed(info.origin)) return true;
            logger.warn('Refused a WebSocket from another origin', {
                origin: info.origin,
                remote: info.req.socket.remoteAddress
            });
            return false;
        }
    });

    logger.info('Creating HTTP+WebSocket server', {
        port: config.port,
        host: config.host,
        perMessageDeflate: false
    });

    // Start HTTP server
    httpServer.listen(config.port, config.host, () => {
        logger.info('HTTP+WebSocket server listening', {
            host: config.host,
            port: config.port,
            address: httpServer.address()
        });
    });

    httpServer.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            // Carrying on would leave a bridge with no WebSocket: every page
            // would sit disconnected with nothing to say why.
            logger.error(
                `Port ${config.port} is already in use, so the bridge cannot start. ` +
                `\`npm run cleanup\` stops a Vamp left running; \`lsof -i :${config.port}\` names anything else.`
            );
            process.exit(1);
        }
        logger.error('HTTP server error', { error: error.message });
    });

    wss.on('error', (error) => {
        logger.error('WebSocket SERVER error', { error: error.message });
    });

    wss.on('headers', (headers, request) => {
        logger.debug('WebSocket upgrade request', {
            remote: `${request.socket.remoteAddress}:${request.socket.remotePort}`,
            headers: headers.slice(0, 3).join(', ')
        });
    });

    wss.on('close', () => {
        logger.info('WebSocket server closed');
    });

    // Handle new connections
    wss.on('connection', (ws, request) => {
        handleConnection(ws, request, {
            udpPorts,
            connectionStatus,
            metrics,
            wss,
            healthMonitor,
            serverMode,
            captureOverride,
            totalmixLink,
            axHelper,
            drumSwap,
            groupTracks,
            features,
            machine,
            captureRecorder
        });
    });

    return { httpServer, wss };
}

/**
 * Handle a new WebSocket connection
 * @param {WebSocket} ws - WebSocket instance
 * @param {http.IncomingMessage} request - HTTP request
 * @param {Object} context - Context object with dependencies
 */
function handleConnection(ws, request, context) {
    const { udpPorts, connectionStatus, metrics, wss, healthMonitor, serverMode, captureOverride, totalmixLink, axHelper, drumSwap, groupTracks, features, machine, captureRecorder } = context;

    // Generate unique client ID
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    ws.clientId = clientId;

    logger.info('Browser client connected', {
        clientId,
        url: request.url,
        remote: `${request.socket.remoteAddress}:${request.socket.remotePort}`,
        state: ws.readyState,
        protocol: ws.protocol || 'none',
        extensions: ws.extensions || 'none'
    });

    // Add error handler per-socket - CRITICAL for catching protocol errors
    ws.on('error', (error) => {
        // Handle WebSocket protocol errors gracefully
        if (error.code === 'WS_ERR_INVALID_OPCODE') {
            logger.warn('WebSocket protocol error: Invalid frame received', {
                clientId,
                hint: 'This may indicate non-WebSocket data on port 8080 or client compatibility issue'
            });
            try {
                ws.terminate(); // Force close - don't try to send close frame
            } catch (e) {
                // Ignore termination errors
            }
            return;
        }

        if (error.code === 'ECONNRESET') {
            logger.debug('Client connection reset (normal browser navigation)', { clientId });
            return;
        }

        logger.error('WebSocket client error', { clientId, error: error.message, code: error.code || 'none' });
    });

    // --- auth gate -------------------------------------------------------
    //
    // The server speaks first: a random per-connection salt. The client
    // must answer with HMAC-SHA256(secret, salt); the secret itself
    // never crosses the wire, so capturing the exchange yields nothing
    // reusable — the salt is fresh per connection.
    //
    // Everything below this point still runs for an unauthenticated
    // client, because connection_status and server_mode are what the UI
    // needs to *render* a disconnected state. What an unauthenticated
    // client cannot do is send commands (`dispatchClientMessage` refuses
    // them) or receive broadcasts (`broadcastToClients` skips it).
    ws.loopingAuth = { required: authRequired, ok: !authRequired, salt: null };
    if (authRequired) {
        ws.loopingAuth.salt = makeSalt(authSaltBytes);
        try {
            ws.send(JSON.stringify({
                address: AUTH_CHALLENGE_ADDRESS,
                args: [ws.loopingAuth.salt],
                timestamp: Date.now(),
                source: 'bridge'
            }));
        } catch (err) {
            logger.error('Failed to send auth challenge', { clientId, error: err.message });
        }
        // A socket that connects and never authenticates would otherwise
        // sit forever holding a slot.
        const timer = setTimeout(() => {
            if (ws.loopingAuth && !ws.loopingAuth.ok) {
                logger.warn('Closing client that never authenticated', { clientId });
                try { ws.close(4401, 'auth timeout'); } catch { /* already gone */ }
            }
        }, authTimeoutMs);
        if (timer.unref) timer.unref();
        ws.on('close', () => clearTimeout(timer));
    }

    // Send connection status to new client
    try {
        ws.send(JSON.stringify({
            address: '/bridge/connection_status',
            args: [connectionStatus.pythonSurface],
            clientId: clientId,
            timestamp: Date.now(),
            source: 'bridge'
        }));
        logger.debug('Initial connection status sent', { clientId });
    } catch (err) {
        logger.error('Failed to send initial message', { clientId, error: err.message });
    }

    // Announce launch mode ("dev" | "ipad") to the new client. Mode is fixed
    // for the bridge's lifetime, so this one-shot per connection is enough;
    // the periodic /bridge/server_mode beacon is belt-and-suspenders.
    try {
        ws.send(JSON.stringify({
            address: '/bridge/server_mode',
            args: [serverMode || 'dev'],
            clientId: clientId,
            timestamp: Date.now(),
            source: 'bridge'
        }));
    } catch (err) {
        logger.error('Failed to send server_mode', { clientId, error: err.message });
    }

    // The AX helper's state (ADR-439), so a client that just connected knows
    // at once whether AX-driven controls can work; changes and the 5 s beacon
    // follow on the broadcast path.
    if (axHelper) {
        try {
            const { state, detail } = axHelper.state;
            ws.send(JSON.stringify({
                address: '/bridge/ax_helper',
                args: [state, detail],
                clientId: clientId,
                timestamp: Date.now(),
                source: 'bridge'
            }));
        } catch (err) {
            logger.error('Failed to send ax_helper state', { clientId, error: err.message });
        }
    }

    // The feature switches (general-release audit §7b), so a client knows
    // before its first paint what to hide and what to grey out. Sent ahead of
    // auth like everything above: which subsystems are on is what the UI
    // needs to lay itself out, and it says nothing about the set.
    if (features) {
        try {
            ws.send(JSON.stringify({
                address: features.FEATURES_ADDRESS,
                args: features.wireArgs(),
                clientId: clientId,
                timestamp: Date.now(),
                source: 'bridge'
            }));
        } catch (err) {
            logger.error('Failed to send features', { clientId, error: err.message });
        }
    }
    // The machine's values (onboarding.plan.md §6.5): the library paths a
    // recorded preset is read against, the FX tiles' preset folder, the
    // Max devices folder, the TotalMix range. Nothing about the Mac is in
    // the build, so a client needs these before its first load.
    if (machine) {
        try {
            ws.send(JSON.stringify({
                address: machine.MACHINE_ADDRESS,
                args: machine.wireArgs(),
                clientId: clientId,
                timestamp: Date.now(),
                source: 'bridge'
            }));
        } catch (err) {
            logger.error('Failed to send machine values', { clientId, error: err.message });
        }
    }

    // The cached TotalMix levels go only to a client that may see set data.
    // With the gate on, that is nobody yet: handleAuth sends them once the
    // proof lands. With it off, every client starts authenticated, so here.
    if (ws.loopingAuth.ok) replayTotalMixToClient(ws, totalmixLink, clientId);

    ws.on('message', (data) => {
        handleMessage(ws, data, {
            clientId,
            udpPorts,
            metrics,
            healthMonitor,
            captureOverride,
            totalmixLink,
            axHelper,
            drumSwap,
            groupTracks,
            // Hands the recorder its folder ahead of a /capture/start.
            captureRecorder
        });
    });

    ws.on('close', () => {
        logger.info('Browser client disconnected', { clientId: ws.clientId });
        healthMonitor?.onClientDisconnect(ws.clientId);
    });
}

// --- per-message-type handlers ---------------------------------------------

// Client-reported health event. Emitted by the browser-side
// clientWatchdog on tab visibility changes, rAF stalls, and socket
// reconnects. WARN-level so it lands in bridge.log alongside
// server-side anomalies, giving one file that answers "what broke,
// and on which side."
function handleClientLog(_ws, message, context) {
    const [level, event, detail] = message.args || [];
    const line = `Client log [${level || 'info'}]: ${event || 'unspecified'}`;
    const ctx = { clientId: context.clientId, detail: detail ?? null };
    if (level === 'error') logger.error(line, ctx);
    else logger.warn(line, ctx);
}

// UI-only Clip View "Reverse" button (ADR-368: no LOM equivalent exists).
// The AX helper presses it (ADR-439) — by description inside Clip Detail,
// from Live's main window, no activation. Acks [1], or [0, code, detail]
// with a named error: ax-helper-down, ax-untrusted, ax-no-main-window,
// ax-control-missing (no audio clip in Clip View), ax-control-disabled.
// readyState guards: the client may have gone while the press ran, and
// ws.send() on a closed socket throws (PR-411 review).
function handleClipReverseCmd(ws, _message, context) {
    const ack = (args) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ address: '/cmd/clip/reverse/ack', args }));
        }
    };
    if (!context.axHelper) {
        ack([0, 'ax-helper-down', 'the bridge has no AX helper client']);
        return;
    }
    context.axHelper.request('press', { target: 'clip.reverse' })
        .then(() => ack([1]))
        .catch((err) => {
            logger.warn('Clip reverse press failed', { code: err.code, detail: err.detail || err.message });
            ack([0, err.code || 'ax-action-failed', err.detail || String(err.message || err)]);
        });
}

// Similar-sound swap on a Drum Rack kit or one pad (ADR-439). The
// orchestrator (handlers/drumSwapSimilar.js) runs its three hops — surface,
// AX helper, surface — and replies to this client alone on
// /looping/v3/drum/swap_similar/reply [requestId, ok, code, detail, resultJson].
function handleDrumSwapSimilarCmd(ws, message, context) {
    if (context.drumSwap) {
        context.drumSwap.handleClientRequest(ws, message, WebSocket.OPEN);
        return;
    }
    const [requestId] = message.args || [];
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            address: '/looping/v3/drum/swap_similar/reply',
            args: [String(requestId ?? ''), 0, 'ax-helper-down', 'the bridge has no swap orchestrator', '']
        }));
    }
}

// UI-only "Group" button: Live's LOM cannot group tracks at all, so this
// drives Live's real Accessibility surface directly — a real click to build
// the selection, a real ⌘G to commit it, no menu ever shown
// (handlers/liveGroupTracks.js). The hold-and-tap gesture itself is entirely
// UI-side (`groupGestureStore`, no wire calls while tracks are being tapped);
// this one address fires once, when the gesture ends, carrying the whole
// member list. Replies `[requestId, ok, code, detail]` on `/reply`.
function handleTrackGroupCmd(ws, message, context) {
    if (context.groupTracks) {
        context.groupTracks.handleGroup(ws, message, WebSocket.OPEN);
        return;
    }
    const [requestId] = message.args || [];
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            address: '/looping/v3/track/group/reply',
            args: [String(requestId ?? ''), 0, 'ax-helper-down', 'the bridge has no group orchestrator']
        }));
    }
}

// Envelope address for a coalesced multi-message frame. The UI's
// `WebSocketConnection.send` accumulates every write issued in one
// event-loop turn and ships them as one of these; the bridge uses the
// same address and shape for its own Surf→UI batching
// (`utils/broadcastBatcher.js`), so there is one envelope grammar
// rather than two. `source` distinguishes the directions.
const BATCH_ADDRESS = '/bridge/batch';

/**
 * Unpack a coalesced frame and dispatch each inner message.
 *
 * **Every item is isolated.** A malformed address or a handler that
 * throws must cost exactly that one message — a shared try/catch here
 * would let the first bad item silently discard the rest of the
 * batch, which is a much worse failure than the original one-frame
 * -per-message behaviour and is precisely the bug ableton-js #142 had
 * to go back and fix in its own loop.
 */
function handleBatch(ws, message, context) {
    const messages = Array.isArray(message.messages) ? message.messages : null;
    if (!messages) {
        logger.warn('Batch frame with no messages array', {
            clientId: context.clientId
        });
        return;
    }
    for (const inner of messages) {
        if (!inner || typeof inner !== 'object') {
            logger.warn('Skipping non-object batch item', {
                clientId: context.clientId
            });
            continue;
        }
        if (inner.address === BATCH_ADDRESS) {
            // Nothing legitimately nests envelopes, and honouring it
            // would hand a client unbounded recursion on our stack.
            logger.warn('Skipping nested batch envelope', {
                clientId: context.clientId
            });
            continue;
        }
        dispatchClientMessage(ws, inner, context);
    }
}

// A capture start: the device first hears which folder an unsaved set
// records into (`/capture/folder`, handlers/captureRecorder.js), then the
// start itself, on the same socket so in that order.
function handleCaptureStartCmd(_ws, message, context) {
    context.captureRecorder?.sendProjectFolder();
    routeMessageToUDP(
        message, context.udpPorts, context.metrics, context.captureOverride
    );
}

// Address-keyed handlers (exact-match): control-plane messages that
// don't go through the subscription/route flow.
const ADDRESS_HANDLERS = {
    '/capture/start':     handleCaptureStartCmd,
    '/capture/arm':       handleCaptureStartCmd,
    '/bridge/client_log': handleClientLog,
    '/cmd/clip/reverse':  handleClipReverseCmd,
    '/looping/v3/drum/swap_similar': handleDrumSwapSimilarCmd,
    '/looping/v3/track/group': handleTrackGroupCmd,
    [BATCH_ADDRESS]:      handleBatch
};

/**
 * Dispatch one already-parsed client message.
 *
 * Split out from `handleMessage` so `handleBatch` can reuse the exact
 * same routing for each inner message — batched and unbatched
 * messages must not be able to drift apart. Catches per message, so a
 * throw costs one message rather than the frame it arrived in.
 *
 * @param {WebSocket} ws
 * @param {Object} message - `{address, args, argsTypes}`
 * @param {Object} context
 */
function dispatchClientMessage(ws, message, context) {
    try {
        // The auth frame is the one thing an unauthenticated client may
        // send. Checked before the handler table so it cannot be gated
        // by the very check it exists to satisfy.
        if (message.address === AUTH_ADDRESS) {
            handleAuth(ws, message, context);
            return;
        }

        // Everything else needs a proven client. Refusing here rather
        // than at the socket means a client that authenticates late
        // simply starts working, with no reconnect needed.
        if (ws && ws.loopingAuth && !ws.loopingAuth.ok) {
            logger.warn('Refusing message from unauthenticated client', {
                clientId: context.clientId,
                address: message && message.address
            });
            return;
        }

        const addressHandler = message.address && ADDRESS_HANDLERS[message.address];
        if (addressHandler) {
            addressHandler(ws, message, context);
            return;
        }

        // Everything else is an ordinary OSC message → route to UDP backend.
        // There is no longer a `type`-keyed branch: the only two entries were
        // `subscribe`/`unsubscribe`, and nothing on the wire sends a `type`
        // field — every UI and menubar frame is `{address, args, argsTypes}`.
        routeMessageToUDP(
            message, context.udpPorts, context.metrics, context.captureOverride
        );
    } catch (e) {
        logger.error('Error dispatching client message', {
            clientId: context.clientId,
            address: message?.address,
            type: message?.type,
            error: e.toString()
        });
    }
}

/**
 * Handle an incoming WebSocket message
 * @param {WebSocket} ws - WebSocket instance
 * @param {Buffer} data - Message data
 * @param {Object} context - Context with dependencies
 */
function handleMessage(ws, data, context) {
    let message;
    try {
        message = JSON.parse(data);
    } catch (e) {
        logger.error('Invalid JSON from client', {
            error: e.toString(), rawData: data.toString().substring(0, 200)
        });
        return;
    }

    dispatchClientMessage(ws, message, context);
}

// Display labels for the per-target debug log line; falls back to the
// raw target name. Only used for log output — actual routing is just
// `udpPorts[target].send(...)`.
const TARGET_LABELS = {
    pythonSurface:   'Python Control Surface',
    loopingRecorder: 'looping-recorder'
};

/**
 * Route a message to the appropriate UDP port
 * @param {Object} message - Parsed message object
 * @param {Object} udpPorts - Map of UDP port instances
 * @param {Object} metrics - Metrics object
 * @param {Object} [captureOverride] - auto_capture override memory (ADR-405)
 */
function routeMessageToUDP(message, udpPorts, metrics, captureOverride) {
    const routingTarget = message.address ? getRoutingTarget(message.address) : 'none';

    // Remember the last client-written auto_capture value for this bridge
    // run (ADR-405) — the orchestrator replays it if a rebuilt surface
    // re-seeds the toggle over the user's choice after a set load.
    if (captureOverride && message.address === AUTO_CAPTURE_ADDRESS) {
        captureOverride.recordClientWrite(message.args || []);
    }
    logger.debug('WebSocket message received', {
        address: message.address,
        args: message.args,
        routingTarget
    });

    // Fixture-capture tap (no-op unless OSC_TAP_FILE is set).
    recordOutbound(routingTarget, message);

    // Per-address rate roll-up (no-op unless BRIDGE_PROFILE=1).
    bridgeProfiler.recordOutbound(routingTarget, message);

    // Check for null/undefined in args.
    //
    // Rate-rolled, not a plain warn: this sits on the routing hot path and
    // `logger.warn` writes with a blocking `appendFileSync` (deliberately —
    // see logger.js on why it is synchronous). One malformed sender emitting
    // at gesture or meter rate would therefore put a synchronous disk write
    // between every message and its UDP port. `logger.rate` emits the first
    // occurrence immediately and rolls the rest into a periodic count, which
    // is the behaviour this call always wanted; it was written before
    // `logger.rate` existed and never revisited.
    if (message.args?.some(arg => arg === null || arg === undefined)) {
        logger.rate(
            `null-args:${message.address}`,
            LogLevel.WARN,
            'Message contains null/undefined args',
            { address: message.address, args: message.args }
        );
    }

    const port = udpPorts[routingTarget];
    if (!port) {
        logger.warn('No route found for address', { address: message.address, routingTarget });
        metrics.routingErrors++;
        return;
    }

    logger.debug(`Routing to ${TARGET_LABELS[routingTarget] || routingTarget}`, {
        address: message.address, args: message.args
    });

    port.send({
        address: message.address,
        args: encodeOutboundArgs(message.args || [], message.argsTypes)
    });
}

/**
 * Convert WS-wire args to osc.js argument form, rebuilding blobs.
 *
 * Scalars pass through (osc.js infers int/float/string). A binary arg
 * arrives JSON-serialised as `{type:'Buffer', data:[...]}` and flagged
 * `'blob'` in `argsTypes` (see WebSocketConnection.buildWireMessage) —
 * `JSON.stringify` can't carry a Uint8Array, so we rebuild a real
 * Buffer here and hand osc.js an explicit `{type:'b', value}` so it
 * encodes a proper OSC blob (`b`) the Python surface reads as bytes.
 * Without this the surface receives a stringified object and the
 * note-edit / blob handlers reject (this was the M4 add-notes bug).
 * @param {Array} args
 * @param {Array} [argsTypes]
 * @returns {Array}
 */
function encodeOutboundArgs(args, argsTypes) {
    if (!Array.isArray(args)) return [];
    return args.map((value, i) => {
        const tag = Array.isArray(argsTypes) ? argsTypes[i] : undefined;
        if (tag === 'blob' || isBufferShape(value)) {
            return { type: 'b', value: toNodeBuffer(value) };
        }
        // Honor the client's `number` hint: an integer-valued JS number must
        // reach the surface as an OSC int (`i`), not a float. Left untagged,
        // osc.js infers *every* JS number as a float (`f`) — so a bare `0`/`1`
        // arrives as `0.0`/`1.0` and the surface's strict bool01 parser
        // rejects it (e.g. SessionSettings toggles from the menu-bar app).
        // Fractional numbers stay float. Non-`number` tags pass through so
        // osc.js keeps inferring string/etc.
        if (tag === 'number' && typeof value === 'number' && Number.isInteger(value)) {
            return { type: 'i', value };
        }
        return value;
    });
}

/** True for the `{type:'Buffer', data:[...]}` JSON shape. */
function isBufferShape(v) {
    return v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data);
}

/** Coerce a wire-blob value to a Node Buffer (osc.js blob `value`). */
function toNodeBuffer(v) {
    if (Buffer.isBuffer(v)) return v;
    if (isBufferShape(v)) return Buffer.from(v.data);
    if (v instanceof Uint8Array) return Buffer.from(v);
    if (Array.isArray(v)) return Buffer.from(v);
    // Integer-keyed object fallback ({"0":255,...}) — defensive, in case
    // a sender mangles a Uint8Array without the blob tag.
    if (v && typeof v === 'object') {
        const keys = Object.keys(v).filter((k) => /^\d+$/.test(k));
        if (keys.length) {
            const bytes = new Array(keys.length);
            for (const k of keys) bytes[Number(k)] = v[k];
            return Buffer.from(bytes);
        }
    }
    return Buffer.alloc(0);
}


/**
 * Broadcast a message to all connected WebSocket clients
 * @param {WebSocket.Server} wss - WebSocket server instance
 * @param {Object} message - Message to broadcast
 * @param {Object} [healthMonitor] - Optional health monitor for tracking send success/failure
 */
function broadcastToClients(wss, message, healthMonitor) {
    // Only log for non-meter messages to avoid spam. NOTE the batcher:
    // a multi-message window arrives here as `/bridge/batch`, which does not
    // match, so meter suppression only holds for a single-message window —
    // under LOG_LEVEL=DEBUG the batched frames still log. Guarded on the
    // level as well so the `Array.from(...).filter(...)` census, which only
    // ever fed this one suppressed line, is not built per broadcast.
    const isMeterMessage = message.address?.includes('meter');
    if (!isMeterMessage && logger.shouldLog(LogLevel.DEBUG)) {
        const clientCount = wss.clients.size;
        const openClients = Array.from(wss.clients).filter(client => client.readyState === WebSocket.OPEN).length;
        logger.debug('Broadcasting to clients', { openClients, clientCount, address: message.address });
    }

    // One serialization for the whole fan-out. It used to run inside the
    // per-client loop, so an N-client broadcast stringified the same message
    // N times.
    const payload = JSON.stringify(message);

    wss.clients.forEach(client => {
        // An unauthenticated client sees nothing. Refusing its commands
        // alone would still leak the whole Live Set to anything that
        // opened a socket, which is half the hole and the half that
        // needs no credentials to exploit.
        if (client.loopingAuth && !client.loopingAuth.ok) return;
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(payload);
                healthMonitor?.recordBroadcastResult(true);
            } catch (error) {
                logger.error('Error sending to client', { error: error.message });
                healthMonitor?.recordBroadcastResult(false);
            }
        }
    });
}

module.exports = {
    createWebSocketServer,
    broadcastToClients,
    // Internals reached only by tests. `routeMessageToUDP` carries the
    // TotalMix write path, whose fan-out is invisible from the outside — the
    // mixer never echoes a write, so a missing relay fails silently rather
    // than erroring (ADR-423).
    AUTH_ADDRESS,
    AUTH_CHALLENGE_ADDRESS,
    AUTH_RESULT_ADDRESS,
    __testing: {
        routeMessageToUDP, handleMessage, dispatchClientMessage, handleBatch,
        handleAuth, isAuthRequired: () => authRequired, resolveAuthConfig,
        expectedProofFor: (salt) => computeProof(authSecret, salt)
    }
};
