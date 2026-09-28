/**
 * UDP Port Manager
 *
 * Creates and manages UDP ports for OSC communication with:
 * - Python Control Surface (primary backend for Live)
 * - MIDI Converter (pitch/mod wheel)
 * - TotalMix mixer and its Max device (ADR-423)
 * - Vamp-Recorder capture device
 *
 * The Max observer, Omnisphere/NI preset-server and shell-helper ports were
 * removed 2026-09-23 (general-release audit Tier 0): nothing answered on any.
 */

const osc = require('osc');
const { logger } = require('../utils/logger');

/**
 * Every inbound socket binds loopback, not 0.0.0.0.
 *
 * Whatever arrives on these ports and no middleware in
 * `enhanced-osc-bridge.js` consumes goes on to `handleIncomingOSC` and out to
 * every WS client, and the handler registered there drops osc.js's `rinfo`,
 * so there is no source check in JS at all — the bind address IS the check.
 * On 0.0.0.0, one datagram from any LAN host (or the tailnet) went around the
 * WebSocket HMAC gate entirely: `/capture/file <path>` to 11017 made every
 * client create a MIDI track and load that file, `/totalmix/*` to 11019
 * reached the mixer, and `/looping/v3/session/save_as_request` to 11021 popped
 * Live's modal Save panel over a performance (11021 was closed first,
 * 2026-09-16; the rest followed, general-release audit §5.3, 2026-09-23).
 *
 * Every peer is on this Mac, measured 2026-09-23 rather than assumed: the Max
 * senders — `Max Utility 1.0.maxpat` → 11019, `Vamp-Recorder.amxd` → 11017
 * — all name `udpsend 127.0.0.1`; TotalMix's remote controller 3 has
 * `OSCRemoteHost` 127.0.0.1, and lsof showed its socket connected to
 * 127.0.0.1:9003; the surface replies to `pythonSurface.host`. A peer
 * that ever moves to another machine gets its own bind: widen one endpoint,
 * not the set.
 *
 * Not here: `totalmixBootstrap.js` binds 7001 on all interfaces for under a
 * second at startup, because TotalMix's controller 1 sends to
 * `looping-studio-2.local`, which resolves to the LAN address as well as
 * loopback.
 */
const INBOUND_BIND_ADDRESS = '127.0.0.1';

/**
 * Create all UDP ports based on configuration
 *
 * A switchable endpoint is built only when `config` carries its entry. The
 * bridge leaves an endpoint out while its feature is off (general-release
 * audit §7b), so the socket is never constructed and never bound — and every
 * other function here works from the ports this returns, never from a list of
 * names, so an absent one is simply not there.
 *
 * @param {Object} config - OSC configuration object from constants.json
 * @returns {Object} Map of UDP port instances
 */
