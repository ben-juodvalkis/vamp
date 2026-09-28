#!/usr/bin/env node

const { spawn } = require('child_process');
const { displayInterfaces, getBestIPadIP } = require('./detect-interfaces.js');
const { createStatusPage } = require('./create-status-page.js');
const { MAX_PATCH_PATH, maxPatchEnabled } = require('./open-max-patch.js');
const { findLiveApp } = require('./open-live.js');
const { readFeatureFlags } = require('../interface/bridge/utils/features');
const fs = require('fs');
const path = require('path');

// The config, with this Mac's constants.local.json laid over it.
const { loadConstants } = require('../interface/bridge/utils/constants');
const constants = loadConstants();

/**
 * Minimum gap between launching Live and opening the Max Utility patch. Max has
 * to initialize against a running Live; everything else about the old startup's
 * fixed sleeps is gone, but this ordering constraint is real.
 */
const MAX_PATCH_MIN_DELAY_MS = constants.timing?.startup?.maxPatchMinDelayAfterLiveMs ?? 4000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fire-and-forget GUI launch — detached and unref'd so it never joins our process tree.
 *
 * The `'error'` listener is load-bearing, not defensive dressing: `spawn()`
 * reports a missing or non-executable command via an asynchronous `'error'`
 * event, never by throwing, so the try/catch alone would let ENOENT through —
 * and an unhandled `'error'` on an EventEmitter takes down the process. These
 * launches now run at t=0, ahead of prep and the servers, so one bad path (the
 * browser blocker below is another repo's script and need not exist) would
 * otherwise abort the whole startup having started nothing.
 */
function launch(command, args, label) {
    if (label) console.log(label);
    try {
        const child = spawn(command, args, { stdio: 'ignore', detached: true });
        child.on('error', (error) => {
            console.warn(`⚠️  Failed to launch ${command}: ${error.message}`);
        });
        child.unref();
    } catch (error) {
        // Synchronous throws only (bad argument types); ENOENT arrives above.
        console.warn(`⚠️  Failed to launch ${command}: ${error.message}`);
    }
}

/**
 * Everything that does NOT depend on the Vite build, started at t=0.
 *
 * This is the whole point of the reordering. Live's own cold start is tens of
 * seconds, and it used to begin only *after* the build finished and a 4s timer
 * elapsed — so a ~40s build and a ~30s Live launch ran back to back. Nothing
 * about Live, the browser blocker or the menu-bar agent reads the build output,
 * so they all start now and boot underneath it.
 *
 * @returns {number} the timestamp Live was launched at, for the Max-patch floor
 */
function launchPerformanceApps() {
    console.log('🎛️  Launching performance apps (in parallel with the build)...\n');

    // Live first: it is the slowest to boot and the Max patch is timed off it.
    const live = findLiveApp({ configured: constants.paths?.abletonApp });
    if (live) {
        launch('open', [live.app], `🎵 Opening ${path.basename(live.app, '.app')} (${live.why})...`);
    } else {
        console.log('🎵 No Ableton Live in /Applications: install Live 12.4 Suite.');
    }
    const abletonLaunchedAt = Date.now();

    // The owner's browser blocker keeps focus during performance: another
    // repo's script, run only where `paths.browserBlocker` names it.
    // Skip with: SKIP_BROWSER_BLOCKER=1 npm run ipad
    const blocker = constants.paths?.browserBlocker;
    if (blocker && process.env.SKIP_BROWSER_BLOCKER) {
        console.log('🔓 Browser blocker skipped (SKIP_BROWSER_BLOCKER=1)');
    } else if (blocker) {
        launch(blocker, ['start'], '🔒 Starting browser blocker...');
    }

    // Menu-bar utility (owner/menubar). Detached + unref'd — a fire-and-forget
    // GUI agent like Safari/Ableton, NOT a concurrently peer: it must not sit
    // under the bridge/preview restart policy (a menu-bar agent that exits 0
    // would churn-restart and can drag the servers down). The launcher no-ops
    // cleanly without a Swift toolchain.
    // Only while features.menubar is on (the owner's). Skip with: SKIP_MENUBAR=1 npm run ipad
    if (!process.env.SKIP_MENUBAR && readFeatureFlags(constants).menubar) {
        launch(path.join(__dirname, 'launch-menubar.sh'), [], '📎 Launching menu-bar utility...');
    }

    console.log('');
    return abletonLaunchedAt;
}

/**
 * Everything that has to wait for the preview server to be listening on :8889.
 */
async function announceReady(abletonLaunchedAt) {
    console.log('\n' + '='.repeat(70));
    console.log('🎉 Vamp is serving the iPad app');

    // Status page — await the actual bind rather than sleeping and hoping.
    const { ready } = createStatusPage();

    console.log('\n📄 iPad Status Page (Prominent URL Display):');
    console.log('   🌐 Opening in browser: http://localhost:8890/');
    console.log('   📱 Large, prominent iPad URLs with copy-to-clipboard');
    console.log('   🔄 Auto-refreshes every 30 seconds');

    await ready;

    const bestIP = getBestIPadIP();
    launch('open', ['-a', 'Safari', 'http://localhost:8890/']);
    launch('open', ['-a', 'Safari', `http://${bestIP}:8889`]);

    console.log('\n📱 iPad Setup Instructions:');
    console.log('   1. Connect iPad via USB-C (recommended)');
    console.log('   2. Live opens by itself; this Mac shows a status page with the addresses');
    console.log('   3. Once: pick Vamp as a Control Surface in Live → Settings → Link, Tempo & MIDI');
    console.log('   4. Use status page URLs for iPad Safari connection:');

    displayInterfaces(8889);

    if (bestIP === 'localhost') {
        console.log('\n📵 No address an iPad can reach: connect it by USB-C, or join this Mac\'s Wi-Fi.');
    } else {
        console.log(`\n🎯 Open on the iPad: http://${bestIP}:8889`);
    }

    console.log(`\n   Bridge on port ${constants.osc.webSocket.port}, the iPad app on port 8889.`);
    console.log('   Settings → Connection on the page says whether Live has answered.');
    console.log('='.repeat(70) + '\n');

    // The owner's Max patch, only while `features.maxUtilityPatch` is on: a
    // general edition never opens Max (scripts/open-max-patch.js says why).
    if (!maxPatchEnabled(constants)) {
        console.log('🎛️  Max Utility patch not opened (features.maxUtilityPatch is off)');
        return;
    }

    // The Max patch is the one thing still on a clock, and it's measured from
    // Live's launch rather than from here. On a cold start the build has already
    // covered the gap and this is zero; on a warm start (build skipped) it still
    // holds the ordering.
    const elapsed = Date.now() - abletonLaunchedAt;
    const remaining = Math.max(0, MAX_PATCH_MIN_DELAY_MS - elapsed);
    if (remaining > 0) {
        console.log(`⏳ Holding ${remaining}ms for Live to initialize before opening Max...`);
        await wait(remaining);
    }
    launch('open', [MAX_PATCH_PATH], '🎛️  Opening Max Utility patch...');
}

/**
 * Prepare the interface: the Vite build, both ends
 * fingerprint-gated (scripts/staleness.mjs) so an unchanged tree costs ~1s
 * instead of ~40s.
 *
 * Run here rather than as a leg of `setup-ipad-core`'s concurrently, which
 * carries `--restart-tries -1` for the servers: a failing build on that leg
 * would be retried forever instead of reported once.
 *
 * @returns {Promise<number>} exit code
 */
function prepareInterface() {
    return new Promise((resolve) => {
        const child = spawn('npm', ['run', 'prep:ipad'], { stdio: 'inherit', shell: true });
        child.on('close', (code) => resolve(code ?? 1));
        child.on('error', (error) => {
            console.error(`❌ Failed to run prep:ipad: ${error.message}`);
            resolve(1);
        });
    });
}

/**
 * Comprehensive iPad setup: launches the performance apps and the service stack
 * in parallel, then reports access URLs once the preview server is listening.
 */
async function setupiPad() {
    console.log('🚀 Starting comprehensive iPad setup...\n');

    // Step 1: Display initial network detection
    console.log('📡 Detecting network interfaces...');
    const initialInterfaces = displayInterfaces(8889);

    if (!initialInterfaces.usb && !initialInterfaces.wifi) {
        console.log('\n⚠️  Warning: No suitable network interface detected.');
        console.log('💡 Try connecting iPad via USB-C or ensure WiFi is active.');
        console.log('⏳ Setup will continue, check interfaces again after startup.\n');
    }

    // Step 2: Launch everything that doesn't need the build — Live, blocker,
    // menu bar. These boot underneath the build rather than after it.
    const abletonLaunchedAt = launchPerformanceApps();

    // Step 3: Prepare the interface. This is the only slow step left, and Live is
    // already booting underneath it. Both halves are fingerprint-gated, so an
    // unchanged tree falls through in about a second.
    console.log('📦 Preparing the iPad app...\n');
    const prepCode = await prepareInterface();
    if (prepCode !== 0) {
        console.error(`\n❌ Interface preparation failed (exit ${prepCode}). Not starting servers.`);
        console.error('   Fix the error above, then re-run: npm run ipad');
        process.exitCode = prepCode;
        return;
    }

    // Step 4: Start the service stack — bridge + preview, both under an infinite
    // restart policy for the length of the session.
    console.log('\n⚡ Starting COMPLETE SYSTEM setup...');
    console.log('🎵 Starting OSC bridge...');
    console.log('🖥️  Starting preview server on port 8889...\n');

    const setupProcess = spawn('npm', ['run', 'setup-ipad-core'], {
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: true
    });

    let previewStarted = false;

    setupProcess.stdout.on('data', (data) => {
        const output = data.toString();
        process.stdout.write(output);

        // Detect when the preview server starts. Guarded so a restart of the
        // preview leg (concurrently --restart-tries -1) doesn't re-run the
        // announcement and re-open Safari.
        if (!previewStarted && output.includes('Local:') && output.includes('8889')) {
            previewStarted = true;
            announceReady(abletonLaunchedAt).catch((error) => {
                console.error('⚠️  Post-startup step failed:', error.message);
            });
        }
    });

    setupProcess.stderr.on('data', (data) => {
        process.stderr.write(data);
    });

    setupProcess.on('close', (code) => {
        if (code === 0) {
            console.log('\n✅ iPad setup completed successfully.');
        } else {
            console.log(`\n❌ iPad setup exited with code ${code}`);
        }
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down iPad setup...');
        setupProcess.kill('SIGINT');
        process.exit(0);
    });
}

// CLI usage
if (require.main === module) {
    setupiPad().catch(console.error);
}

module.exports = { setupiPad };
