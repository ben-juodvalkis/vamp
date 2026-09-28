#!/usr/bin/env node
/**
 * Gate 4a driver — one-shot operator script for [06 §1.2].
 *
 * Sends ``/looping/probe/browser_load [asset_class, hint]`` for each
 * of the six asset classes in the risk doc's table, collects the
 * replies on ``/looping/probe/browser_result``, and prints a markdown
 * table ready to paste into 06 §1.2. The verdicts come out of Live
 * itself — this script only orchestrates.
 *
 * Why not through the bridge?
 * ---------------------------
 *
 * The bridge's ``pythonSurface`` UDP port is bound to 11021 for
 * normal operation, so a second binder on that port would fail with
 * ``EADDRINUSE`` (or silently steal packets, depending on platform).
 * Going around the bridge means we don't need to shut ``npm run dev``
 * down — the feedback memory ``feedback_npm_run_dev_process_tree``
 * calls this out explicitly as a failure mode to avoid — and we
 * don't need to add ``/looping/probe/*`` to ``backendScope``
 * permanently when it's an internal diagnostic.
 *
 * The surface's transport last-sender-wins reply rule ([osc_transport.py
 * line 181]) means a message sent from our ephemeral port to 11020
 * gets its reply delivered straight back to us, bypassing the
 * bridge entirely. This is the same trick AbletonOSC's tests use.
 *
 * Usage
 * -----
 *
 *   node owner/probes/gate4a_run.js [--json]
 *
 * Prerequisites:
 *
 *  - Ableton Live is open with the ``Looping`` Control Surface
 *    enabled and a **MIDI or audio track selected**. The probe
 *    loads onto the selected track — without a selection the six
 *    probes all emit ``no_selected_track``.
 *  - The surface has started. Gate 1's heartbeat is the usual way
 *    to confirm; running this script while Live is still loading
 *    will time out on every probe.
 *  - ``npm run dev`` may be running or not; the script is
 *    independent of it.
 *
 * The asset hints are read from ``fixtures/gate4a_assets.json`` so
 * the list isn't hard-coded in this script. If your machine doesn't
 * have one of the classes installed, delete its entry from the
 * fixture and the script skips it (and 06 §1.2's table reads ``n/a``
 * for that row).
 */

const path = require('path');
const fs = require('fs');
const osc = require(path.join(
  __dirname,
  '..', '..',
  'node_modules', 'osc',
));

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CONSTANTS_PATH = path.join(PROJECT_ROOT, 'config', 'constants.json');
const ASSETS_PATH = path.join(__dirname, 'gate4a_assets.json');

// How long to wait per probe before giving up. User Library presets
// (.adv, .adg) come back in well under a second; ``.amxd`` takes
// ~3s on a cold Max host because the amxd process spins up on
// first use. AU and VST3 plugins can take 10+ seconds on first
// load of a session because Live validates the plugin bundle and
// waits for parameter discovery. The per-class override below
// covers plugins; everything else gets the generous default so
// Max warm-up doesn't mask a real pass as a timeout.
const DEFAULT_PROBE_TIMEOUT_MS = 8000;
const PLUGIN_PROBE_TIMEOUT_MS = 20000;
const PLUGIN_CLASSES = new Set(['au', 'vst3']);

// Gap between probes. Tuned generously because a slow load from
// probe N can still be settling when probe N+1's snapshot is taken.
// The surface is single-threaded, so the surface's own verify window
// is the real bottleneck, not concurrent I/O.
const INTER_PROBE_DELAY_MS = 800;


function loadConstants() {
  return JSON.parse(fs.readFileSync(CONSTANTS_PATH, 'utf8'));
}


function loadAssets() {
  if (!fs.existsSync(ASSETS_PATH)) {
    throw new Error(
      `Missing ${ASSETS_PATH}. Copy gate4a_assets.example.json and edit ` +
      `it to point at real files on this machine.`,
    );
  }
  return JSON.parse(fs.readFileSync(ASSETS_PATH, 'utf8'));
}


