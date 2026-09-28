#!/usr/bin/env node
/**
 * Open the owner's standalone Max patch — only while `features.maxUtilityPatch`
 * is on (general-release audit §7b).
 *
 * The patch carries the owner's hardware (Ableton Move, the piano-pedal
 * looper on CC 67, SoftStep/EV-1). On any other Mac it switches Max's audio
 * on at load and its omni `ctlin` turns a piano's soft pedal into looper
 * taps, so a general edition never opens it.
 *
 * The switch is read through the bridge's own reader, so "only an explicit
 * true is on" means the same thing here as there.
 *
 * `npm run dev` runs this as `open:max`; `scripts/setup-ipad.js` requires it.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { readFeatureFlags } = require('../interface/bridge/utils/features');

const MAX_PATCH_PATH = path.join(__dirname, '..', 'owner', 'Max Patches', 'Max Utility 1.0.maxpat');

/** @param {Object} constants the parsed constants.json */
function maxPatchEnabled(constants) {
    return readFeatureFlags(constants, console).maxUtilityPatch === true;
}

module.exports = { MAX_PATCH_PATH, maxPatchEnabled };

if (require.main === module) {
    const constants = require('../interface/bridge/utils/constants').loadConstants();
    if (!maxPatchEnabled(constants)) {
        console.log('🎛️  Max Utility patch not opened (features.maxUtilityPatch is off)');
        process.exit(0);
    }
    console.log('🎛️  Opening Max Utility patch...');
    spawn('open', [MAX_PATCH_PATH], { stdio: 'inherit' })
        .on('error', (error) => console.error('Could not open the Max Utility patch', error.message))
        .on('exit', (code) => process.exit(code ?? 0));
}
