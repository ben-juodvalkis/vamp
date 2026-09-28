#!/usr/bin/env node
/**
 * The setup check: `npm run validate`, the first step of `npm run dev` and
 * `npm run ipad`, and the last of `npm run setup`.
 *
 * It fails (exit 1) only for what stops the app starting: Node too old, the
 * dependencies missing, a config that doesn't parse. Everything else is a
 * warning with the fix on the same line (general-release plan.md §2: a setup
 * check that guides instead of failing). Live's own settings are onboarding's
 * job, in Settings on the first run, where the app can see them done.
 *
 * There used to be a second check, `validate:constants`, which passed configs
 * this one failed. Neither loads config/constants.schema.json, which is for
 * the editor: it accepted the old example config, whose missing
 * `paths.waveformMaxBytes` failed the build.
 *
 * The config it checks is the tracked defaults with this Mac's
 * config/constants.local.json laid over them (general-release plan.md §3).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { findLiveApp, compareVersions } = require('./open-live.js');
const { loadConstants, CONSTANTS_PATH, LOCAL_PATH } = require('../interface/bridge/utils/constants');

const ROOT = path.resolve(__dirname, '..');
const SURFACE_DIR = path.join(ROOT, 'surface');
const INSTALL_SH = path.join(SURFACE_DIR, 'install.sh');

/** similar sounds use `node:sqlite`, unflagged in 22.13 (plan.md §2). */
const NODE_FLOOR = '22.13.0';
/** The release floor: Live 12.4 Suite (plan.md §8). */
const LIVE_FLOOR = '12.4';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(color, symbol, message) {
  console.log(`${color}${symbol}${colors.reset} ${message}`);
}

/** Dotted-quad, each octet 0-255. Not a reachability test — a shape test. */
function isIPv4(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** A config value, or '' when it is unset or still says TODO. */
function setting(config, key) {
  const value = key.split('.').reduce((obj, k) => obj?.[k], config);
  return typeof value === 'string' && !value.includes('TODO') ? value : '';
}

/** Live's User Library, found the way install.sh finds it (Library.cfg). */
function userLibrary() {
  const out = spawnSync('/bin/sh', [INSTALL_SH, '--print-user-library'], { encoding: 'utf8' });
  return out.status === 0 ? out.stdout.trim() : '';
}

function realpathOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** Where `Remote Scripts/Vamp` stands: linked here, elsewhere, under the old name, or not at all. */
function surfaceLink(library) {
  const scripts = path.join(library, 'Remote Scripts');
  const here = realpathOrNull(SURFACE_DIR);
  const vamp = realpathOrNull(path.join(scripts, 'Vamp'));
  if (vamp && vamp === here) return { state: 'ok', at: path.join(scripts, 'Vamp') };
  if (vamp) return { state: 'elsewhere', at: vamp };
  const legacy = realpathOrNull(path.join(scripts, 'Looping'));
  if (legacy && legacy.endsWith('/looping-surface')) return { state: 'old name', at: legacy };
  return { state: 'missing', at: path.join(scripts, 'Vamp') };
}

function checkSetup() {
  console.log(`\n${colors.cyan}🔍 Checking setup...${colors.reset}\n`);
  let failed = false;
  let warned = false;
  const fail = (message) => {
    log(colors.red, '❌', message);
    failed = true;
  };
  const warn = (message) => {
    log(colors.yellow, '⚠️', message);
    warned = true;
  };
  const ok = (message) => log(colors.green, '✅', message);

  // Node
  const node = process.versions.node;
  if (compareVersions(node, NODE_FLOOR) < 0) {
    fail(`Node ${node}: Vamp needs ${NODE_FLOOR} or later. Install it from nodejs.org, then run npm run setup.`);
  } else {
    ok(`Node ${node}`);
  }

  // Dependencies
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'concurrently'))) {
    fail('Dependencies are not installed: run npm run setup.');
  }

  // Config: the tracked defaults, and this Mac's local file over them
  let config;
  for (const file of [CONSTANTS_PATH, LOCAL_PATH]) {
    const name = `config/${path.basename(file)}`;
    if (file === LOCAL_PATH && !fs.existsSync(file)) {
      log(colors.dim, '⚪', `No ${name}: the general edition's settings. A Mac's own go there.`);
      continue;
    }
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      fail(`${name}: ${error.code === 'ENOENT' ? 'missing' : error.message}`);
      return report(failed, warned);
    }
    if (file === LOCAL_PATH) ok(`${name} is laid over the defaults`);
  }
  config = loadConstants();
  const missing = ['paths', 'osc', 'network', 'http'].filter((k) => !config[k]);
  if (missing.length) {
    fail(`The config has no ${missing.join(', ')} section: the bridge reads each at startup.`);
  }

  // Live
  const configuredLive = setting(config, 'paths.abletonApp');
  const live = findLiveApp({ configured: configuredLive });
  if (!live) {
    warn(`No Ableton Live in /Applications: install Live ${LIVE_FLOOR} Suite or later.`);
  } else {
    const name = path.basename(live.app, '.app');
    if (live.version && compareVersions(live.version, LIVE_FLOOR) < 0) {
      warn(`${name} is ${live.version}: Vamp needs Live ${LIVE_FLOOR} or later.`);
    } else {
      ok(`Live: ${name}${live.version ? ` ${live.version}` : ''} (${live.why})`);
    }
    if (configuredLive && live.why !== 'configured') {
      log(colors.dim, '  ', `paths.abletonApp (${configuredLive}) is not on this Mac`);
    }
  }

  // The Remote Script
  const library = userLibrary();
  if (!library || !fs.existsSync(path.join(library, 'Presets'))) {
    warn("Live's User Library not found: open Live once, then run npm run setup.");
  } else {
    const link = surfaceLink(library);
    if (link.state === 'ok') ok(`Control surface: ${link.at}`);
    else if (link.state === 'elsewhere') warn(`Remote Scripts/Vamp is another checkout's (${link.at}): npm run setup links this one.`);
    else if (link.state === 'old name') warn("The surface is linked under its old name, Looping: npm run setup renames it to Vamp.");
    else warn('The control surface is not installed: run npm run setup.');
  }

  // A Mac's own paths, when its local file names them
  for (const key of ['paths.effectPresetsBase', 'paths.instrumentsBase']) {
    const value = setting(config, key);
    if (value && !fs.existsSync(value)) warn(`${key} is not on this Mac: ${value}`);
  }
  for (const key of ['network.ipad.wifi', 'network.ipad.usbc']) {
    const value = setting(config, key);
    if (value && !isIPv4(value)) warn(`${key}: ${value} is not an IPv4 address`);
  }

  return report(failed, warned);
}

function report(failed, warned) {
  console.log('');
  if (failed) {
    log(colors.red, '❌', 'Setup incomplete: fix the ❌ lines above.\n');
    return false;
  }
  if (warned) log(colors.yellow, '⚠️', 'Setup has warnings (above). None of them stops Vamp starting.\n');
  else log(colors.green, '✅', 'Setup looks right.\n');
  return true;
}

if (require.main === module) {
  process.exit(checkSetup() ? 0 : 1);
}

module.exports = { checkSetup, surfaceLink };
