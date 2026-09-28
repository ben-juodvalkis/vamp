/**
 * WebSocket-OSC Bridge for the Python Control Surface
 *
 * Main orchestrator that coordinates:
 * - UDP ports for OSC communication with various backends
 * - WebSocket server for browser clients
 * - Message routing between all endpoints
 * - Service discovery via Bonjour/mDNS
 *
 * Routes messages between:
 * - Python Control Surface (primary backend for Live)
 * - MIDI Converter (pitch/mod wheel)
 * - TotalMix mixer and its Max device (ADR-423), while `features.totalmix`
 *   is on (general-release audit §7b; utils/features.js)
 * - looping-recorder capture device
 *
 * The Max observer (liveAPI-v6.js), the Omnisphere/NI preset servers and
 * the shell helper were removed 2026-09-23 (general-release audit Tier 0):
 * nothing was left on the other end of any of them.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { Bonjour } = require('bonjour-service');
const { logger } = require('./utils/logger');

// Import modular components
const { createUDPPorts, setupAllPortHandlers, openAllPorts, closeAllPorts } = require('./transport/UDPPortManager');
const { createWebSocketServer, broadcastToClients } = require('./transport/WebSocketServer');
const { createSurfaceTcpClient } = require('./transport/SurfaceTcpClient');
const { processIncomingMessage } = require('./utils/oscMessageUtils');
const { recordInbound } = require('./utils/oscTap');
const { createHealthMonitor } = require('./utils/healthMonitor');
const bridgeProfiler = require('./utils/bridgeProfiler');
const { createBroadcastBatcher } = require('./utils/broadcastBatcher');

// Log module resolution paths for debugging
logger.debug('Module Resolution', {
    ws: require.resolve('ws'),
    wsVersion: require('ws/package.json').version
});

// Try to create Bonjour service, but don't crash if it fails
let bonjour = null;
try {
    bonjour = new Bonjour(undefined, (err) => {
        logger.warn('Bonjour/mDNS error (non-fatal)', { error: err.message });
    });
} catch (error) {
    logger.warn('Bonjour service unavailable (service discovery disabled)', { error: error.message });
}

// The config, with this Mac's constants.local.json laid over it.
const { loadConstants } = require('./utils/constants');
const constants = loadConstants();

// Launch mode set by the npm script (dev:bridge → "dev",
// dev:bridge:ipad → "ipad"). Stamped onto the server-presence
// heartbeat and used to gate the ipad-only save-as automation.
// Defaults to "dev" so a bare `node enhanced-osc-bridge.js` (or any
// launcher that forgets the env var) never fires ipad-only behaviors.
const SERVER_MODE = process.env.LOOPING_SERVER_MODE || 'dev';

// Save-As keystroke automation (ipad-only). Popped when the Python
// surface reports a transport stop while `npm run ipad` is running.
const { saveAsCurrentSet } = require('./handlers/liveSaveAs');

// Bridge-lifetime auto_capture override memory (ADR-405). Live rebuilds the
// surface on every set load and the fresh surface re-seeds auto_capture from
// the launch mode, wiping any user override within ~2s. The bridge remembers
// the last client write and replays it over a conflicting surface emit, so an
// override survives set loads / Live restarts and resets only when this
// process (the dev/ipad script) restarts.
const { AUTO_CAPTURE_ADDRESS, createAutoCaptureOverride } = require('./handlers/autoCaptureOverride');
const autoCaptureOverride = createAutoCaptureOverride({ logger });

const { createAxHelperClient, AX_READY } = require('./transport/AxHelperClient');

// Feature switches (general-release audit §7b): one per bespoke subsystem,
// read once, here, from `constants.features`. A switch that is missing is
// OFF. Clients hear the snapshot as /bridge/features — on connect, on every
// change and with the 5 s ping — and hide what is off, grey what is on but
// not there. `utils/features.js` lists the switches wired so far.
const { createFeatureRegistry, FEATURES_ADDRESS } = require('./utils/features');
// The machine's values (library paths, the TotalMix range), read once here
// and told to clients over /bridge/machine beside the features, so an iPad
// build compiles nothing about this Mac in (onboarding.plan.md §3).
const { createMachineRegistry, MACHINE_ADDRESS } = require('./utils/machine');
const features = createFeatureRegistry(constants, { logger });
const machine = createMachineRegistry(constants);

// Looping AX Helper (ADR-439): the one process trusted with macOS
// Accessibility, installed by `npm run install-ax-helper`. Trust belongs to
// the launcher, so the bridge never touches AX itself — it dials the helper's
// socket, and Reverse / Group / Save As / similar-sound swaps work whichever
// terminal started this process. Its state rides the presence channel as
// /bridge/ax_helper [state, detail].
//
// The owner's, behind `features.axHelper` (general-release plan.md §4). Off,
// there is no client at all: the bridge dials nothing and sends no
// /bridge/ax_helper, the UI draws none of those controls, and a stray Reverse,
// Group or swap request is answered `ax-helper-down` by the WS server. On, the
// feature is available while the helper is ready, and greyed out with the
// reason while it is not.
const AX_REASONS = {
    'ax-helper-down': 'AX helper not running',
    'ax-untrusted': 'AX helper needs Accessibility'
};
const axHelper = features.isEnabled('axHelper') ? createAxHelperClient(constants, { logger }).start() : null;
if (axHelper) {
    const reportAxAvailability = ({ state }) => features.setAvailability(
        'axHelper', state === AX_READY, AX_REASONS[state] || 'AX helper not ready'
    );
    reportAxAvailability(axHelper.state);
    axHelper.on('state', reportAxAvailability);
}

// RME TotalMix monitor link (ADR-423). The bridge owns the UDP conversation
// with the mixer and caches the last dB per channel for this process's
// lifetime, so a Max for Live device rebuilt by a set load can adopt current
// levels the moment it says hello. Same lifetime argument as auto_capture
// above; the mixer has no read verb, so this cache is the only answer to
// "what are the levels right now?".
//
// Null while the `totalmix` feature is off: then the bridge binds none of
// its ports, runs no bootstrap, logs nothing about a mixer, and reads no
// TotalMix config — a general edition's constants need no TotalMix block.
const { createTotalMixLink } = require('./handlers/totalmixLink');
const totalmixLink = createTotalMixLinkIfEnabled();

// Startup bootstrap for that cache. Global OSC cannot be asked for current
// state, so the legacy protocol on remote controller 1 is read once, here,
// and the socket closed again — see handlers/totalmixBootstrap.js for why
// reviving that read path is safe in this position and was not in the patch.
const { bootstrapFromLegacy } = require('./handlers/totalmixBootstrap');

/**
 * The TotalMix link, when the `totalmix` switch is on and its config is
 * complete; null otherwise.
 *
 * Switched on with a block missing is a misconfiguration, not a reason to
 * die: that crash is what the switch exists to retire (audit §2, "deleting
 * the config blocks crashes the bridge"). It logs which block, and clients
 * see the feature on but unavailable, saying why.
 */
