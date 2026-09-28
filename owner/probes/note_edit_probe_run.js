#!/usr/bin/env node
/**
 * Note-edit capability probe driver — one-shot operator script.
 *
 * Sends ``/looping/probe/note_edit [clip_path]`` to the Python surface
 * and prints the single ``/looping/probe/note_edit_result
 * [clip_path, ok, detail]`` reply. The verdict comes from Live itself
 * via NoteEditProbe; this script only orchestrates.
 *
 * What it answers
 * ---------------
 *
 * The clip-view-mirror plan's M4 wants to edit MIDI notes by stable
 * ``note_id`` (apply_note_modifications / remove_notes_by_id /
 * add_new_notes), not the clear-and-rewrite the transpose handler
 * uses. ClipNotesComponent's docstring claims
 * ``apply_note_modifications`` "can't change pitch"; Permute (sibling
 * M4L device) contradicts that. This probe settles it on the *Python*
 * binding, non-destructively (it snapshots and restores the clip).
 *
 * The ``detail`` string reports four sub-probes:
 *   P1_id_present  — get_all_notes_extended exposes a real int note_id
 *   P2_apply_pitch — apply_note_modifications changes pitch keyed by id
 *   P3_add_ids     — add_new_notes yields a readable stable id
 *   P4_remove_by_id— remove_notes_by_id exists and deletes by id
 *   restore        — clip restored to its pre-probe state
 *
 * Why not through the bridge?
 * ---------------------------
 *
 * Same reasoning as gate4a_run.js: the bridge owns the surface's recv
 * port for normal operation, so we bind an ephemeral port and rely on
 * the surface's last-sender-wins reply rule (osc_transport.py) to
 * deliver the result straight back to us — no need to stop
 * ``npm run dev`` (see feedback_npm_run_dev_process_tree) and no need
 * to add /looping/probe/* to backendScope.
 *
 * Usage
 * -----
 *
 *   node owner/probes/note_edit_probe_run.js [clip_path] [--json]
 *
 * With no clip_path the surface targets ``song.view.detail_clip`` —
 * i.e. whatever clip is open in Live's Detail/Clip view.
 *
 * Prerequisites:
 *
 *  - Ableton Live open with the ``Looping`` Control Surface enabled.
 *  - A **MIDI clip with at least one note** open in the Detail/Clip
 *    view (double-click a clip). An empty clip reports ``clip_empty``;
 *    an audio clip reports ``not_midi_clip``.
 *  - The surface has started (Gate 1 heartbeat is the usual confirm).
 *  - ``npm run dev`` may be running or not — the script is independent.
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

const LOAD_ADDRESS = '/looping/probe/note_edit';
const RESULT_ADDRESS = '/looping/probe/note_edit_result';

// Note edits are synchronous on the surface (no settle delay like the
// browser-load probe), so the reply comes back fast. A generous
// timeout still covers a busy single-threaded surface mid-load.
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
      address: LOAD_ADDRESS,
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
      `note_edit_probe: bound ephemeral port ${bound.port}; probing ` +
      `surface at ${surfaceHost}:${surfaceRecvPort}\n`,
    );
    process.stderr.write(
      `note_edit_probe: target = ${clipPath || '<focused detail_clip>'}\n`,
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
  if (result.timedOut) {
    process.stdout.write(
      '\nNo reply. Is Live open with the Looping surface started and a ' +
      'MIDI clip (with notes) in the Detail view?\n',
    );
  }
}


main().catch((err) => {
  process.stderr.write(
    `note_edit_probe driver failed: ${err && err.stack || err}\n`,
  );
  process.exit(1);
});
