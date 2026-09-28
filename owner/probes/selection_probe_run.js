#!/usr/bin/env node
/**
 * Selection-capability probe driver — one-shot operator script.
 *
 * Sends ``/looping/probe/selection [clip_path]`` to the Python surface
 * and prints the single ``/looping/probe/selection_result
 * [clip_path, ok, detail]`` reply. The verdict comes from Live via
 * SelectionProbe (read-only introspection of Clip.View's note-selection
 * surface); this script only orchestrates.
 *
 * What it answers
 * ---------------
 *
 * Before building bidirectional note selection (tap-a-note-in-editor →
 * select-in-Live, and Live's selection → editor), we need to know what
 * the LOM exposes on Live 12.4: a by-id select call, a way to read the
 * current selection, and a selection-changed listener. The probe dumps
 * the full ``clip.view`` dir + the candidate selection attrs to
 * ``Log.txt`` and returns a compact verdict. NON-DESTRUCTIVE — it reads
 * only, never mutates notes or selection.
 *
 * Why not through the bridge?
 * ---------------------------
 *
 * Same as note_edit_probe_run.js: bind an ephemeral port and rely on the
 * surface's last-sender-wins reply rule (osc_transport.py), so this runs
 * independently of ``npm run dev`` and needs no backendScope entry.
 *
 * Usage
 * -----
 *
 *   node owner/probes/selection_probe_run.js [clip_path] [--json]
 *
 * No clip_path → the surface targets ``song.view.detail_clip``. Open a
 * MIDI clip in Live's Detail/Clip view first (select a note or two in
 * Live to see selected_count reflect it).
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

const PROBE_ADDRESS = '/looping/probe/selection';
const RESULT_ADDRESS = '/looping/probe/selection_result';
const PROBE_TIMEOUT_MS = 8000;


function loadConstants() {
  return JSON.parse(fs.readFileSync(CONSTANTS_PATH, 'utf8'));
}


function sendProbe(udpPort, clipPath) {
  return new Promise((resolve) => {
    const onMessage = (oscMsg) => {
      if (oscMsg.address !== RESULT_ADDRESS) return;
      const [replyPath, ok, detail] = oscMsg.args.map((a) => a.value);
      udpPort.off('message', onMessage);
      clearTimeout(timer);
      resolve({
        clipPath: replyPath,
        ok: Number(ok) === 1,
        detail,
        timedOut: false,
      });
    };

    const timer = setTimeout(() => {
      udpPort.off('message', onMessage);
      resolve({
        clipPath,
        ok: false,
        detail: 'timeout (no reply in ' + PROBE_TIMEOUT_MS + 'ms)',
        timedOut: true,
      });
    }, PROBE_TIMEOUT_MS);

    udpPort.on('message', onMessage);
    udpPort.send({
      address: PROBE_ADDRESS,
      args: [{ type: 's', value: clipPath }],
    });
  });
}


async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const clipPath = argv.find((a) => !a.startsWith('--')) || '';

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
      `selection_probe: bound ephemeral port ${bound.port}; probing ` +
      `surface at ${surfaceHost}:${surfaceRecvPort}\n`,
    );
    process.stderr.write(
      `selection_probe: target = ${clipPath || '<focused detail_clip>'}\n`,
    );
  }

  const result = await sendProbe(udpPort, clipPath);
  udpPort.close();

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  process.stdout.write('\n');
  process.stdout.write(`verdict: ${result.ok ? 'PASS' : 'FAIL'}\n`);
  process.stdout.write(`detail:  ${result.detail}\n`);
  process.stdout.write(
    '\n(full clip.view dir dumped to Live\'s Log.txt — grep "SelectionProbe DUMP")\n',
  );
  if (result.timedOut) {
    process.stdout.write(
      '\nNo reply. Is Live open with the Looping surface started and a ' +
      'MIDI clip in the Detail view?\n',
    );
  }
}


main().catch((err) => {
  process.stderr.write(
    `selection_probe driver failed: ${err && err.stack || err}\n`,
  );
  process.exit(1);
});