function createTotalMixLinkIfEnabled() {
    if (!features.isEnabled('totalmix')) return null;
    const blocks = constants.osc || {};
    const missing = ['totalmix', 'totalmixDevice', 'totalmixLegacy'].filter((key) => !blocks[key]);
    if (missing.length > 0) {
        logger.error('TotalMix is switched on but its config is incomplete; the link stays down', {
            missing: missing.map((key) => `osc.${key}`)
        });
        features.setAvailability('totalmix', false, 'TotalMix config missing');
        return null;
    }
    // Unavailable until the mixer answers: the startup bootstrap below, or
    // any packet on the Global OSC port.
    features.setAvailability('totalmix', false, 'Waiting for TotalMix');
    return createTotalMixLink({ logger, config: blocks.totalmix });
}

logger.info('Starting WebSocket-OSC Bridge for Python Control Surface');
// Also emitted at WARN so the startup marker lands in the log file
// (which only captures WARN/ERROR), making restarts visible there.
logger.warn('Bridge process starting', { pid: process.pid });

// ============================================
// Configuration
// ============================================

// The Max Utility patch is the owner's (Move, piano-pedal looper). The bridge
// cannot see it — its one packet toward the bridge is the TotalMix device's
// hello — so switched on reads as there, as it always did.
if (features.isEnabled('maxUtilityPatch')) features.setAvailability('maxUtilityPatch', true);
// The expression pedal reaches the surface as MIDI on its own Input, which the
// bridge never sees; switched on reads as there, like the Max patch.
if (features.isEnabled('expressionPedal')) features.setAvailability('expressionPedal', true);
// The menu-bar app is launched by the start scripts and is only ever a client;
// switched on reads as there, like the Max patch.
if (features.isEnabled('menubar')) features.setAvailability('menubar', true);

const OSC_CONFIG = {
    pythonSurface: {
        localPort: constants.osc.pythonSurface.localPort,
        remotePort: constants.osc.pythonSurface.remotePort,
        host: constants.osc.pythonSurface.host
    },
    loopingRecorder: {
        localPort: constants.osc.loopingRecorder.localPort,
        remotePort: constants.osc.loopingRecorder.remotePort,
        host: constants.osc.loopingRecorder.host
    },
    // The TotalMix pair only exists with the link: an endpoint left out of
    // this object is never constructed by UDPPortManager, so never bound.
    ...(totalmixLink && {
        totalmix: {
            localPort: constants.osc.totalmix.localPort,
            remotePort: constants.osc.totalmix.remotePort,
            host: constants.osc.totalmix.host
        },
        totalmixDevice: {
            localPort: constants.osc.totalmixDevice.localPort,
            remotePort: constants.osc.totalmixDevice.remotePort,
            host: constants.osc.totalmixDevice.host
        }
    }),
    webSocket: {
        port: constants.osc.webSocket.port,
        host: constants.osc.webSocket.host
    }
};

// ============================================
// State
// ============================================

const connectionStatus = {
    pythonSurface: 'unknown'
};

const metrics = {
    totalMessages: 0,
    routingErrors: 0,
    startTime: Date.now()
};

// ============================================
// Initialize Components
// ============================================

// Create UDP ports
const udpPorts = createUDPPorts(OSC_CONFIG);

// Set up port handlers
setupAllPortHandlers(udpPorts, OSC_CONFIG, connectionStatus);

// Create WebSocket server. The health monitor is created first with
// a lazy `wss` accessor so both can reference each other without a
// circular init.
let wssRef = null;
const healthMonitor = createHealthMonitor({
    wss: { get clients() { return wssRef ? wssRef.clients : new Set(); } },
    connectionStatus
});

