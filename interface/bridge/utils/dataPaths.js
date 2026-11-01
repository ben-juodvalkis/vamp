/**
 * Where the bridge reads what ships with Vamp and writes what it makes
 * (installer.plan.md Phase 1).
 *
 * - The app root holds what ships: `config/constants.json`, `scripts/`.
 *   `VAMP_APP_ROOT` when the installed app starts the bridge, else this
 *   checkout (found from the bridge's own folder).
 * - The data folder holds everything written: `config/` (the local
 *   constants, `.ws-secret`, paired devices), `logs/`, `cache/`.
 *   `VAMP_DATA` when installed (`~/Library/Application Support/Vamp`),
 *   else the checkout's own `config/`, `logs/` and `scripts/.cache/`, so a
 *   clone writes where it always has.
 * - Vamp Devices: `VAMP_DEVICES`, the folder the user put them in, else
 *   the checkout's `Vamp Devices`.
 *
 * The interface server's twin is `interface/src/lib/server/runtimeConfig.ts`.
 * Both read the environment on each call, so a test can set it.
 */

const path = require('path');

function appRoot() {
    // utils/ -> bridge/ -> interface/ -> repo root
    return process.env.VAMP_APP_ROOT || path.resolve(__dirname, '..', '..', '..');
}

/** @param {'config'|'logs'|'cache'} kind */
function dataDir(kind) {
    const data = process.env.VAMP_DATA;
    if (data) return path.join(data, kind);
    return kind === 'cache' ? path.join(appRoot(), 'scripts', '.cache') : path.join(appRoot(), kind);
}

function devicesDir() {
    return process.env.VAMP_DEVICES || path.join(appRoot(), 'Vamp Devices');
}

module.exports = { appRoot, dataDir, devicesDir };
