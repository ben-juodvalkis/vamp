#!/usr/bin/env node
/**
 * Gate 4c driver — operator-interactive script for [06 §2.1].
 *
 * Walks an operator through three lifecycle checks for a non-MIDI v3
 * Control Surface:
 *
 *   Phase 1 (bind + fire):
 *     - Send ``/looping/probe/lifecycle_query`` — expect
 *       ``decorator_bound=1`` and record baseline fires.
 *     - Send ``/looping/probe/lifecycle_poke`` — expect ``fires`` to
 *       increment by exactly one (tempo self-assign fires the
 *       listener once, thanks to LOM's "fire even on identical
 *       value" behaviour we verified at Gate 3).
 *
 *   Phase 2 (song-change survival):
 *     - Pause and prompt the operator: "In Live: File → New Live Set.
 *       When the new set has loaded, press Enter."
 *     - Send ``/looping/probe/lifecycle_query`` — expect
 *       ``song_id`` to differ from phase 1 AND ``decorator_bound=1``
 *       (framework rebound the component against the new song) AND
 *       ``fires=0`` (new probe instance on the fresh song; or if the
 *       surface survived and the same probe rebound, fires stays
 *       whatever it was — we record both possibilities).
 *     - Send ``/looping/probe/lifecycle_poke`` — expect ``fires`` to
 *       increment by one against the new song.
 *
 *   Phase 3 (teardown):
 *     - Prompt: "In Live: Cmd+Q to quit. Press Enter when Log.txt
 *       shows 'LifecycleProbe: teardown'". No OSC round-trip
 *       possible in this phase — the transport is gone before any
 *       reply could leave. The driver collects the timestamp the
 *       operator confirmed and records it for the log entry.
 *
 * Why operator-interactive?
 * -------------------------
 *
 * "Open a new Live set" is a UI action with no OSC equivalent.
 * "Quit Live" similarly. Phases 1 and 2's *observations* are pure
 * OSC round-trips; the *preconditions* for phase 2 are a human
 * opening File → New. The driver orchestrates, prompts, and prints
 * a markdown table for [06 §2.1].
 *
 * Why not through the bridge?
 * ---------------------------
 *
 * Same reasoning as gate4a_run.js / gate4b_run.js: the surface's
 * last-sender-wins reply rule means an ephemeral-port client gets
 * replies back unchanged. See those scripts' preamble for the full
 * rationale and the ``feedback_npm_run_dev_process_tree`` memory
 * on why we avoid touching the bridge for diagnostics.
 *
 * Usage
 * -----
 *
 *   node owner/probes/gate4c_run.js [--json]
 *                                                   [--auto-phase2]
 *                                                   [--skip-phase3]
 *
 *   --json        Emit machine-readable JSON instead of the markdown
 *                 table.
 *   --auto-phase2 Skip the "open a new set" prompt — useful for a
 *                 phase-1-only smoke run when you want to verify
 *                 bind+fire without the full ceremony. Phase 2/3
 *                 are reported as ``skipped``.
 *   --skip-phase3 Skip the quit-Live prompt. Phase 3 is reported
 *                 as ``deferred`` in the table.
 *
 * Prerequisites
 * -------------
 *
 *  - Ableton Live open with the ``Looping`` Control Surface enabled.
 *  - The surface has started (Gate 1 heartbeat is the usual way to
 *    confirm).
 *  - No track selection required — tempo is song-level.
 *  - ``npm run dev`` may be running or not.
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const osc = require(path.join(
  __dirname,
  '..', '..',
  'node_modules', 'osc',
));

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CONSTANTS_PATH = path.join(PROJECT_ROOT, 'config', 'constants.json');

// Timeout for each snapshot query. The surface replies inline from
// the handler so this is fast — 2 seconds covers any schedule-message
// jitter plus a generous safety margin. Phase 3 has no OSC timeout
// because there is no reply.
const QUERY_TIMEOUT_MS = 2000;

// Gap between back-to-back requests. The surface is single-threaded
// and the handlers don't queue, so there is no contention — but a
// tiny breathing gap makes the Log.txt trace easier to read
// chronologically.
const INTER_REQUEST_DELAY_MS = 250;

// After a poke, LOM fires the tempo listener *asynchronously* — on
// the next UI tick, a few milliseconds after the synchronous
// ``song.tempo = ...`` write returns. The poke handler emits its
// snapshot inline, before that fire lands; if we read ``fires`` off
// the poke's own reply, we always see the pre-fire count. The
// remedy is a second ``lifecycle_query`` a short while after the
// poke, once the LOM scheduler has drained the pending fire.
// 250ms is two orders of magnitude above the observed ~5ms latency
// between "poke returned" and "tempo fire #N logged", with headroom
// for any slower UI frames under load. See [06 §2.1] and the
// implementation log Gate 4c entry for the live-run traces that
// pinned this down.
const POKE_SETTLE_DELAY_MS = 250;


function loadConstants() {
  return JSON.parse(fs.readFileSync(CONSTANTS_PATH, 'utf8'));
}


function parseArgs(argv) {
  const opts = { asJson: false, autoPhase2: false, skipPhase3: false };
  for (const a of argv) {
    if (a === '--json') opts.asJson = true;
    else if (a === '--auto-phase2') opts.autoPhase2 = true;
    else if (a === '--skip-phase3') opts.skipPhase3 = true;
    else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'usage: gate4c_run.js [--json] [--auto-phase2] [--skip-phase3]\n' +
        '  --json         emit machine-readable JSON instead of a markdown table\n' +
        '  --auto-phase2  skip "open a new Live set" prompt (phase 2+3 reported as skipped)\n' +
        '  --skip-phase3  skip "quit Live" prompt (phase 3 reported as deferred)\n'
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return opts;
}


// Shared unwrapper for OSC args — see gate4b_run.js comment block
// for the rationale. The ``osc`` npm library sometimes yields
// ``{type, value}`` and sometimes bare primitives depending on how
// the surface typetagged the reply, and this probe's snapshot is
// all typed ints where the quirk bites. Copied verbatim (not shared)
// until a third driver wants it too, per Gate 4b's entry.
function unwrapArg(a) {
  if (a !== null && typeof a === 'object' && 'value' in a) return a.value;
  return a;
}


function sendAndAwaitSnapshot(udpPort, address) {
  return new Promise((resolve) => {
    const onMessage = (oscMsg) => {
      if (oscMsg.address !== '/looping/probe/lifecycle_snapshot') return;
      const args = oscMsg.args.map(unwrapArg);
      const [phase, fires, songId, disconnectCount, decoratorBound] = args;
      udpPort.off('message', onMessage);
      clearTimeout(timer);
      resolve({
        ok: true,
        snapshot: {
          phase,
          fires,
          songId,
          disconnectCount,
          decoratorBound: Number(decoratorBound) === 1,
        },
      });
    };

    const timer = setTimeout(() => {
      udpPort.off('message', onMessage);
      resolve({
        ok: false,
        detail: `timeout (no snapshot in ${QUERY_TIMEOUT_MS}ms)`,
      });
    }, QUERY_TIMEOUT_MS);

    udpPort.on('message', onMessage);
    udpPort.send({ address, args: [] });
  });
}


function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}


function prompt(rl, message) {
  // Small wrapper so we can await the operator's Enter. readline's
  // promise-less ``question`` is wrapped rather than swapped for
  // readline/promises because that API landed in Node 17 and we want
  // broad portability.
  return new Promise((resolve) => {
    rl.question(message, (answer) => resolve(answer));
  });
}


async function phase1(udpPort, log) {
  log('phase 1: bind + fire');
  const before = await sendAndAwaitSnapshot(
    udpPort, '/looping/probe/lifecycle_query',
  );
  if (!before.ok) {
    return { ok: false, detail: `query failed: ${before.detail}` };
  }
  await delay(INTER_REQUEST_DELAY_MS);
  const pokeReply = await sendAndAwaitSnapshot(
    udpPort, '/looping/probe/lifecycle_poke',
  );
  if (!pokeReply.ok) {
    return { ok: false, detail: `poke failed: ${pokeReply.detail}` };
  }
  // LOM fires tempo listeners asynchronously on the next UI tick, so
  // the poke's own reply still shows the pre-fire count. Take a
  // settle query after a short delay to pick up the post-fire state.
  await delay(POKE_SETTLE_DELAY_MS);
  const after = await sendAndAwaitSnapshot(
    udpPort, '/looping/probe/lifecycle_query',
  );
  if (!after.ok) {
    return { ok: false, detail: `settle query failed: ${after.detail}` };
  }
  const fireDelta = after.snapshot.fires - before.snapshot.fires;
  // ``>= 1`` rather than ``== 1`` because the poke writes a tiny
  // delta then restores — LOM may deliver either two fires or one
  // (debounced) depending on UI-tick alignment. Both outcomes prove
  // the bind. Zero means the listener never fired; >= 1 passes.
  const verdicts = {
    decoratorBoundBefore: before.snapshot.decoratorBound,
    decoratorBoundAfter: after.snapshot.decoratorBound,
    fireDelta,
    pass:
      before.snapshot.decoratorBound &&
      after.snapshot.decoratorBound &&
      fireDelta >= 1,
  };
  return {
    ok: true,
    before: before.snapshot,
    after: after.snapshot,
    pokeReply: pokeReply.snapshot,
    verdicts,
  };
}


async function phase2(udpPort, rl, phase1Result, log) {
  log('phase 2: song-change survival');
  await prompt(
    rl,
    'In Ableton: File → New Live Set. When the new set has loaded, press Enter... ',
  );
  const before = await sendAndAwaitSnapshot(
    udpPort, '/looping/probe/lifecycle_query',
  );
  if (!before.ok) {
    return { ok: false, detail: `post-reload query failed: ${before.detail}` };
  }
  await delay(INTER_REQUEST_DELAY_MS);
  const pokeReply = await sendAndAwaitSnapshot(
    udpPort, '/looping/probe/lifecycle_poke',
  );
  if (!pokeReply.ok) {
    return { ok: false, detail: `post-reload poke failed: ${pokeReply.detail}` };
  }
  // LOM fires asynchronously; wait for the post-poke settle before
  // sampling the final state. Same pattern as phase 1.
  await delay(POKE_SETTLE_DELAY_MS);
  const after = await sendAndAwaitSnapshot(
    udpPort, '/looping/probe/lifecycle_query',
  );
  if (!after.ok) {
    return { ok: false, detail: `post-reload settle query failed: ${after.detail}` };
  }
  const phase1SongId = phase1Result.after.songId;
  const songIdChanged = before.snapshot.songId !== phase1SongId;
  const fireDelta = after.snapshot.fires - before.snapshot.fires;
  // The framework either (a) rebinds the existing component to the
  // new song — in which case the snapshot's fires counter continues
  // accumulating and songId changes — or (b) constructs a fresh
  // surface (rare, but possible if Live reloads the remote script
  // on set-change) in which case fires resets and songId changes.
  // Either outcome satisfies the risk: the listener is live against
  // the new song. The driver records which case occurred so the log
  // entry can be precise.
  const scenario =
    before.snapshot.fires === 0 ? 'fresh-probe' : 'rebound-probe';
  const verdicts = {
    phase1SongId,
    newSongId: before.snapshot.songId,
    songIdChanged,
    decoratorBound: after.snapshot.decoratorBound,
    fireDelta,
    scenario,
    pass:
      songIdChanged &&
      after.snapshot.decoratorBound &&
      fireDelta >= 1,
  };
  return {
    ok: true,
    before: before.snapshot,
    after: after.snapshot,
    pokeReply: pokeReply.snapshot,
    verdicts,
  };
}


async function phase3(rl, log) {
  log('phase 3: teardown');
  // No OSC — the transport is gone before any reply could leave.
  // The signal is Log.txt showing the teardown line.
  await prompt(
    rl,
    'In Ableton: Cmd+Q to quit. When Log.txt shows ' +
    '"LifecycleProbe: teardown complete", press Enter... ',
  );
  // Operator confirmation is the verdict. Any false positive here is
  // the operator misreading Log.txt; the log-entry template in 06
  // §2.1 calls this out.
  return { ok: true, verdicts: { operatorConfirmed: true, pass: true } };
}


function formatMarkdown(results, opts) {
  const lines = [];
  lines.push(
    '| Phase | Check | Expected | Observed | Verdict |',
    '|---|---|---|---|---|',
  );

  // Phase 1: bind + fire
  if (results.phase1 && results.phase1.ok) {
    const v = results.phase1.verdicts;
    lines.push(
      `| 1 | decorator_bound on init | 1 | ${v.decoratorBoundBefore ? 1 : 0} | ${v.decoratorBoundBefore ? '✓' : '✗'} |`,
    );
    lines.push(
      `| 1 | fires increments on poke | ≥+1 | ${v.fireDelta >= 0 ? '+' : ''}${v.fireDelta} | ${v.fireDelta >= 1 ? '✓' : '✗'} |`,
    );
  } else {
    const detail = (results.phase1 && results.phase1.detail) || 'not run';
    lines.push(`| 1 | bind + fire | ✓ | — | ✗ (${detail}) |`);
  }

  // Phase 2: song-change survival
  if (opts.autoPhase2) {
    lines.push('| 2 | song-change survival | — | skipped (--auto-phase2) | — |');
  } else if (results.phase2 && results.phase2.ok) {
    const v = results.phase2.verdicts;
    lines.push(
      `| 2 | song_id changes on new set | yes | ${v.songIdChanged ? 'yes' : 'no'} (${v.phase1SongId} → ${v.newSongId}) | ${v.songIdChanged ? '✓' : '✗'} |`,
    );
    lines.push(
      `| 2 | decorator_bound after reload | 1 | ${v.decoratorBound ? 1 : 0} | ${v.decoratorBound ? '✓' : '✗'} |`,
    );
    lines.push(
      `| 2 | fires increments after reload | ≥+1 | ${v.fireDelta >= 0 ? '+' : ''}${v.fireDelta} (${v.scenario}) | ${v.fireDelta >= 1 ? '✓' : '✗'} |`,
    );
  } else {
    const detail = (results.phase2 && results.phase2.detail) || 'not run';
    lines.push(`| 2 | song-change survival | ✓ | — | ✗ (${detail}) |`);
  }

  // Phase 3: teardown
  if (opts.skipPhase3 || opts.autoPhase2) {
    lines.push('| 3 | teardown on quit | — | deferred | — |');
  } else if (results.phase3 && results.phase3.ok) {
    lines.push('| 3 | teardown on quit (Log.txt) | operator-confirmed | ✓ | ✓ |');
  } else {
    lines.push('| 3 | teardown on quit | ✓ | — | ✗ |');
  }

  return lines.join('\n') + '\n';
}


async function main() {
  const opts = parseArgs(process.argv.slice(2));
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
  const log = (msg) => {
    if (!opts.asJson) process.stderr.write(`gate4c: ${msg}\n`);
  };
  log(
    `bound ephemeral port ${bound.port}; probing surface at ` +
    `${surfaceHost}:${surfaceRecvPort}`,
  );

  const results = {};

  // Phase 1 always runs; it's the gate's bare-minimum pass.
  results.phase1 = await phase1(udpPort, log);
  if (!opts.asJson) {
    if (results.phase1.ok) {
      const v = results.phase1.verdicts;
      log(
        `phase 1: decorator_bound=${v.decoratorBoundAfter ? 1 : 0} ` +
        `fireDelta=${v.fireDelta} verdict=${v.pass ? 'pass' : 'fail'}`,
      );
    } else {
      log(`phase 1 failed: ${results.phase1.detail}`);
    }
  }

  // Phases 2 and 3 are gated on interactive input, so we need a
  // readline interface. Create it lazily so --auto-phase2 doesn't
  // open stdin at all (cleaner exit from scripted contexts).
  let rl = null;
  if (!opts.autoPhase2 || !opts.skipPhase3) {
    rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  }

  if (!opts.autoPhase2) {
    results.phase2 = await phase2(udpPort, rl, results.phase1, log);
    if (!opts.asJson) {
      if (results.phase2.ok) {
        const v = results.phase2.verdicts;
        log(
          `phase 2: songIdChanged=${v.songIdChanged} ` +
          `decorator_bound=${v.decoratorBound ? 1 : 0} ` +
          `fireDelta=${v.fireDelta} scenario=${v.scenario} ` +
          `verdict=${v.pass ? 'pass' : 'fail'}`,
        );
      } else {
        log(`phase 2 failed: ${results.phase2.detail}`);
      }
    }
  }

  if (!opts.skipPhase3 && !opts.autoPhase2) {
    results.phase3 = await phase3(rl, log);
  }

  if (rl !== null) rl.close();
  udpPort.close();

  if (opts.asJson) {
    process.stdout.write(JSON.stringify({ opts, results }, null, 2) + '\n');
    return;
  }

  process.stdout.write('\n');
  process.stdout.write(formatMarkdown(results, opts));
  process.stdout.write(
    '\nAcceptance: all three phases pass. Fails indicate a specific ' +
    'framework assumption the non-MIDI surface violates; see [06 §2.1] ' +
    'for the escalation path.\n',
  );
}


main().catch((err) => {
  process.stderr.write(`gate4c driver failed: ${err && err.stack || err}\n`);
  process.exit(1);
});