// The capture recorder behind REC (handlers/captureRecorder.js). Not a switch:
// every edition has it. Available while the device on Return A says hello;
// before each start it is told which folder an unsaved set records into.
const { createCaptureRecorder } = require('./handlers/captureRecorder');
const captureRecorder = createCaptureRecorder({
    features,
    logger,
    recordingsDir: (constants.paths || {}).liveRecordingsDir,
    sendToDevice: (msg) => udpPorts.loopingRecorder?.send(msg)
});

// Similar-sound swap (ADR-439 phase 3). The bridge orchestrates every hop: the
// surface runs on Live's main thread, which is where an AX press is serviced,
// so it must never wait on the helper itself. The surface's two swap replies
// are consumed in the pythonSurface middleware below and never reach the UI.
// Null while `features.axHelper` is off: the WS server answers a stray request
// `ax-helper-down` (handleDrumSwapSimilarCmd).
const { createDrumSwapSimilar } = require('./handlers/drumSwapSimilar');
const drumSwap = !features.isEnabled('axHelper') ? null : createDrumSwapSimilar({
    axHelper,
    logger,
    // The helper's own AXUIElementSetMessagingTimeout, from the config rather
    // than a hand-copied 15. It is sent as a per-request `timeoutS`, which
    // `verbs.py::_timeout` lets win over `axHelper.messagingTimeoutS`, so a
    // literal here silently made that knob do nothing for swaps — and the
    // bridge's own ceiling is derived from it (`pressTimeoutS + 5` s), so a
    // raised constant with a literal here made the bridge give up, run its
    // `finally` and close Live's undo step while the helper was still pressing.
    pressTimeoutS: (constants.axHelper || {}).messagingTimeoutS,
    sendToSurface: (address, args) => {
        const port = udpPorts.pythonSurface;
        if (!port) throw new Error('python surface port is not open');
        // Explicit tags: osc.js sends a bare JS number as a float, and the
        // surface reads a note as an int.
        port.send({
            address,
            args: args.map((value) => (typeof value === 'number'
                ? { type: Number.isInteger(value) ? 'i' : 'f', value }
                : { type: 's', value: String(value) }))
        });
    }
});

// "Group" on the iPad: Live's LOM cannot group tracks, so this drives Live's
// real Accessibility surface directly -- a hold-and-tap gesture built from
// real clicks and a real (menu-free) ⌘G, all through the AX helper. Same
// division of labour as the swap above -- the helper owns Live's UI, and
// only the bridge ever waits on it. Null while `features.axHelper` is off, like
// the swap above.
const { createLiveGroupTracks } = require('./handlers/liveGroupTracks');
const groupTracks = !features.isEnabled('axHelper') ? null : createLiveGroupTracks({
    axHelper,
    logger,
    // Lets a reposition (a non-contiguous new group, or a drag into an
    // existing one) borrow the record button for a moment when record_mode
    // would otherwise block it (RecordSuspendComponent, the surface half).
    // Same tagging discipline as the swap orchestrator's sendToSurface.
    sendToSurface: (address, args) => {
        const port = udpPorts.pythonSurface;
        if (!port) throw new Error('python surface port is not open');
        port.send({
            address,
            args: args.map((value) => (typeof value === 'number'
                ? { type: Number.isInteger(value) ? 'i' : 'f', value }
                : { type: 's', value: String(value) }))
        });
    }
});

const { httpServer, wss } = createWebSocketServer(
    // Thread the launch mode through so the WS server can announce it to
    // each client on connect (see /bridge/server_mode). Merged, not mutated,
    // so the shared constants object stays untouched.
    { ...OSC_CONFIG.webSocket, serverMode: SERVER_MODE },
    udpPorts,
    connectionStatus,
    metrics,
    healthMonitor,
    autoCaptureOverride,
    totalmixLink,
    axHelper,
    drumSwap,
    groupTracks,
    features,
    machine,
    captureRecorder);
wssRef = wss;

// Surf→UI broadcast batcher. Wraps the per-client fan-out so a burst
// of OSC frames lands as one WS frame per client. Window is
// BRIDGE_BATCH_WINDOW_MS (default 10 ms). Single-item windows skip
// the /bridge/batch envelope; client side disassembles in
// WebSocketConnection. UI→Surf writes never touch this — they go
// straight to UDP via routeMessageToUDP.
const broadcastBatcher = createBroadcastBatcher({
    send: (message) => broadcastToClients(wss, message, healthMonitor)
});

// Every AX helper state change (ready / ax-untrusted / ax-helper-down) goes
// out the moment it happens; the 5 s ping beacon below repeats it. None while
// the axHelper switch is off.
axHelper?.on('state', ({ state, detail }) => {
    broadcastBatcher.enqueue({ address: '/bridge/ax_helper', args: [state, detail], source: 'bridge' });
});

// Same for the feature switches: a feature turning available (the mixer
// answered) goes out at once, and the ping beacon repeats the snapshot.
features.on('change', () => {
    broadcastBatcher.enqueue({ address: FEATURES_ADDRESS, args: features.wireArgs(), source: 'bridge' });
});

// ============================================
// UDP Message Handlers
// ============================================

