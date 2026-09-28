/**
 * Message Router - Determines routing targets for OSC messages
 *
 * Routes messages to appropriate backends based on OSC address patterns:
 * - Python Control Surface - addresses listed in `osc.backendScope.pythonSurface`
 *   in constants.json, plus the `/live/*` family (AbletonOSC legacy names the
 *   surface still answers) routed via the explicit scope entries
 * - looping-recorder - addresses listed in `osc.backendScope.loopingRecorder`
 * - MIDI Converter - `/midi/*`
 *
 * Anything else routes to 'none', which WebSocketServer.routeMessageToUDP
 * logs and drops.
 *
 * 2026-09-23 (general-release audit Tier 0): the Max observer
 * (`liveAPI-v6.js` + `AbletonOSC helper.amxd`, a stub since ROW 6), the
 * Omnisphere/NI preset servers (deleted 2025-11-23) and the shell helper
 * (receiver deleted 2025-10-12) were removed with their routes. None had a
 * UI sender. The `/looping/*` catch-all that sent a stray v3 address to the
 * Max observer went with them: such an address is now a logged drop.
 *
 * ROW 11 (2026-04-21): AbletonOSC + Max4Live backends dropped. The
 * `/live/*` family is now answered by the Python surface via explicit
 * `backendScope.pythonSurface` entries; there is no generic `/live/*`
 * fallback. `/tracks/*`, `/clips/*`, `/devices/*`, `/session/*`,
 * `/current_track/*`, `/current_clip/*` had no UI callers at time of
 * delete — the `isMax4LiveMessage` family detector was removed too.
 */

const { logger } = require('../utils/logger');
const { loadConstants } = require('../utils/constants');

// --- backendScope: opt-in overrides of the default prefix routing ---------
//
// Loaded once at module require time from constants.json. A missing
// file or missing `backendScope` section is treated as "no overrides"
// — the router still works, just with the pre-Gate-1 prefix rules.
//
// Entry forms (Gate 5+):
//   - exact literal address, e.g. `/looping/protocol/version`
//   - prefix glob ending in `*`, e.g. `/looping/v2/*` — matches every
//     address starting with the prefix before the `*`. Introduced at
//     Gate 5 so the whole v2 family routes as one entry; prior gates
//     were exact-match only because nothing needed the fan-out.
//
// Exact matches are checked first (O(1) Set lookup); prefix matches
// scan a small array. Order within the prefix array is not
// significant — by contract, prefixes don't overlap.
/**
 * @typedef {{ exact: Set<string>, prefixes: string[] }} BackendScope
 */

/** @param {string} backendName @returns {BackendScope} */
function loadBackendScope(backendName) {
    try {
        const constants = loadConstants();
        const entries = (constants.osc && constants.osc.backendScope && constants.osc.backendScope[backendName]) || [];
        /** @type {string[]} */
        const exact = [];
        /** @type {string[]} */
        const prefixes = [];
        for (const entry of entries) {
            if (typeof entry !== 'string') continue;
            if (entry.endsWith('*')) {
                prefixes.push(entry.slice(0, -1));
            } else {
                exact.push(entry);
            }
        }
        return { exact: new Set(exact), prefixes };
    } catch (e) {
        logger.warn(`messageRouter: could not load backendScope.${backendName} from constants.json`, {
            error: /** @type {Error} */ (e).message
        });
        return { exact: new Set(), prefixes: [] };
    }
}

const pythonSurfaceScope = loadBackendScope('pythonSurface');
const loopingRecorderScope = loadBackendScope('loopingRecorder');

/** @param {string} address @param {BackendScope} scope */
function matchesScope(address, scope) {
    if (scope.exact.has(address)) return true;
    for (const prefix of scope.prefixes) {
        if (address.startsWith(prefix)) return true;
    }
    return false;
}

/** @param {string} address */
function matchesPythonSurface(address) {
    return matchesScope(address, pythonSurfaceScope);
}

/** @param {string} address */
function matchesLoopingRecorder(address) {
    return matchesScope(address, loopingRecorderScope);
}

/**
 * @typedef {Object} RoutingRule
 * @property {string} target - backend name returned on match
 * @property {(address: string) => boolean} match - true if this rule applies
 * @property {(address: string) => void} [onMatch] - optional side-effect (e.g., warn)
 */

// Routing precedence, highest-priority first. First rule whose `match`
// returns true wins; `onMatch` runs at decision time.
//
// Migration overrides (backendScope) are intentionally first so an
// individual address can be moved to the Python surface without
// waiting for its whole prefix family to migrate.
//
// History notes (kept inline for archaeological context):
//   - Phase 10 PR-10d (2026-04-19): /looping/sequencer/* + 'sequencer'
//     port pair retired. Permute v4.0.0 exposes state as standard
//     Device.parameters; no bespoke wire remains.
//   - PR-5e1/PR-5e2 (2026-04-18): /clip/set/* and /clip/groove/*
//     fallbacks deleted; both families now travel as /looping/v3/* via
//     backendScope.pythonSurface (ClipPropertiesComponent + GrooveComponent).
//   - Phase 8 PR-8b (2026-04-19): /cmd/transpose_clip_notes removed —
//     ClipNotesComponent owns /looping/v3/clip/transpose.
//   - ROW 2-F4 (2026-04-21): /live/view/set/selected_track retired —
//     SelectedTrackComponent owns /looping/v3/track/select.
//   - ROW 5 (2026-04-21): /cmd/rename_selected_track retired —
//     TrackMetadataComponent owns /looping/v3/track/name.
//   - ROW 11 (2026-04-21): no default fallback. Unknown addresses are
//     logged and dropped by WebSocketServer.routeMessageToUDP — before
//     ROW 11 they silently went to Max4Live, which hid typos.
/** @type {RoutingRule[]} */
const ROUTING_RULES = [
    { target: 'pythonSurface', match: matchesPythonSurface },
    // Looping-recorder capture device (Vamp-Recorder.amxd).
    // /capture/{arm,disarm,start,stop,query} outbound → device on :11016.
    // Inbound /capture/{state,file,meter,error} comes in on :11017 and
    // is broadcast to WS clients via handleIncomingOSC (no router hop).
    { target: 'loopingRecorder', match: matchesLoopingRecorder },
    // No /totalmix/ rule since 2026-09-27: the transport header's faders
    // were its only WS sender. The mixer is written by the Max patch over
    // the bridge's totalmixDevice port, never through this router.
    // No /midi/ rule since 2026-09-25: the on-screen wheels were its last
    // senders, and they now travel as /looping/v3/wheels/* to the surface's
    // MidiWheelsComponent. A stray /midi/* is unknown and dropped.
];

/**
 * Determine routing target for an OSC address
 * @param {string} address - OSC address
 * @returns {string} Routing target: 'pythonSurface', 'loopingRecorder', or 'none' for unknown addresses
 */
function getRoutingTarget(address) {
    for (const rule of ROUTING_RULES) {
        if (rule.match(address)) {
            if (rule.onMatch) rule.onMatch(address);
            return rule.target;
        }
    }
    return 'none';
}

module.exports = {
    getRoutingTarget
};
