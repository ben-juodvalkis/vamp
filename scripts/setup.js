#!/usr/bin/env node
/**
 * `npm run setup`: a fresh clone to a working install, in one command
 * (general-release plan.md §2).
 *
 *   1. Node new enough, checked before `npm install` rather than after it.
 *   2. `npm install`: the root and both workspaces (interface, bridge).
 *   3. The control surface linked into Live's User Library as Vamp
 *      (surface/install.sh). macOS only.
 *   4. The setup check (scripts/validate-setup.js), which `npm run dev` also
 *      runs first.
 *
 * What's left happens in Live and in the app: pick Vamp as a Control
 * Surface, then `npm run dev`, whose first run opens Settings as a checklist
 * (onboarding.plan.md §7). Nothing here writes the config.
 *
 * Only Node's own modules, so it runs before anything is installed. Safe to
 * run again: each step is idempotent.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const { compareVersions } = require('./open-live.js');

const ROOT = path.resolve(__dirname, '..');
const NODE_FLOOR = '22.13.0';

function step(title) {
    console.log(`\n▶ ${title}`);
}

function run(command, args) {
    const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
    return result.status ?? 1;
}

if (compareVersions(process.versions.node, NODE_FLOOR) < 0) {
    console.error(`❌ Node ${process.versions.node}: Vamp needs ${NODE_FLOOR} or later. Install it from nodejs.org, then run npm run setup again.`);
    process.exit(1);
}

step('Installing dependencies');
if (run('npm', ['install', '--no-audit', '--no-fund']) !== 0) {
    console.error('\n❌ npm install failed (above). Fix that, then run npm run setup again.');
    process.exit(1);
}

step('Linking the control surface into Live');
if (process.platform !== 'darwin') {
    console.log('Skipped: Live and its Remote Scripts are on the Mac.');
} else if (run('/bin/sh', [path.join(ROOT, 'surface', 'install.sh')]) !== 0) {
    console.log('The surface is not linked yet (above); the check below says what to do.');
}

step('Checking the setup');
const checked = run(process.execPath, [path.join(__dirname, 'validate-setup.js')]);

console.log('Next:');
console.log('  1. In Live → Settings → Link, Tempo & MIDI, pick Vamp as a Control Surface,');
console.log('     then quit and reopen Live. Output stays None; Input stays None too,');
console.log("     unless a pedal is on USB: then Input is the pedal's port, with that port's");
console.log('     Track and Remote switches off in the MIDI Ports list.');
console.log('  2. npm run dev. The first run opens Settings on the Mac as a checklist.\n');
process.exit(checked);