// Helper to process and broadcast messages
function handleIncomingOSC(oscMessage, source) {
    // Fixture-capture tap (no-op unless OSC_TAP_FILE is set).
    recordInbound(source, oscMessage);

    // Per-address rate roll-up (no-op unless BRIDGE_PROFILE=1).
    bridgeProfiler.recordInbound(source, oscMessage);

    // Health monitor: counts inbound frames per source and flags
    // meter-stall anomalies when the Python surface goes silent.
    healthMonitor.recordInbound(source, oscMessage?.address);

    const clientMessage = processIncomingMessage(oscMessage, source, metrics);
    broadcastBatcher.enqueue(clientMessage);
}

// `/live/test ["ok"]` is the liveness reply to the bridge's outbound
// probe — arrives now that AbletonOSC was retired (ROW 11). First
// reply flips connectionStatus.pythonSurface to 'connected' and
// broadcasts an /observer/status frame so the UI updates.
function announcePythonSurfaceIfNeeded(oscMessage) {
    if (oscMessage.address !== '/live/test') return;
    const payload = oscMessage.args && oscMessage.args[0];
    if (payload === 'ok' && connectionStatus.pythonSurface !== 'connected') {
        logger.info('Python Control Surface is connected and responding');
        connectionStatus.pythonSurface = 'connected';
        broadcastBatcher.enqueue({
            address: '/observer/status',
            args: ['connected', 'pythonSurface'],
            timestamp: Date.now(),
            source: 'bridge'
        });
    }
}

// `/looping/v3/session/save_as_request [tempo, sigNum, sigDen]` —
// surface→bridge command fired when Live's transport stops during an
// `npm run ipad` session. The bridge (running on the Mac) owns the OS
// keystroke automation the surface can't reach, so it terminates here:
// it pops Live's native Save As dialog pre-typed with a counter/date/
// tempo/meter name and does NOT relay to the UI. Returns true when it
// consumed the message so the caller can skip the normal broadcast.
//
// Belt-and-suspenders: even though the surface only emits this while it
// sees an "ipad" heartbeat, we re-check SERVER_MODE here so a bridge
// launched via `npm run dev` can never drive the dialog.
function handleSaveAsRequestIfNeeded(oscMessage) {
    if (oscMessage.address !== '/looping/v3/session/save_as_request') return false;
    if (SERVER_MODE !== 'ipad') {
        logger.debug('Ignoring save_as_request (server mode is not ipad)', {
            mode: SERVER_MODE
        });
        return true;
    }
    // Live's Save As dialog is driven through the AX helper, the owner's.
    if (!features.isEnabled('axHelper')) {
        logger.debug('Ignoring save_as_request (the axHelper switch is off)');
        return true;
    }
    const args = oscMessage.args || [];
    saveAsCurrentSet({ tempo: args[0], sigNum: args[1], sigDen: args[2] }, axHelper)
        .then((name) => logger.info('Save As dialog opened', { name }))
        .catch((err) =>
            logger.warn('Save As automation failed', {
                code: err && err.code,
                error: err && (err.detail || err.message)
            })
        );
    return true;
}

// Replay leg of the auto_capture override (ADR-405): write the remembered
// value back to the surface as a normal set message. Explicit `i` tag —
// osc.js infers bare JS numbers as floats, which the surface's strict
// bool01 parser rejects (same trap encodeOutboundArgs guards against).
function replayAutoCaptureOverride(value) {
    const port = udpPorts.pythonSurface;
    if (!port) return;
    try {
        port.send({
            address: AUTO_CAPTURE_ADDRESS,
            args: [{ type: 'i', value }]
        });
    } catch (err) {
        // Fire-and-forget: the next conflicting surface emit retriggers us,
        // so a dropped replay self-heals.
        logger.debug('auto_capture override replay send failed', {
            error: err && err.message
        });
    }
}