function createUDPPorts(config) {
    logger.info('Initializing UDP ports for communication');

    const ports = {
        // RME TotalMix mixer link — Global OSC, remote controller 3 (ADR-423).
        // Both TotalMix endpoints exist only while the `totalmix` feature is on.
        ...(config.totalmix && {
            totalmix: new osc.UDPPort({
                localAddress: INBOUND_BIND_ADDRESS,
                localPort: config.totalmix.localPort,
                remoteAddress: config.totalmix.host,
                remotePort: config.totalmix.remotePort
            })
        }),

        // Bridge <-> the Max for Live monitor device (ADR-423)
        ...(config.totalmixDevice && {
            totalmixDevice: new osc.UDPPort({
                localAddress: INBOUND_BIND_ADDRESS,
                localPort: config.totalmixDevice.localPort,
                remoteAddress: config.totalmixDevice.host,
                remotePort: config.totalmixDevice.remotePort
            })
        }),

        // Python Control Surface UDP port. From the bridge POV:
        // `localPort` is where replies come in, `remotePort` is where
        // outbound sends go — i.e. the bridge's view is mirrored vs.
        // the surface's view of the same pair.
        //
        // The one inbound socket that reaches Live and, since ADR-439, macOS
        // Accessibility (`session/save_as_request` is bridge-terminated into
        // the AX helper), and the first to move to loopback. Everything that
        // sends here — the surface itself, `owner/probes/*_run.js` — runs on this
        // Mac; nothing under `owner/Max Patches/` or `Vamp Devices/`
        // addresses this port at all (they all send to the surface on
        // `remotePort`).
        pythonSurface: new osc.UDPPort({
            localAddress: INBOUND_BIND_ADDRESS,
            localPort: config.pythonSurface.localPort,
            remoteAddress: config.pythonSurface.host,
            remotePort: config.pythonSurface.remotePort
        }),

        // Vamp-Recorder.amxd capture device. Bidirectional:
        // bridge sends /capture/{arm,start,stop,disarm,query} to
        // :11016; device replies with /capture/{state,file,meter,error}
        // to :11017. Mirror of pythonSurface's pair-direction model.
        loopingRecorder: new osc.UDPPort({
            localAddress: INBOUND_BIND_ADDRESS,
            localPort: config.loopingRecorder.localPort,
            remoteAddress: config.loopingRecorder.host,
            remotePort: config.loopingRecorder.remotePort
        })
    };

    // Derived from `ports`, not hand-listed. This was the FIFTH copy of the
    // endpoint list and the one no test covered, so it was also the one that
    // had drifted: `totalmix` and `totalmixDevice` were added to the other
    // four lists and never to this, and the startup line has been quietly
    // under-reporting the bridge's own sockets ever since (ADR-423).
    logger.info('UDP port configuration', Object.fromEntries(
        Object.keys(ports).map((name) => [
            name,
            `${config[name].localPort}/${config[name].remotePort}`
        ])
    ));

    return ports;
}

/**
 * Set up error and ready handlers for a UDP port
 * @param {osc.UDPPort} port - UDP port instance
 * @param {string} name - Port name for logging
 * @param {Object} config - Port configuration
 * @param {Object} connectionStatus - Connection status object to update
 */
function setupPortHandlers(port, name, config, connectionStatus) {
    port.on("error", (error) => {
        // Check if it's an OSC parsing error (RangeError, DataView issues)
        if (error.message && (error.message.includes('DataView') || error.message.includes('Offset is outside'))) {
            logger.warn(`Malformed OSC data received from ${name} - ignoring packet`, { error: error.message });
            return;
        }
        logger.error(`${name} UDP error`, { error: error.toString() });
        if (connectionStatus && connectionStatus[name] !== undefined) {
            connectionStatus[name] = 'error';
        }
    });

    port.on("ready", () => {
        logger.info(`${name} UDP ready`, { local: config.localPort, remote: config.remotePort });
        if (connectionStatus && connectionStatus[name] !== undefined) {
            connectionStatus[name] = 'ready';
        }
    });
}

/**
 * Set up all port handlers
 *
 * These three walk the ports `createUDPPorts` built rather than naming them.
 * Each used to be its own hand-written list of five, and a list that missed
 * an endpoint left it constructed but never bound (`udpPortCoverage.test.ts`
 * was written after exactly that) — and a feature switch would have had to
 * thread a guard through all of them.
 *
 * @param {Object} ports - Map of UDP port instances
 * @param {Object} config - OSC configuration
 * @param {Object} connectionStatus - Connection status object. Only the
 *   endpoints it has a key for (`pythonSurface`) are tracked in it.
 */
function setupAllPortHandlers(ports, config, connectionStatus) {
    for (const [name, port] of Object.entries(ports)) {
        setupPortHandlers(port, name, config[name], connectionStatus);
    }
}

/**
 * Open all UDP ports
 * @param {Object} ports - Map of UDP port instances
 */
function openAllPorts(ports) {
    logger.info('Opening UDP connections');
    for (const port of Object.values(ports)) port.open();
}

/**
 * Close all UDP ports
 * @param {Object} ports - Map of UDP port instances
 */
function closeAllPorts(ports) {
    for (const port of Object.values(ports)) port.close();
}

module.exports = {
    createUDPPorts,
    setupPortHandlers,
    setupAllPortHandlers,
    openAllPorts,
    closeAllPorts
};
