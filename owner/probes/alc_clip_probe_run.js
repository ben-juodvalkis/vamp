#!/usr/bin/env node
/**
 * AlcClipProbe driver — one-shot operator script.
 *
 * Answers: does loading an ``.alc`` via Live's Browser into the selected
 * track's first empty clip slot preserve the clip's warp/loop/gain/pitch
 * metadata? Sends ``/looping/probe/alc_clip_load [alc_path]`` and prints the
 * ``/looping/probe/alc_clip_result [ok, detail]`` reply. The verdict comes
 * out of Live itself — this script only orchestrates.
 *
 * Goes around the bridge (ephemeral port → surface recv port) for the same
 * reasons as gate4a_run.js: no EADDRINUSE on the bridge's UDP port, no need
 * to stop ``npm run dev``, and the surface's last-sender-wins reply rule
 * delivers the result straight back to us.
 *
 * Usage:
 *
 *   node owner/probes/alc_clip_probe_run.js "<abs path to .alc>"
 *
 * Prerequisites:
 *   - Ableton Live open, ``Looping`` Control Surface enabled.
 *   - A MIDI or **audio** track selected with at least one EMPTY clip slot
 *     (the probe loads into the first empty slot; it won't clobber a clip).
 *   - The surface has started (Gate 1 heartbeat seen).
 *   - The ``.alc`` must live under the User Library (the probe resolves via
 *     BrowserCache's User-Library path; Places are deliberately not walked).
 *
 * If no path is given, a default Forge clip is used.
 */

const path = require('path');
const fs = require('fs');
const osc = require(path.join(__dirname, '..', '..', 'node_modules', 'osc'));

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CONSTANTS_PATH = path.join(PROJECT_ROOT, 'config', 'constants.json');

const DEFAULT_ALC =
  '/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/User Library/' +
  'Looping Presets/Audio Samples/Drum/Packs/The Forge by Hecq/Clips/' +
  'Coil Loops/01_MacBook1.alc';

// The clip load can trigger a Browser resolution + Live clip creation;
// give it a generous window before declaring a timeout.
const PROBE_TIMEOUT_MS = 12000;

function loadConstants() {
  return JSON.parse(fs.readFileSync(CONSTANTS_PATH, 'utf8'));
}

function sendProbe(udpPort, alcPath) {
  return new Promise((resolve) => {
    const onMessage = (oscMsg) => {
      if (oscMsg.address !== '/looping/probe/alc_clip_result') return;
      const [ok, detail] = oscMsg.args.map((a) => a.value);
      udpPort.off('message', onMessage);
      clearTimeout(timer);
      resolve({ ok: Number(ok) === 1, detail, timedOut: false });
    };
    const timer = setTimeout(() => {
      udpPort.off('message', onMessage);
      resolve({
        ok: false,
        detail: 'timeout (no reply in ' + PROBE_TIMEOUT_MS + 'ms)',
        timedOut: true,
      });
    }, PROBE_TIMEOUT_MS);

    udpPort.on('message', onMessage);
    udpPort.send({
      address: '/looping/probe/alc_clip_load',
      args: [{ type: 's', value: alcPath }],
    });
  });
}

async function main() {
  const alcPath = process.argv[2] || DEFAULT_ALC;

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
  process.stderr.write(
    `alc-clip-probe: bound ephemeral port ${bound.port}; probing surface at ` +
    `${surfaceHost}:${surfaceRecvPort}\n`,
  );
  process.stderr.write(`alc-clip-probe: loading ${alcPath}\n`);

  const result = await sendProbe(udpPort, alcPath);
  udpPort.close();

  process.stdout.write('\n');
  process.stdout.write(`ok:     ${result.ok ? '✓ clip landed' : '✗'}\n`);
  process.stdout.write(`detail: ${result.detail}\n`);
}

main().catch((err) => {
  process.stderr.write(`alc-clip-probe driver failed: ${err && err.stack || err}\n`);
  process.exit(1);
});