function sendProbe(udpPort, assetClass, hint) {
  const timeoutMs = PLUGIN_CLASSES.has(assetClass)
    ? PLUGIN_PROBE_TIMEOUT_MS
    : DEFAULT_PROBE_TIMEOUT_MS;
  return new Promise((resolve) => {
    const onMessage = (oscMsg) => {
      if (oscMsg.address !== '/looping/probe/browser_result') return;
      const [cls, ok, detail] = oscMsg.args.map((a) => a.value);
      if (cls !== assetClass) return; // reply for a different probe
      udpPort.off('message', onMessage);
      clearTimeout(timer);
      resolve({ ok: Number(ok) === 1, detail, timedOut: false });
    };

    const timer = setTimeout(() => {
      udpPort.off('message', onMessage);
      resolve({
        ok: false,
        detail: 'timeout (no reply in ' + timeoutMs + 'ms)',
        timedOut: true,
      });
    }, timeoutMs);

    udpPort.on('message', onMessage);
    udpPort.send({
      address: '/looping/probe/browser_load',
      args: [
        { type: 's', value: assetClass },
        { type: 's', value: hint },
      ],
    });
  });
}


function formatRow(assetClass, result) {
  if (result === null) return `| ${assetClass} | n/a | not configured in gate4a_assets.json |`;
  const verdict = result.ok ? '✓' : '✗';
  // Tables in markdown don't love pipes in content; strip them.
  const safeDetail = result.detail.replace(/\|/g, '/');
  return `| ${assetClass} | ${verdict} | ${safeDetail} |`;
}


async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');

  const constants = loadConstants();
  const surfaceHost = constants.osc.pythonSurface.host || '127.0.0.1';
  const surfaceRecvPort = constants.osc.pythonSurface.remotePort; // surface binds here

  const assets = loadAssets();

  // Bind to an ephemeral port. The surface will see our source
  // address on the incoming packet and reply there (per osc_transport.py
  // line 181's "last-sender-wins" handling). localPort:0 asks the
  // kernel for a free port; see UDPPort docs.
  const udpPort = new osc.UDPPort({
    localAddress: '0.0.0.0',
    localPort: 0,
    remoteAddress: surfaceHost,
    remotePort: surfaceRecvPort,
  });

  await new Promise((resolve, reject) => {
    udpPort.on('ready', resolve);
    udpPort.on('error', reject);
    udpPort.open();
  });

  const bound = udpPort.socket.address();
  if (!asJson) {
    process.stderr.write(
      `gate4a: bound ephemeral port ${bound.port}; probing ` +
      `surface at ${surfaceHost}:${surfaceRecvPort}\n`,
    );
  }

  // The fixture file declares which asset classes to attempt and a
  // path/name hint per class. Any class present with a non-null
  // hint runs; classes explicitly set to null are skipped and come
  // out ``n/a`` in the final table.
  const classes = ['adv', 'adg', 'amxd', 'au', 'vst3', 'sample'];
  const results = {};

  for (const cls of classes) {
    const hint = assets[cls];
    if (hint == null) {
      results[cls] = null;
      if (!asJson) process.stderr.write(`gate4a: ${cls} — skipped\n`);
      continue;
    }
    if (!asJson) process.stderr.write(`gate4a: ${cls} — probing ${hint}\n`);
    // eslint-disable-next-line no-await-in-loop -- serialise by design
    const result = await sendProbe(udpPort, cls, hint);
    results[cls] = result;
    if (!asJson) {
      process.stderr.write(
        `gate4a: ${cls} — ${result.ok ? 'pass' : 'fail'} (${result.detail})\n`,
      );
    }
    // eslint-disable-next-line no-await-in-loop -- intentional pacing
    await new Promise((r) => setTimeout(r, INTER_PROBE_DELAY_MS));
  }

  udpPort.close();

  if (asJson) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }

  process.stdout.write('\n');
  process.stdout.write('| Asset class | Loads from Python? | Notes |\n');
  process.stdout.write('|---|---|---|\n');
  for (const cls of classes) {
    process.stdout.write(formatRow(cls, results[cls]) + '\n');
  }
}


main().catch((err) => {
  process.stderr.write(`gate4a driver failed: ${err && err.stack || err}\n`);
  process.exit(1);
});
