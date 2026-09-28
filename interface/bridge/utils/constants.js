/**
 * The config: `config/constants.json` with this Mac's
 * `config/constants.local.json` laid over it (general-release plan.md §3).
 *
 * The tracked file is the general edition's working defaults, the same on
 * every clone. The local file is gitignored and holds only what differs on
 * one Mac: the owner's switches, paths, hardware maps and library tuning.
 * Without it, a clone runs as the general edition.
 *
 * Objects merge key by key, all the way down; any other value in the local
 * file (a string, a number, a list) replaces the tracked one whole.
 *
 * Everything on the Mac reads the config through this or one of its two
 * twins, which merge the same way: the interface server's
 * `interface/src/lib/server/runtimeConfig.ts` and the surface's
 * `surface/config_loader.py`. The UI build does not: it
 * compiles only the tracked defaults (`$config/constants.json`), and a Mac's
 * own values reach the page over `/bridge/machine`.
 */

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.resolve(__dirname, '..', '..', '..', 'config');
const CONSTANTS_PATH = path.join(CONFIG_DIR, 'constants.json');
const LOCAL_PATH = path.join(CONFIG_DIR, 'constants.local.json');

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** `base` with `local` laid over it. Neither is modified. */
function mergeConstants(base, local) {
    if (!isPlainObject(base) || !isPlainObject(local)) return local;
    const out = { ...base };
    for (const [key, value] of Object.entries(local)) {
        out[key] = isPlainObject(value) && isPlainObject(base[key]) ? mergeConstants(base[key], value) : value;
    }
    return out;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * The merged config, read now. Throws when either file is not JSON — a local
 * file that quietly failed to apply would run the owner's rig as a stranger's.
 * No local file is no overlay.
 */
function loadConstants({ constantsPath = CONSTANTS_PATH, localPath = LOCAL_PATH } = {}) {
    const base = readJson(constantsPath);
    return fs.existsSync(localPath) ? mergeConstants(base, readJson(localPath)) : base;
}

module.exports = { loadConstants, mergeConstants, CONSTANTS_PATH, LOCAL_PATH };
