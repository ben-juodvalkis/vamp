/**
 * The machine's values, for clients (onboarding.plan.md §3, §6.5).
 *
 * The build holds code only; everything about the Mac comes from the Mac
 * while it runs. Five client files used to compile `constants.json` values
 * in — the owner's library paths, the Vamp Devices folder, the TotalMix range —
 * so an iPad build was a picture of one Mac. Since 2026-09-26 the bridge
 * reads them once at startup and tells every client over `/bridge/machine
 * [json]`, on connect, and with the 5 s ping, the way `/bridge/features`
 * travels. `/bridge/*` sits outside the v3 version negotiation, so no
 * protocol bump.
 *
 * What travels:
 *   paths.instrumentsBase     the folder a preset path recorded before the
 *                             Places is read against (`presetPath.ts`)
 *   paths.effectPresetsBase   the folder of the FX tiles that are files (`devicePresets.ts`)
 *   paths.m4lDevicesRoot      this checkout's `Vamp Devices`, derived
 *                             from the bridge's own location
 *   totalmix                  the mixer's dB range (`osc.totalmix`), or null
 *                             with no block
 * Anything the same on every machine (the role palette, gesture timing) stays
 * compiled in.
 */

const path = require('path');

/** The wire address clients read the snapshot from. */
const MACHINE_ADDRESS = '/bridge/machine';

/** This checkout's root, from the bridge's own folder (`interface/bridge/`). */
function repoRootFromHere() {
    return path.resolve(__dirname, '..', '..', '..');
}

function stringOr(v, fallback = '') {
    return typeof v === 'string' && v ? v : fallback;
}

/**
 * @param {Object} constants the parsed constants.json
 * @param {{repoRoot?: string}} [opts]
 * @returns {{paths: {instrumentsBase: string, effectPresetsBase: string, m4lDevicesRoot: string}, totalmix: {minDb: number, maxDb: number, silenceDb: number} | null}}
 */
function machineSnapshot(constants, { repoRoot = repoRootFromHere() } = {}) {
    const paths = (constants && constants.paths) || {};
    const tm = constants && constants.osc && constants.osc.totalmix;
    const totalmix =
        tm && typeof tm.minDb === 'number' && typeof tm.maxDb === 'number'
            ? { minDb: tm.minDb, maxDb: tm.maxDb, silenceDb: typeof tm.silenceDb === 'number' ? tm.silenceDb : -300 }
            : null;
    return {
        paths: {
            instrumentsBase: stringOr(paths.instrumentsBase),
            effectPresetsBase: stringOr(paths.effectPresetsBase),
            m4lDevicesRoot: path.join(repoRoot, 'Vamp Devices')
        },
        totalmix
    };
}

/**
 * @param {Object} constants
 * @param {{repoRoot?: string}} [opts]
 */
function createMachineRegistry(constants, opts = {}) {
    const snapshot = machineSnapshot(constants, opts);
    return {
        MACHINE_ADDRESS,
        snapshot: () => snapshot,
        /** The `/bridge/machine` payload: one JSON string argument. */
        wireArgs: () => [JSON.stringify(snapshot)]
    };
}

module.exports = { MACHINE_ADDRESS, machineSnapshot, createMachineRegistry, repoRootFromHere };
