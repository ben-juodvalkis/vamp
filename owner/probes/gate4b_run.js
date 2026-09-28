#!/usr/bin/env node
/**
 * Gate 4b driver — one-shot operator script for [06 §1.3].
 *
 * Sends ``/looping/probe/schedule_run [delay_ms, count]`` for each of
 * the four buckets in the risk doc's table (10ms, 100ms, 500ms,
 * 1500ms), collects the aggregate deviation stats on
 * ``/looping/probe/schedule_result``, and prints a markdown table
 * ready to paste into 06 §1.3. The measurement comes out of Live's
 * actual scheduler — this script only orchestrates and formats.
 *
 * Why not through the bridge?
 * ---------------------------
 *
 * Same reasoning as gate4a_run.js: the bridge's ``pythonSurface`` UDP
 * port is bound for normal operation, and the surface's
 * last-sender-wins reply rule ([osc_transport.py line 181]) means a
 * message sent from an ephemeral port to 11020 gets its reply
 * delivered straight back to us. The feedback memory
 * ``feedback_npm_run_dev_process_tree`` explicitly calls out killing
 * the bridge as a failure mode to avoid — this design sidesteps it.
 *
 * Usage
 * -----
 *
 *   node owner/probes/gate4b_run.js [--json] [--count=N]
 *
 * Prerequisites:
 *
 *  - Ableton Live is open with the ``Looping`` Control Surface
 *    enabled. No track selection required — the probe does not touch
 *    LOM state, only the scheduler.
 *  - The surface has started. Gate 1's heartbeat is the usual way to
 *    confirm; running this script while Live is still loading will
 *    time out on every bucket.
 *  - ``npm run dev`` may be running or not; the script is independent
 *    of it.
 *
 * Count
 * -----
 *
 * The plan names 100 callbacks per bucket; the default here matches.
 * ``--count=10`` is useful for a smoke run — the stats are noisier
 * (p99 on 10 samples is just the max) but a full 100-sample run at
 * 1500ms takes ~150s of wall time per bucket, which is a long wait
 * for a sanity check. Pass the full default for the table that goes
 * into 06 §1.3.
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

// Buckets from [05 §1 Gate 4b] / [06 §1.3]. Order matters: we run
// fastest-first so if something is catastrophically broken at 10ms
// the operator notices before waiting out the 1500ms run.
const BUCKETS = [10, 100, 500, 1500];

// Acceptance bands — must match SchedulerProbe's ACCEPT_MS_SHORT /
// ACCEPT_MS_LONG constants. The driver colours the verdict column
// from these rather than hard-coding; if either constant moves in
// the probe, the unit tests catch it and this file follows in the
// same PR. Kept as literals here (not fetched dynamically) because
// the driver has no other reason to read Python source.
const ACCEPT_MS_SHORT = 20; // buckets ≤ 500ms
const ACCEPT_MS_LONG = 50;  // bucket = 1500ms

// Per-bucket timeout: the full request→response round-trip takes
// roughly ``delay_ms + count * tick_quantum + slack``. For the
// 1500ms/100 bucket that is ~150s if Live dispatches one callback
// per tick, plus slack for Live's scheduler and the emit. We pick
// a generous ceiling because "driver timed out but the run
// completed" is the worst kind of false negative — the operator
// would rerun, doubling the wall time for no reason. The ceiling is
// sized to the 1500ms bucket; shorter buckets return long before it.
function timeoutForBucket(delayMs, count) {
  // Assume the worst: one fire per tick (~100ms), plus ``delay_ms``
  // to first fire, plus 5s slack for OSC and Live scheduler jitter.
  // At delay_ms=10 count=100 this is ~15s, which is fine.
  // At delay_ms=1500 count=100 this is ~116.5s, so we set 180s.
  const perTickMs = 100;
  const slackMs = 5000;
  return delayMs + count * perTickMs + slackMs;
}

// Gap between buckets. The probe has a single-run guard so the next
// bucket's request would be refused if the previous emit hasn't
// arrived yet; the wait is actually driven by our await on the
// result message, but a small breathing space avoids racing a
// slow last-callback on the Live side.
const INTER_BUCKET_DELAY_MS = 500;


function loadConstants() {
  return JSON.parse(fs.readFileSync(CONSTANTS_PATH, 'utf8'));
}


function parseArgs(argv) {
  const opts = { asJson: false, count: 100 };
  for (const a of argv) {
    if (a === '--json') opts.asJson = true;
    else if (a.startsWith('--count=')) {
      const n = parseInt(a.slice('--count='.length), 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--count must be a positive integer, got ${a}`);
      }
      opts.count = n;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'usage: gate4b_run.js [--json] [--count=N]\n' +
        '  --json      emit machine-readable results instead of markdown\n' +
        '  --count=N   samples per bucket (default 100; the plan\'s spec value)\n'
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return opts;
}


// The ``osc`` npm library emits incoming args in two shapes depending
// on how the message was composed on the wire: typetagged args come
// through as ``{type, value}`` objects, and untyped numerics can
// come through as bare primitives. Gate 4a's driver only looked at
// ``a.value`` and that worked for string asset-class replies, but
// here the surface emits typetagged float args that some library
// versions unwrap eagerly. Handle both so a future library bump or
// a codec change doesn't silently break the driver again (which is
// exactly how Gate 4b's first live run died: every bucket timed out
// because ``a.value`` was ``undefined`` on the numeric args).
function unwrapArg(a) {
  if (a !== null && typeof a === 'object' && 'value' in a) return a.value;
  return a;
}


function sendRun(udpPort, delayMs, count) {
  const timeoutMs = timeoutForBucket(delayMs, count);
  return new Promise((resolve) => {
    const onMessage = (oscMsg) => {
      if (oscMsg.address !== '/looping/probe/schedule_result') return;
      const args = oscMsg.args.map(unwrapArg);
      const [replyDelay, replyCount, mean, p50, p99, max] = args;
      // The surface echoes ``delay_ms`` in the result so we can
      // correlate — important if any driver ever sends overlapping
      // buckets. (This one doesn't.)
      if (replyDelay !== delayMs) return;
      udpPort.off('message', onMessage);
      clearTimeout(timer);
      if (mean < 0) {
        resolve({
          ok: false,
          detail: 'probe rejected run (likely busy or bad args)',
          stats: null,
          timedOut: false,
        });
        return;
      }
      resolve({
        ok: true,
        stats: {
          count: replyCount,
          mean,
          p50,
          p99,
          max,
        },
        timedOut: false,
      });
    };

    const timer = setTimeout(() => {
      udpPort.off('message', onMessage);
      resolve({
        ok: false,
        detail: 'timeout (no reply in ' + timeoutMs + 'ms)',
        stats: null,
        timedOut: true,
      });
    }, timeoutMs);

    udpPort.on('message', onMessage);
    udpPort.send({
      address: '/looping/probe/schedule_run',
      args: [
        { type: 'i', value: delayMs },
        { type: 'i', value: count },
      ],
    });
  });
}


function verdict(delayMs, result) {
  if (!result || !result.ok) return 'fail';
  const band = delayMs >= 1500 ? ACCEPT_MS_LONG : ACCEPT_MS_SHORT;
  // Compare the deviation from the *requested* delay. For the 10ms
  // bucket that is ``p99 - 10``. For the 1500ms bucket, ``p99 - 1500``.
  // The probe measures absolute fire-time from t0, so p99 is the
  // total elapsed, not the deviation. We subtract ``delayMs`` here.
  const p99Deviation = Math.max(0, result.stats.p99 - delayMs);
  return p99Deviation <= band ? 'pass' : 'fail';
}


function formatRow(delayMs, result) {
  if (!result || !result.ok) {
    const detail = (result && result.detail) || 'no result';
    return `| ${delayMs} | — | — | — | — | ✗ (${detail}) |`;
  }
  const { mean, p50, p99 } = result.stats;
  const v = verdict(delayMs, result);
  const mark = v === 'pass' ? '✓' : '✗';
  return (
    '| ' + delayMs + ' | ' +
    mean.toFixed(2) + ' | ' +
    p50.toFixed(2) + ' | ' +
    p99.toFixed(2) + ' | ' +
    (p99 - delayMs).toFixed(2) + ' | ' +
    mark + ' |'
  );
}


async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const constants = loadConstants();
  const surfaceHost = constants.osc.pythonSurface.host || '127.0.0.1';
  const surfaceRecvPort = constants.osc.pythonSurface.remotePort; // surface binds here

  // Bind to an ephemeral port — see gate4a_run.js's comments for the
  // rationale. Same pattern, same failure modes; the last-sender-wins
  // reply rule in osc_transport.py:181 does the delivery.
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
  if (!opts.asJson) {
    process.stderr.write(
      `gate4b: bound ephemeral port ${bound.port}; probing ` +
      `surface at ${surfaceHost}:${surfaceRecvPort} ` +
      `(count=${opts.count})\n`,
    );
  }

  const results = {};
  for (const delayMs of BUCKETS) {
    if (!opts.asJson) {
      process.stderr.write(
        `gate4b: delay_ms=${delayMs} — ` +
        `sampling ${opts.count} (timeout ${timeoutForBucket(delayMs, opts.count)}ms)\n`,
      );
    }
    // eslint-disable-next-line no-await-in-loop -- serialise by design
    const result = await sendRun(udpPort, delayMs, opts.count);
    results[delayMs] = result;
    if (!opts.asJson) {
      if (result.ok) {
        process.stderr.write(
          `gate4b: delay_ms=${delayMs} — ` +
          `mean=${result.stats.mean.toFixed(2)}ms ` +
          `p50=${result.stats.p50.toFixed(2)}ms ` +
          `p99=${result.stats.p99.toFixed(2)}ms ` +
          `max=${result.stats.max.toFixed(2)}ms ` +
          `verdict=${verdict(delayMs, result)}\n`,
        );
      } else {
        process.stderr.write(
          `gate4b: delay_ms=${delayMs} — ${result.detail}\n`,
        );
      }
    }
    // eslint-disable-next-line no-await-in-loop -- intentional pacing
    await new Promise((r) => setTimeout(r, INTER_BUCKET_DELAY_MS));
  }

  udpPort.close();

  if (opts.asJson) {
    process.stdout.write(JSON.stringify({
      count: opts.count,
      results,
    }, null, 2) + '\n');
    return;
  }

  // Markdown table for 06 §1.3. The plan's table is (Requested,
  // Observed mean, Observed p99, Pass?); we include p50 and the
  // raw deviation too because they cost nothing and make the
  // verdict auditable.
  process.stdout.write('\n');
  process.stdout.write(
    '| Requested delay (ms) | Mean (ms) | p50 (ms) | p99 (ms) | p99 deviation (ms) | Pass? |\n'
  );
  process.stdout.write(
    '|---|---|---|---|---|---|\n'
  );
  for (const delayMs of BUCKETS) {
    process.stdout.write(formatRow(delayMs, results[delayMs]) + '\n');
  }
  process.stdout.write(
    `\nAcceptance bands: ≤${ACCEPT_MS_SHORT}ms at delay_ms ≤ 500, ` +
    `≤${ACCEPT_MS_LONG}ms at delay_ms = 1500 (p99 deviation).\n`
  );
}


main().catch((err) => {
  process.stderr.write(`gate4b driver failed: ${err && err.stack || err}\n`);
  process.exit(1);
});
