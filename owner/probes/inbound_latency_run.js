#!/usr/bin/env node
/**
 * Inbound-latency probe — measures how long a UI→Live command waits
 * before the surface even *reads* it off the socket.
 *
 * Why this probe exists
 * ---------------------
 *
 * All prior perf work in this repo starts its clock at the surface
 * (``perf_profiler.record_inbound``), so the queue-wait *before* the
 * surface looks at the socket is invisible to it. The surface drains
 * its UDP socket only inside ``LoopingSurface._tick``, which
 * re-arms via ``schedule_message(1, self._tick)``. If a Live tick is
 * ~100ms, every inbound command sits in the kernel receive buffer for
 * up to a full tick before dispatch, and the round trip is dominated
 * by that wait rather than by anything we compute.
 *
 * ``/live/test`` is the right stimulus: its handler does nothing but
 * log and return ``("ok",)``, so handler time is ~0 and the measured
 * round trip is almost entirely the drain wait plus loopback.
 *
 * Method
 * ------
 *
 * Bind an ephemeral UDP port, send ``/live/test`` to the surface's
 * receive port (11020), and time until the echo lands. Repeat N times
 * with a *randomised* inter-sample gap so the sends land at uniformly
 * distributed phases within the tick period — a fixed gap would
 * alias against the tick and produce a fake-tight distribution.
 *
 * Reading the result
 * ------------------
 *
 * If the surface drains once per tick of period T, round trips are
 * ~uniform on [0, T]: mean ≈ T/2, max ≈ T. So ``max`` is the estimate
 * of the tick period and ``mean`` is the latency a performer actually
 * eats on an average button press. After a fast drain pump lands,
 * both should collapse toward the loopback floor.
 *
 * Why not through the bridge
 * --------------------------
 *
 * Same reasoning as the other drivers in this directory: the bridge
 * owns 11021 for normal operation, and the surface replies to the
 * asking address (``_dispatch``'s auto-reply passes ``source_addr``),
 * so an ephemeral port gets its own answers without disturbing the
 * ``npm run dev`` process tree.
 *
 * Usage
 * -----
 *
 *   node owner/probes/inbound_latency_run.js [--count=N] [--json]
 *
 * Prerequisite: Live is open with the ``Looping`` Control Surface
 * enabled. ``npm run dev`` may be running or not.
 *
 * Note: ``_handle_live_test`` logs one INFO line per hit, so a run of
 * N samples adds N lines to Live's Log.txt. That is the price of
 * using the existing echo rather than adding a silent one.
 */

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const osc = require(path.join(PROJECT_ROOT, 'node_modules', 'osc'));
const CONSTANTS = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'config', 'constants.json'), 'utf8'),
);

const SURFACE_HOST = CONSTANTS.osc.pythonSurface.host;
const SURFACE_PORT = CONSTANTS.osc.pythonSurface.remotePort;

const ADDRESS = '/live/test';
const PER_SAMPLE_TIMEOUT_MS = 2000;
// Randomised gap between samples. The lower bound keeps the surface's
// per-hit INFO log from becoming the bottleneck; the spread has to be
// wider than any plausible tick period so phases land uniformly.
const GAP_MIN_MS = 20;
const GAP_SPREAD_MS = 180;

function parseArgs(argv) {
  const opts = { count: 120, json: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--json') opts.json = true;
    else if (arg.startsWith('--count=')) opts.count = parseInt(arg.slice(8), 10);
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(opts.count) || opts.count < 1) {
    console.error('--count must be a positive integer');
    process.exit(2);
  }
  return opts;
}

/** Nearest-rank percentile, matching SchedulerProbe._nearest_rank_index. */
function percentile(sorted, pct) {
  const n = sorted.length;
  if (n <= 1) return sorted[0] ?? 0;
  let raw = Math.ceil(pct * n);
  return sorted[Math.max(0, Math.min(n - 1, raw - 1))];
}

function summarise(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    count: n,
    min: sorted[0],
    mean: sorted.reduce((a, b) => a + b, 0) / n,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[n - 1],
  };
}

/** ASCII histogram so the shape (uniform vs. spiked) is visible at a glance. */
function histogram(samples, bins = 10) {
  const max = Math.max(...samples);
  const width = max / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const s of samples) {
    counts[Math.min(bins - 1, Math.floor(s / width))] += 1;
  }
  const peak = Math.max(...counts, 1);
  return counts.map((c, i) => {
    const lo = (i * width).toFixed(1).padStart(6);
    const hi = ((i + 1) * width).toFixed(1).padStart(6);
    const bar = '#'.repeat(Math.round((c / peak) * 40));
    return `  ${lo} – ${hi} ms | ${String(c).padStart(4)} ${bar}`;
  }).join('\n');
}

async function main() {
  const opts = parseArgs(process.argv);
  const port = new osc.UDPPort({
    localAddress: '127.0.0.1',
    localPort: 0,
    metadata: true,
  });

  await new Promise((resolve) => { port.on('ready', resolve); port.open(); });

  const samples = [];
  let timeouts = 0;
  let pending = null;

  port.on('message', (msg) => {
    if (msg.address !== ADDRESS || pending === null) return;
    const dt = Number(process.hrtime.bigint() - pending.t0) / 1e6;
    const resolve = pending.resolve;
    pending = null;
    resolve(dt);
  });

  if (!opts.json) {
    console.log(
      `Probing ${ADDRESS} → ${SURFACE_HOST}:${SURFACE_PORT}, `
      + `${opts.count} samples at randomised phase…`,
    );
  }

  for (let i = 0; i < opts.count; i += 1) {
    const dt = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (pending !== null) { pending = null; resolve(null); }
      }, PER_SAMPLE_TIMEOUT_MS);
      pending = {
        t0: process.hrtime.bigint(),
        resolve: (v) => { clearTimeout(timer); resolve(v); },
      };
      port.send({ address: ADDRESS, args: [] }, SURFACE_HOST, SURFACE_PORT);
    });
    if (dt === null) timeouts += 1;
    else samples.push(dt);
    await new Promise((r) => setTimeout(r, GAP_MIN_MS + Math.random() * GAP_SPREAD_MS));
  }

  port.close();

  if (samples.length === 0) {
    console.error(
      'No replies. Is Live open with the Looping Control Surface enabled?',
    );
    process.exit(1);
  }

  const stats = summarise(samples);
  if (opts.json) {
    console.log(JSON.stringify({ ...stats, timeouts, samples }, null, 2));
    return;
  }

  console.log('');
  console.log(`  samples   ${stats.count}${timeouts ? `  (${timeouts} timed out)` : ''}`);
  console.log(`  min       ${stats.min.toFixed(2)} ms`);
  console.log(`  mean      ${stats.mean.toFixed(2)} ms`);
  console.log(`  p50       ${stats.p50.toFixed(2)} ms`);
  console.log(`  p95       ${stats.p95.toFixed(2)} ms`);
  console.log(`  p99       ${stats.p99.toFixed(2)} ms`);
  console.log(`  max       ${stats.max.toFixed(2)} ms`);
  console.log('');
  console.log(histogram(samples));
  console.log('');
  console.log(
    `  Tick-period estimate (max):  ~${stats.max.toFixed(0)} ms\n`
    + `  Average command wait (mean): ~${stats.mean.toFixed(0)} ms`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