// Per-source pre-handler middleware: optional debug log or liveness
// check that runs before the message hits handleIncomingOSC. Sources
// not present here use the bare path.
const INBOUND_MIDDLEWARE = {
    // /capture/{state,file,error} from looping-recorder.amxd, and its
    // hello/bye, which the recorder handler consumes. Debug level so the
    // once-a-second hello doesn't flood; LOG_LEVEL=DEBUG to see it.
    loopingRecorder: (msg) => {
        logger.debug('Capture event from looping-recorder', { address: msg.address, args: msg.args });
        return captureRecorder.onDeviceMessage(msg);
    },
    // Returns true when the message is fully consumed bridge-side and
    // must NOT be relayed to the UI (currently only save_as_request).
    pythonSurface: (msg) => {
        if (handleSaveAsRequestIfNeeded(msg)) return true;
        // show_for_swap/ack and pad_names/reply answer the swap orchestrator.
        if (drumSwap.onSurfaceMessage(msg)) return true;
        // record_suspend/ack and record_resume/ack answer the Group gesture's
        // record-mode bracket.
        if (groupTracks.onSurfaceMessage(msg)) return true;
        announcePythonSurfaceIfNeeded(msg);
        // auto_capture emits: replay a remembered user override over a
        // fresh surface's mode re-seed (ADR-405). The emit itself still
        // broadcasts to WS clients — the corrected value follows ~ms later.
        if (msg.address === AUTO_CAPTURE_ADDRESS) {
            autoCaptureOverride.onSurfaceEmit(msg.args || [], replayAutoCaptureOverride);
        }
        return false;
    },

    // Raw TotalMix traffic (ADR-423). Every packet the mixer sends arrives
    // here — including its ~811-address state dump on enable — and all but
    // five addresses are dropped on the floor. Consuming unconditionally
    // (returning true) is the point: the mixer's address space must never
    // reach WS clients, only the translated `/looping/v3/totalmix/*` fire
    // that `relayTotalMixLevel` emits.
    totalmix: (msg) => {
        // Any packet at all means the mixer is there. A no-op once it is
        // known, so the ~811-address dump costs nothing extra.
        features.setAvailability('totalmix', true);
        const level = totalmixLink.fromMixer(msg.address, msg.args || []);
        if (level) relayTotalMixLevel(level);
        return true;
    },

    // The Max for Live monitor device announcing itself after a set load.
    // It holds no trustworthy state of its own, so the cached levels are
    // replayed to it and its faders adopt them.
    totalmixDevice: (msg) => {
        if (msg.address === totalmixLink.HELLO_ADDRESS) {
            replayTotalMixToDevice();
            return true;
        }
        // Device-driven writes share the UI's address space and the same
        // clamp, so they take the identical path a fader drag would.
        const write = totalmixLink.toMixer(msg.address, msg.args || []);
        if (write) {
            udpPorts.totalmix?.send({
                address: write.address,
                args: [{ type: 'f', value: write.db }]
            });
            // Echo to the UI so the iPad tracks a Move knob turn. The mixer
            // does not echo writes, so without this nothing would.
            relayTotalMixLevel({
                channel: write.channel,
                db: write.db,
                address: totalmixLink.BROADCAST_PREFIX + write.channel
            }, { toDevice: false });
        }
        return true;
    }
};

/**
 * Fan one monitor level out to the UI and (optionally) the Live device.
 *
 * @param {{channel: string, db: number, address: string}} level
 * @param {{toDevice?: boolean}} [opts] - skip the device leg when the device
 *   is where the value came from, so a knob turn can't be re-driven by its
 *   own echo.
 */
function relayTotalMixLevel(level, { toDevice = true } = {}) {
    handleIncomingOSC({ address: level.address, args: [level.db] }, 'totalmix');
    if (toDevice) {
        udpPorts.totalmixDevice?.send({
            address: level.address,
            args: [{ type: 'f', value: level.db }]
        });
    }
}

/**
 * Replay every cached level to a device that has just said hello.
 *
 * Channels never heard from are omitted rather than guessed — a fader that
 * stays put beats one that jumps to a fiction, and the device's own gate
 * stays shut until a real value arrives.
 */
function replayTotalMixToDevice() {
    const replay = totalmixLink.helloReplay();
    logger.info('TotalMix device hello — replaying cached levels', {
        channels: replay.map((r) => r.address),
        cached: replay.length
    });
    for (const { address, db } of replay) {
        udpPorts.totalmixDevice?.send({ address, args: [{ type: 'f', value: db }] });
    }
}

/**
 * Seed the level cache once, at startup.
 *
 * Deliberately fire-and-forget: nothing downstream waits on it, because the
 * safe outcome of failure is simply an empty cache. Any level that arrives
 * from the mixer meanwhile wins over the seed.
 */
function bootstrapTotalMixLevels() {
    bootstrapFromLegacy({
        logger,
        legacy: constants.osc.totalmixLegacy,
        silenceDb: constants.osc.totalmix.silenceDb,
        // Controller 1 answering at all says TotalMix is running, even when a
        // moved bank window means no level could be trusted.
        onReply: () => features.setAvailability('totalmix', true)
    })
        .then((seed) => {
            // Silence on controller 1 is not proof the mixer is absent: a
            // packet on the Global OSC port later still marks it available.
            // This only swaps "waiting" for what is known now.
            if (!features.isAvailable('totalmix')) {
                features.setAvailability('totalmix', false, 'TotalMix not answering');
            }
            const applied = totalmixLink.seed(seed);
            if (applied.length === 0) {
                logger.info('TotalMix bootstrap: nothing seeded — cache fills on first fader move');
                return;
            }
            logger.info('TotalMix bootstrap: seeded monitor levels', {
                channels: applied,
                levels: totalmixLink.snapshot()
            });
            // Push the seed at any device already listening. A device that
            // loaded before the bridge finished starting would otherwise sit
            // with its gates shut until something else moved.
            for (const { address, db } of totalmixLink.helloReplay()) {
                udpPorts.totalmixDevice?.send({ address, args: [{ type: 'f', value: db }] });
                handleIncomingOSC({ address, args: [db] }, 'totalmix');
            }
        })
        .catch((error) => {
            // bootstrapFromLegacy swallows its own failures; this is belt and
            // braces so a bug in it can never take the bridge down.
            logger.warn('TotalMix bootstrap threw unexpectedly', { error: error?.message });
        });
}

// Sources that feed handleIncomingOSC. The TotalMix pair is listed only while
// its switch has a link to feed.
const INBOUND_SOURCES = [
    'loopingRecorder',
    'pythonSurface',
    ...(totalmixLink ? ['totalmix', 'totalmixDevice'] : [])
];

