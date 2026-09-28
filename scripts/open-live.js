#!/usr/bin/env node
/**
 * Find the Ableton Live this Mac runs, and open it (general-release plan.md
 * §2: "Find Live" instead of `open -a 'Ableton Live 12 Beta'`).
 *
 * Which Live, in order:
 *   1. `paths.abletonApp`, when it names an app that is on this Mac.
 *   2. The app whose version names the preferences folder Live wrote last.
 *      Live keeps one folder per version (`~/Library/Preferences/Ableton/
 *      Live 12.4.15b4`), and each app's Info.plist carries the same string
 *      (`12.4.15b4 (2026-09-17_…)`), so a Mac with a Suite and a Beta opens
 *      the one in use. Newest by mtime, not by name, for the reason
 *      `surface/install.sh` measured: `Live 12.4b7` sorts
 *      after every `Live 12.4.x`.
 *   3. The highest version under /Applications.
 *
 * `npm run dev` runs this as part of `open:browser`; `scripts/setup-ipad.js`
 * and `scripts/validate-setup.js` require it.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APPLICATIONS_DIR = '/Applications';
const PREFS_DIR = path.join(os.homedir(), 'Library', 'Preferences', 'Ableton');

/** `12.4.15b4` from an Info.plist's `12.4.15b4 (2026-09-17_a0ac16f342)`, or null. */
function appVersion(app) {
    try {
        const plist = fs.readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8');
        const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<\s]+)/.exec(plist);
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

/** [12, 4, 15, 1] for `12.4.15`, [12, 4, 15, 0] for `12.4.15b4`: a release outranks its betas. */
function versionKey(version) {
    const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(.*)$/.exec(version || '');
    if (!m) return [0, 0, 0, 0];
    return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0), m[4] ? 0 : 1];
}

function compareVersions(a, b) {
    const ka = versionKey(a);
    const kb = versionKey(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
}

/** Every `Ableton Live*.app` under `applicationsDir`, with its version. */
function installedLives(applicationsDir = APPLICATIONS_DIR) {
    let names = [];
    try {
        names = fs.readdirSync(applicationsDir);
    } catch {
        return [];
    }
    return names
        .filter((n) => /^Ableton Live\b.*\.app$/.test(n))
        .map((n) => {
            const app = path.join(applicationsDir, n);
            return { app, version: appVersion(app) };
        });
}

/** The version in the name of the preferences folder Live wrote last (`12.4.15b4`), or null. */
function lastUsedVersion(prefsDir = PREFS_DIR) {
    let newest = null;
    let newestMtime = -Infinity;
    let names = [];
    try {
        names = fs.readdirSync(prefsDir);
    } catch {
        return null;
    }
    for (const name of names) {
        const m = /^Live (\S+)$/.exec(name);
        if (!m) continue;
        let mtime;
        try {
            mtime = fs.statSync(path.join(prefsDir, name)).mtimeMs;
        } catch {
            continue;
        }
        if (mtime > newestMtime) {
            newestMtime = mtime;
            newest = m[1];
        }
    }
    return newest;
}

/**
 * The Live to open, or null when this Mac has none.
 *
 * @param {object} [opts]
 * @param {string} [opts.configured] `paths.abletonApp`
 * @returns {{ app: string, version: string|null, why: 'configured'|'last used'|'newest installed' } | null}
 */
function findLiveApp({ configured, applicationsDir = APPLICATIONS_DIR, prefsDir = PREFS_DIR } = {}) {
    if (configured && fs.existsSync(configured)) {
        return { app: configured, version: appVersion(configured), why: 'configured' };
    }
    const lives = installedLives(applicationsDir);
    if (lives.length === 0) return null;
    const used = lastUsedVersion(prefsDir);
    const match = used && lives.find((l) => l.version === used);
    if (match) return { ...match, why: 'last used' };
    const newest = [...lives].sort((a, b) => compareVersions(b.version, a.version))[0];
    return { ...newest, why: 'newest installed' };
}

/** The config with this Mac's local file over it, or {} when it can't be read. */
function readConstants() {
    try {
        return require('../interface/bridge/utils/constants').loadConstants();
    } catch {
        return {};
    }
}

module.exports = { findLiveApp, compareVersions };

if (require.main === module) {
    const live = findLiveApp({ configured: readConstants().paths?.abletonApp });
    if (!live) {
        console.log('🎵 No Ableton Live in /Applications: install Live 12.4 Suite, then run npm run dev again.');
        process.exit(0);
    }
    console.log(`🎵 Opening ${path.basename(live.app, '.app')} (${live.why})...`);
    spawn('open', [live.app], { stdio: 'inherit' }).on('error', (error) => {
        console.warn(`⚠️  Could not open ${live.app}: ${error.message}`);
    });
}
