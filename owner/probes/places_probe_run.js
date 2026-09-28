#!/usr/bin/env node
/**
 * Places-probe driver — ROW 3 of 10-cleanup-plan.md.
 *
 * Two probes in one run:
 *
 *   1. ``/looping/probe/places_dump`` — enumerates
 *      ``browser.user_folders`` (Ableton sidebar "Places") and prints
 *      the tree so we can see what Python can actually reach.
 *   2. ``/looping/probe/places_load [hint]`` — optional. Attempts a
 *      live ``Browser.load_item()`` on a named leaf against the
 *      currently-selected track. Pass ``--load <hint>`` to run it.
 *
 * Same direct-to-surface transport trick as gate4a_run.js: ephemeral
 * UDP socket → surface recv port (11020 from constants.json) →
 * last-sender-wins reply comes back to our socket, bypassing the
 * bridge. Runs fine with ``npm run dev`` up.
 *
 * Usage
 * -----
 *
 *   # Dump Places tree only:
 *   node owner/probes/places_probe_run.js
 *
 *   # Dump + attempt a load:
 *   node owner/probes/places_probe_run.js \
 *     --load Permute.amxd
 *
 *   # JSON output (for scripting):
 *   node owner/probes/places_probe_run.js --json
 *
 * Prereqs: Live open, Looping surface enabled. A track must be
 * selected if you pass ``--load`` (without a selection the load probe
 * emits ``no_selected_track``).
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

const DUMP_TIMEOUT_MS = 5000;
// Load verify takes ~800ms on the surface side; add headroom for
// Max/amxd cold-spin if the leaf is a Max device.
const LOAD_TIMEOUT_MS = 8000;


function loadConstants() {
  return JSON.parse(fs.readFileSync(CONSTANTS_PATH, 'utf8'));
}


function sendDump(udpPort) {
  return new Promise((resolve) => {
    const onMessage = (oscMsg) => {
      if (oscMsg.address !== '/looping/probe/places_dump_result') return;
      const [exists, topCount, body, detail] = oscMsg.args.map((a) => a.value);
      udpPort.off('message', onMessage);
      clearTimeout(timer);
      resolve({
        exists: Number(exists) === 1,
        topCount: Number(topCount),
        body: String(body || ''),
        detail: String(detail || ''),
        timedOut: false,
      });
    };
    const timer = setTimeout(() => {
      udpPort.off('message', onMessage);
      resolve({
        exists: false,
        topCount: 0,
        body: '',
        detail: 'timeout (' + DUMP_TIMEOUT_MS + 'ms)',
        timedOut: true,
      });
    }, DUMP_TIMEOUT_MS);

    udpPort.on('message', onMessage);
    udpPort.send({ address: '/looping/probe/places_dump', args: [] });
  });
}


function sendLoad(udpPort, hint) {
  return new Promise((resolve) => {
    const onMessage = (oscMsg) => {
      if (oscMsg.address !== '/looping/probe/places_load_result') return;
      const [ok, detail] = oscMsg.args.map((a) => a.value);
      udpPort.off('message', onMessage);
      clearTimeout(timer);
      resolve({
        ok: Number(ok) === 1,
        detail: String(detail || ''),
        timedOut: false,
      });
    };
    const timer = setTimeout(() => {
      udpPort.off('message', onMessage);
      resolve({
        ok: false,
        detail: 'timeout (' + LOAD_TIMEOUT_MS + 'ms)',
        timedOut: true,
      });
    }, LOAD_TIMEOUT_MS);

    udpPort.on('message', onMessage);
    udpPort.send({
      address: '/looping/probe/places_load',
      args: [{ type: 's', value: hint }],
    });
  });
}


function formatTree(body) {
  if (!body) return '  (empty)\n';
  // Each row is ``depth\tname\tis_loadable``; print with indent.
  return body
    .split('\n')
    .map((row) => {
      const parts = row.split('\t');
      const depth = parseInt(parts[0], 10) || 0;
      const name = parts[1] || '?';
      const loadable = parts[2] === '1' ? '  [loadable]' : '';
      return '  ' + '  '.repeat(depth) + '- ' + name + loadable;
    })
    .join('\n') + '\n';
}


async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  let loadHint = null;
  const loadIdx = argv.indexOf('--load');
  if (loadIdx !== -1 && loadIdx + 1 < argv.length) {
    loadHint = argv[loadIdx + 1];
  }

  const constants = loadConstants();
  const surfaceHost = constants.osc.pythonSurface.host || '127.0.0.1';
  const surfaceRecvPort = constants.osc.pythonSurface.remotePort;

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
      'places_probe: bound ephemeral port ' + bound.port + '; probing ' +
      surfaceHost + ':' + surfaceRecvPort + '\n',
    );
  }

  const dump = await sendDump(udpPort);
  let load = null;
  if (loadHint) {
    if (!asJson) {
      process.stderr.write('places_probe: loading ' + loadHint + '\n');
    }
    load = await sendLoad(udpPort, loadHint);
  }

  udpPort.close();

  if (asJson) {
    process.stdout.write(JSON.stringify({ dump, load }, null, 2) + '\n');
    return;
  }

  process.stdout.write('\n=== browser.user_folders ===\n');
  process.stdout.write(
    'exists: ' + (dump.exists ? 'yes' : 'no') + '\n' +
    'top-level Places: ' + dump.topCount + '\n' +
    'detail: ' + dump.detail + '\n\n',
  );
  process.stdout.write('tree:\n');
  process.stdout.write(formatTree(dump.body));

  if (load) {
    process.stdout.write('\n=== load attempt ===\n');
    process.stdout.write('hint: ' + loadHint + '\n');
    process.stdout.write(
      'verdict: ' + (load.ok ? 'pass' : 'fail') + '\n' +
      'detail: ' + load.detail + '\n',
    );
  }
}


main().catch((err) => {
  process.stderr.write('places_probe driver failed: ' + (err && err.stack || err) + '\n');
  process.exit(1);
});