for (const source of INBOUND_SOURCES) {
    const port = udpPorts[source];
    if (!port) {
        logger.warn('Inbound source missing from udpPorts; skipping handler', { source });
        continue;
    }
    const middleware = INBOUND_MIDDLEWARE[source];
    port.on('message', (oscMessage) => {
        // A middleware that returns true has fully consumed the message
        // (bridge-terminated command) — skip the UI broadcast.
        const consumed = middleware ? middleware(oscMessage) === true : false;
        if (!consumed) handleIncomingOSC(oscMessage, source);
    });
}

// ============================================
// Surface TCP leg
// ============================================
//
// The second bridge↔surface transport, alongside UDP rather than
// replacing it. It exists to retire the 9,216-byte darwin datagram
// ceiling that `state/full`'s chunk/checksum/reassemble machinery used
// to work around — protocol 3.6.0 deleted that machinery, so this leg
// is now the *only* wire the tree has. UDP stays because everything
// else fits a datagram and because fire-and-forget senders on
// ephemeral ports (the Max probe drivers) need one regardless.
//
// Inbound frames go through the *same* `handleIncomingOSC` with the
// *same* `pythonSurface` source, including the same middleware. That
// is deliberate: nothing downstream — capture taps, the profiler, the
// health monitor, the UI — should be able to tell which leg a message
// arrived on, so migrating an address across is invisible past this
// point.
const surfaceTcp = createSurfaceTcpClient({
    host: constants.osc.pythonSurface.host,
    port: constants.osc.pythonSurface.tcpPort,
    onMessage: (oscMessage) => {
        const middleware = INBOUND_MIDDLEWARE.pythonSurface;
        const consumed = middleware ? middleware(oscMessage) === true : false;
        if (!consumed) handleIncomingOSC(oscMessage, 'pythonSurface');
    },
    onStatus: (state) => {
        logger.info('Surface TCP status', { state });
    }
});
surfaceTcp.start();

// ============================================
// Performance Monitoring
// ============================================

function startPerformanceReporting() {
    setInterval(() => {
        const uptime = (Date.now() - metrics.startTime) / 1000;
        const messageRate = metrics.totalMessages / uptime;

        logger.info('Bridge Performance', {
            uptime: `${uptime.toFixed(1)}s`,
            totalMessages: metrics.totalMessages,
            messageRate: `${messageRate.toFixed(1)}/sec`,
            routingErrors: metrics.routingErrors,
            connections: connectionStatus
        });
    }, constants.timing.oscMonitoring.reporting);
}

// ============================================
// Service Discovery (Bonjour/mDNS)
// ============================================

function getLocalHostname() {
    return os.hostname().replace('.local', '');
}

const systemHostname = getLocalHostname();
// The Bonjour name to publish: a Mac's own setting (constants.local.json,
// the rig's `looping-studio`), else this Mac's name.
const stableHostname = constants.network?.hostname || systemHostname;

let wsService = null;
let httpService = null;

if (bonjour) {
    try {
        wsService = bonjour.publish({
            name: 'Looping OSC Bridge',
            type: 'looping-ws',
            port: OSC_CONFIG.webSocket.port,
            host: `${stableHostname}.local`,
            txt: {
                path: '/',
                version: '3.0'
            }
        });

        httpService = bonjour.publish({
            name: 'Looping Interface (V6)',
            type: 'http',
            port: constants.http.interfacePort,
            host: `${stableHostname}.local`,
            txt: {
                path: '/',
                version: '2.0'
            }
        });

        logger.info('Bonjour services published successfully');
    } catch (error) {
        logger.warn('Failed to publish Bonjour services (service discovery disabled)', { error: error.message });
        wsService = null;
        httpService = null;
    }
} else {
    logger.warn('Bonjour unavailable - service discovery disabled (direct IP connection still works)');
}

// ============================================
// Startup
// ============================================

openAllPorts(udpPorts);
startPerformanceReporting();

// Learn the mixer's current monitor levels once, now that the UDP ports
// exist. Asynchronous and unawaited — see bootstrapTotalMixLevels. Skipped
// with the link: a bridge whose `totalmix` switch is off never touches 7001.
if (totalmixLink) bootstrapTotalMixLevels();

// Bridge profiler — only does anything when BRIDGE_PROFILE=1. Reads
// the live WebSocket client count via a closure so the profiler stays
// decoupled from the wss instance.
bridgeProfiler.start({
    wsClientCount: () => (wss ? wss.clients.size : 0)
});

