/**
 * Feature switches (general-release audit §7b, Tier 1).
 *
 * One switch per bespoke subsystem, so one codebase runs as the owner's rig
 * and as a general edition on stock Live Suite. The switches live in
 * `constants.features` and are read ONCE, at startup.
 *
 * **A missing switch is OFF.** Deleting `midiPedals` or `devices.wah` brings
 * back built-in defaults (audit §2), which is how "remove it" came to mean
 * "keep it, quietly". Here only an explicit `true` turns a subsystem on.
 *
 * Each feature carries two facts for clients:
 *
 *   enabled    the config turned it on. Off → the UI hides it.
 *   available  what it drives has been seen since this process started (the
 *              mixer answered, ...). On but unavailable → the UI draws it
 *              greyed out, with `reason`, the swap pill's grey-with-a-reason
 *              model (`useInstrumentSwap.svelte.ts`).
 *
 * Clients learn both from `/bridge/features [json]` — on connect, on every
 * change, and with the 5 s ping — so switching editions needs no iPad
 * rebuild. `/bridge/*` sits outside the v3 version negotiation, so the
 * message needs no protocol bump; it copies `/bridge/ax_helper`.
 *
 * Wired so far: `totalmix` (the Tier 1 pilot), `maxUtilityPatch` (the
 * owner's standalone Max patch: Ableton Move, piano-pedal looper),
 * `expressionPedal` (the wah pedal: its two CCs on the surface, the Pedal
 * view's Wah button), `menubar` (the owner's menu-bar app, launched by the
 * start scripts) and `axHelper` (the Accessibility helper behind Reverse,
 * Group, the held pad's similar-sample swap and the iPad Save As). The foot
 * switch is not a feature switch — it is a user setting with Learn, owned by
 * the surface (`FootSwitchComponent`). §7b lists the rest, in the order they
 * will follow; each one joins FEATURE_IDS when it is gated.
 *
 * **Built in, not switched:** `captureRecorder`, the Vamp-Recorder device
 * behind REC. It needs only Max for Live, which every Suite has, so no config
 * turns it off; it rides the same snapshot for its availability alone — REC
 * greys out, saying why, until the device on Return A says hello
 * (`handlers/captureRecorder.js`).
 */

const { EventEmitter } = require('events');

/** Every switch this bridge honours. A subsystem joins when it is gated. */
const FEATURE_IDS = Object.freeze(['totalmix', 'maxUtilityPatch', 'expressionPedal', 'menubar', 'axHelper']);

/** In every edition: always enabled, never read from the config. */
const BUILT_IN_IDS = Object.freeze(['captureRecorder']);
const ALL_IDS = Object.freeze([...FEATURE_IDS, ...BUILT_IN_IDS]);

/** The wire address clients read the snapshot from. */
const FEATURES_ADDRESS = '/bridge/features';

/**
 * Resolve `constants.features` to one boolean per known switch.
 *
 * @param {Object} constants the parsed constants.json
 * @param {{warn?: Function}} [logger]
 * @returns {Record<string, boolean>}
 */
function readFeatureFlags(constants, logger) {
    const block = constants && constants.features;
    const flags = Object.fromEntries(FEATURE_IDS.map((id) => [id, false]));
    if (block === undefined) return flags;
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
        logger?.warn?.('constants.features is not an object; every feature is off', { features: block });
        return flags;
    }
    for (const [key, value] of Object.entries(block)) {
        // `_`-prefixed keys are documentation, as everywhere in constants.json.
        if (key.startsWith('_')) continue;
        if (!FEATURE_IDS.includes(key)) {
            // A typo'd switch would otherwise read as "off" with no trace.
            logger?.warn?.('Unknown feature switch; ignored', { key, known: FEATURE_IDS });
            continue;
        }
        if (typeof value !== 'boolean') {
            logger?.warn?.('Feature switch is not true or false; treated as off', { key, value });
            continue;
        }
        flags[key] = value;
    }
    return flags;
}

/**
 * @typedef {{ enabled: boolean, available: boolean, reason: string }} FeatureState
 */

/**
 * @param {Object} constants the parsed constants.json
 * @param {Object} [deps]
 * @param {{info?: Function, warn?: Function}} [deps.logger]
 */
function createFeatureRegistry(constants, { logger } = {}) {
    const switches = readFeatureFlags(constants, logger);
    const flags = { ...switches, ...Object.fromEntries(BUILT_IN_IDS.map((id) => [id, true])) };
    /** @type {Map<string, {available: boolean, reason: string}>} */
    const availability = new Map(
        ALL_IDS.map((id) => [id, { available: false, reason: '' }])
    );
    const events = new EventEmitter();

    /** @returns {Record<string, FeatureState>} */
    function snapshot() {
        return Object.fromEntries(ALL_IDS.map((id) => {
            const { available, reason } = availability.get(id);
            return [id, { enabled: flags[id], available: flags[id] && available, reason: flags[id] ? reason : '' }];
        }));
    }

    logger?.info?.('Feature switches', switches);

    const registry = {
        FEATURES_ADDRESS,

        /** @param {string} id */
        isEnabled: (id) => flags[id] === true,

        /** @param {string} id — false for a feature that is off */
        isAvailable: (id) => flags[id] === true && availability.get(id).available,

        /**
         * Record whether an enabled feature's subsystem is there.
         *
         * A no-op for a feature that is off — it has nothing to report — and
         * for a value that has not changed, so callers may report on every
         * packet without flooding clients. `reason` says why it is not
         * available; it is cleared once it is.
         *
         * @param {string} id
         * @param {boolean} available
         * @param {string} [reason] short enough to draw in a control
         */
        setAvailability(id, available, reason = '') {
            if (!flags[id]) return;
            const next = { available: Boolean(available), reason: available ? '' : String(reason) };
            const prev = availability.get(id);
            if (prev.available === next.available && prev.reason === next.reason) return;
            availability.set(id, next);
            events.emit('change', snapshot());
        },

        snapshot,

        /** The `/bridge/features` payload: one JSON string argument. */
        wireArgs: () => [JSON.stringify(snapshot())],

        /**
         * @param {'change'} event
         * @param {(snapshot: Record<string, FeatureState>) => void} listener
         */
        on(event, listener) {
            events.on(event, listener);
            return registry;
        }
    };
    return registry;
}

module.exports = { createFeatureRegistry, readFeatureFlags, FEATURE_IDS, BUILT_IN_IDS, FEATURES_ADDRESS };