// Liveness heartbeat. Fires every 5s so a silent network/suspend
// condition is detectable on the client inside ~10s. Cheap: one JSON
// frame per client per tick. Client-side watchdog closes + reconnects
// if it misses pings, which on iPad Safari is the only reliable way
// to recover from a suspended tab.
const PING_INTERVAL_MS = 5_000;
let pingSeq = 0;
const pingTimer = setInterval(() => {
    if (!wss || wss.clients.size === 0) return;
    pingSeq += 1;
    broadcastBatcher.enqueue({
        address: '/bridge/ping',
        args: [pingSeq, Date.now()],
        source: 'bridge'
    });
    // Launch-mode beacon for WS clients (the menu-bar utility reads this
    // to show dev vs ipad). The UDP server-presence heartbeat carries
    // `mode` to the surface only; WS clients never see it, so re-announce
    // it here. Mode is fixed for the process lifetime, so the on-connect
    // send in WebSocketServer already covers each client — this periodic
    // beat just makes the status self-healing against a dropped frame.
    broadcastBatcher.enqueue({
        address: '/bridge/server_mode',
        args: [SERVER_MODE],
        source: 'bridge'
    });
    // AX helper state (ADR-439), repeated so a dropped change self-heals.
    if (axHelper) {
        const ax = axHelper.state;
        broadcastBatcher.enqueue({
            address: '/bridge/ax_helper',
            args: [ax.state, ax.detail],
            source: 'bridge'
        });
    }
    // The feature switches, for the same reason.
    broadcastBatcher.enqueue({
        address: FEATURES_ADDRESS,
        args: features.wireArgs(),
        source: 'bridge'
    });
    // The machine's values, for the same reason.
    broadcastBatcher.enqueue({
        address: MACHINE_ADDRESS,
        args: machine.wireArgs(),
        source: 'bridge'
    });
}, PING_INTERVAL_MS);
if (pingTimer.unref) pingTimer.unref();

// Server-presence heartbeat (bridge → Python surface). While this
// bridge process is alive — i.e. `npm run dev` / `npm run ipad` is
// running — we announce liveness to the surface so it can gate
// performance-only behaviors (arm-follows-selection) on "the server is
// up". The surface's ServerPresenceComponent treats a gap longer than
// its grace window as "server gone", so a clean quit and a `kill -9`
// are handled identically (the heartbeat simply stops). Sent unconditionally
// on the bridge's own clock — it does NOT require a connected WS/UI
// client, because the user's signal for "I'm performing" is having
// started the server, not having opened the browser yet.
//
// Direct UDP send to the surface port (bypasses the WS→backend router),
// so this address needs no `backendScope.pythonSurface` entry.
//
// The 3rd arg is the launch mode ("ipad" | "dev"), set by the npm
// script that started us (`LOOPING_SERVER_MODE`, see package.json
// dev:bridge / dev:bridge:ipad). It lets the surface gate behaviors
// that must run only under `npm run ipad` (auto-record + save-as on
// transport stop) vs `npm run dev`. Defaults to "dev" when unset so a
// bare `node enhanced-osc-bridge.js` never trips the ipad-only path.
const SERVER_HEARTBEAT_INTERVAL_MS =
    (constants.timing &&
        constants.timing.serverPresence &&
        constants.timing.serverPresence.heartbeatIntervalMs) ||
    2000;
let serverHeartbeatSeq = 0;
const serverHeartbeatTimer = setInterval(() => {
    const port = udpPorts.pythonSurface;
    if (!port) return;
    serverHeartbeatSeq = (serverHeartbeatSeq + 1) & 0x7fffffff;
    try {
        port.send({
            address: '/looping/v3/server/heartbeat',
            args: [serverHeartbeatSeq, Date.now(), SERVER_MODE]
        });
    } catch (err) {
        // Port may not be `ready` yet in the first interval, or torn
        // down during shutdown. Debug-level: this is a fire-and-forget
        // liveness beat, not a delivery-guaranteed message.
        logger.debug('Server heartbeat send failed', {
            error: err && err.message
        });
    }
}, SERVER_HEARTBEAT_INTERVAL_MS);
if (serverHeartbeatTimer.unref) serverHeartbeatTimer.unref();

// Dead-client reaper. Runs on the same tick cadence as the health
// monitor's snapshot (10s). If a client's send buffer stays above
// this threshold across two consecutive checks, the socket is wedged
// — the iPad tab is suspended and TCP hasn't sent RST yet, or a
// backgrounded Mac window is accumulating frames it'll never drain.
// `terminate()` forces the TCP RST, which triggers the browser's
// `onclose` on resume, and the existing reconnect path takes over.
// Without this, zombie clients sit forever, each one waking up the
// per-client broadcast for every meter tick.
//
// 512KB chosen over 1MB because the 2026-04-20 log showed a zombie
// Mac client parked at 775KB — above WARN (256KB) but below the old
// 1MB threshold, so it never got reaped. Healthy clients see single-
// digit KB between ticks, so 512KB has a comfortable margin.
const REAPER_BUFFER_THRESHOLD = 512_000;
const reaperBufferHits = new Map();  // clientId → consecutive-hit count
const reaperTimer = setInterval(() => {
    if (!wss) return;
    for (const client of wss.clients) {
        const id = client.clientId || 'unknown';
        const buffered = client.bufferedAmount || 0;
        if (buffered >= REAPER_BUFFER_THRESHOLD) {
            const hits = (reaperBufferHits.get(id) || 0) + 1;
            reaperBufferHits.set(id, hits);
            if (hits >= 2) {
                logger.error('Reaping wedged client', {
                    clientId: id,
                    bufferedBytes: buffered,
                    consecutiveHits: hits
                });
                try {
                    client.terminate();
                } catch (err) {
                    // Socket may already be torn down; log debug since
                    // we're already past the WARN-level reaper line.
                    logger.debug('Reaper terminate() threw on wedged client', {
                        clientId: id,
                        error: err && err.message,
                    });
                }
                reaperBufferHits.delete(id);
            }
        } else {
            reaperBufferHits.delete(id);
        }
    }
}, 10_000);
if (reaperTimer.unref) reaperTimer.unref();

logger.info('WebSocket-OSC Bridge ready', {
    protocols: {
        pythonSurface: `127.0.0.1:${OSC_CONFIG.pythonSurface.localPort}/${OSC_CONFIG.pythonSurface.remotePort}`,
        webSocket: `localhost:${OSC_CONFIG.webSocket.port}`
    },
    bonjour: {
        bridge: `${stableHostname}.local:${OSC_CONFIG.webSocket.port}`,
        interface: `${stableHostname}.local:3000`,
        fallback: `${systemHostname}.local`
    }
});

// ============================================
// Error Handling & Graceful Shutdown
// ============================================

// EPIPE on stdout/stderr is what happens when our parent (concurrently /
// terminal) closes the pipe before we exit. Logging it via console.* would
// raise EPIPE again, so the uncaughtException handler would run in a tight
// recursive loop and fill the log file at machine speed. We've measured
// 17 GB inside one wedged session. Three guards together stop the loop:
//
//  1. Detach console-write errors from the streams themselves so they
//     don't surface as 'uncaughtException' in the first place.
//  2. Skip EPIPE/EBADF in the uncaughtException handler (they're benign
//     pipe-close races, never the bridge's actual fault).
//  3. Rate-limit WebSocket-write EPIPE/ECONNRESET to one log line per
//     window — the broadcast loop fires per-client, so a single dead
//     client can multiply by N.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

const _BENIGN_WRITE_ERRORS = new Set(['EPIPE', 'EBADF', 'ECONNRESET']);
let _lastBenignErrorWarn = 0;

process.on('uncaughtException', (error) => {
    if (error && _BENIGN_WRITE_ERRORS.has(error.code)) {
        // Coalesce: at most one log per 5s, with a count of how many
        // we swallowed in the window. Prevents an N×30Hz storm.
        const now = Date.now();
        if (now - _lastBenignErrorWarn > 5000) {
            _lastBenignErrorWarn = now;
            logger.warn('Suppressing benign write error storm', {
                code: error.code,
                hint: 'Closed pipe / dead WebSocket — bridge continuing'
            });
        }
        return;
    }
    logger.error('Uncaught Exception (bridge will continue running)', {
        message: error.message,
        stack: error.stack?.split('\n')[1] || ''
    });
});

process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise Rejection (bridge will continue running)', { reason });
});

// Node terminates the process when an EventEmitter emits 'error' with
// no listener. UDP ports can emit 'error' from inside osc's dgram layer
// during network blips (USB-C bounce, sleep/wake) in a window where our
// handler was detached during a close/reopen — that path bypasses
// uncaughtException. A permanent no-op listener on every port keeps
// the emit non-fatal; the real handler in UDPPortManager still logs it.
Object.values(udpPorts).forEach(port => port.on('error', () => {}));

// Surface Node-level warnings (EMFILE/ENOBUFS precursors, deprecations)
// so long-session degradation is visible in the log before it kills us.
process.on('warning', (warning) => {
    logger.warn('Node warning', {
        name: warning.name,
        message: warning.message,
        code: warning.code
    });
});

// Final marker so the log shows *why* the process ended — concurrently
// will restart us, and the next run's startup line will follow in the
// same file. `exit` is synchronous, so we use the stream directly.
process.on('exit', (code) => {
    logger.warn('Bridge process exiting', { code, pid: process.pid });
});

/**
 * One teardown for every signal we shut down on.
 *
 * SIGINT and SIGTERM used to have two hand-maintained handlers, and they had
 * drifted: SIGINT did eight things, SIGTERM did three. The missing five are
 * not cosmetic — `concurrently` sends SIGTERM on EVERY supervised restart, so
 * the common restart was the path that skipped Bonjour destroy (no mDNS
 * goodbye before the same names are re-advertised ~1.5 s later), left the WS
 * and HTTP servers open, and left every UDP port bound.
 *
 * Each step is isolated: a throw in one must not cost the ones after it,
 * which is exactly how the SIGTERM handler's single try/catch could lose the
 * profile dump it was written to save.
 *
 * @param {string} signal
 */
function shutdown(signal) {
    logger.info('Shutting down Enhanced OSC Bridge...', { signal });

    const steps = [
        ['bonjour', () => {
            wsService?.destroy();
            httpService?.destroy();
            bonjour?.destroy();
        }],
        // Drain any pending batched frames before closing the WS server
        // so the last window's messages land on the wire.
        ['batcher flush', () => broadcastBatcher.flush()],
        ['websocket clients', () => wss.clients.forEach((client) => client.close())],
        ['websocket server', () => wss.close()],
        ['http server', () => httpServer.close()],
        ['udp ports', () => closeAllPorts(udpPorts)],
        // Stop the surface TCP client. Without this its reconnect timer
        // keeps firing through shutdown; the timer is unref'd so it won't
        // hold the process open, but a dial attempt racing process.exit
        // logs a spurious error on the way out.
        ['surface tcp', () => surfaceTcp.stop()],
        // Flush + close the perf profile sink so the final window lands.
        ['profiler', () => bridgeProfiler.stop()],
    ];

    for (const [label, fn] of steps) {
        try {
            fn();
        } catch (error) {
            logger.warn('Shutdown step failed', { signal, step: label, error: error && error.message });
        }
    }

    logger.info('Enhanced OSC Bridge shutdown complete', { signal });
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
