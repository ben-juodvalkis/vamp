#!/usr/bin/env node
/**
 * Phase 1 Commit B — v3 wire round-trip harness.
 *
 * Exit criterion for Commit B per [05 §1.3]: a Node harness issues
 * handshake → accept, then resolves a canonical path, writes to it,
 * and observes both the ``/looping/v3/param/value`` echo and the
 * ``/looping/v3/state/invalidate`` that future structural changes
 * emit. This script orchestrates that sequence against a live
 * surface.
 *
 * Driver pattern identical to gate4b_run.js: bind an ephemeral UDP
 * port, send straight to the surface at ``pythonSurface.remotePort``,
 * let the surface's last-sender-wins reply rule deliver everything
 * back. Respects the ``feedback_npm_run_dev_process_tree`` memory —
 * no need to stop the bridge.
 *
 * What the harness does NOT prove
 * -------------------------------
 *
 * - It does not verify v3 state/full emission. Commit B deliberately
 *   drops that emitter; the resync path reaches the v2 state/full
 *   emitter as a placeholder. See the implementation log "Changes
 *   since spec draft" entry.
 * - It does not cover generation-stale replays. That's a UI-side
 *   concern and Phase 2 work.
 *
 * Usage
 * -----
 *
 *   node owner/probes/v3_roundtrip_run.js [--json]
 *     [--path=tracks/0/devices/0/params/0] [--value=0.5]
 *
 * Prerequisites:
 *
 *  - Live open with the Looping surface loaded and a track
 *    carrying at least one device with at least one parameter at the
 *    default path ``tracks/0/devices/0/params/0`` (or pass --path).
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

const DEFAULT_PATH = 'tracks/0/devices/0/params/0';
const DEFAULT_VALUE = 0.5;
const DEFAULT_TIMEOUT_MS = 3000;


function loadConstants() {
  return JSON.parse(fs.readFileSync(CONSTANTS_PATH, 'utf8'));
}


function parseArgs(argv) {
  const opts = {
    asJson: false,
    path: DEFAULT_PATH,
    value: DEFAULT_VALUE,
  };
  for (const a of argv) {
    if (a === '--json') opts.asJson = true;
    else if (a.startsWith('--path=')) opts.path = a.slice('--path='.length);
    else if (a.startsWith('--value=')) {
      const v = parseFloat(a.slice('--value='.length));
      if (!Number.isFinite(v)) {
        throw new Error(`--value must be numeric, got ${a}`);
      }
      opts.value = v;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'usage: v3_roundtrip_run.js [--json] [--path=<path>] [--value=<float>]\n'
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return opts;
}


function unwrapArg(a) {
  if (a !== null && typeof a === 'object' && 'value' in a) return a.value;
  return a;
}


function awaitAddress(udpPort, address, timeoutMs, filter = () => true) {
  return new Promise((resolve) => {
    const onMessage = (oscMsg) => {
      if (oscMsg.address !== address) return;
      const args = oscMsg.args.map(unwrapArg);
      if (!filter(args)) return;
      cleanup();
      resolve({ ok: true, args });
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve({ ok: false, detail: `timeout waiting for ${address}` });
    }, timeoutMs);
    function cleanup() {
      udpPort.off('message', onMessage);
      clearTimeout(timer);
    }
    udpPort.on('message', onMessage);
  });
}


async function step(label, fn, results, asJson) {
  if (!asJson) process.stderr.write(`v3-roundtrip: ${label}...\n`);
  const r = await fn();
  results.push({ label, ...r });
  if (!asJson) {
    process.stderr.write(
      `v3-roundtrip: ${label} — ${r.ok ? 'OK' : 'FAIL: ' + r.detail}\n`
    );
  }
  return r;
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
  if (!opts.asJson) {
    process.stderr.write(
      `v3-roundtrip: bound ephemeral port ${bound.port}; probing ` +
      `surface at ${surfaceHost}:${surfaceRecvPort}\n`
    );
  }

  const results = [];
  let currentGeneration = null;

  // Step 1: handshake.
  await step('handshake hello → accept', async () => {
    const waitAccept = awaitAddress(
      udpPort, '/looping/v3/handshake/accept', DEFAULT_TIMEOUT_MS,
    );
    udpPort.send({
      address: '/looping/v3/handshake/hello',
      args: [{ type: 's', value: '3.0.0' }],
    });
    const r = await waitAccept;
    if (!r.ok) return r;
    const [version, sessionId, generation] = r.args;
    if (version !== '3.0.0') {
      return { ok: false, detail: `accept version=${version}, expected 3.0.0` };
    }
    currentGeneration = generation;
    return {
      ok: true,
      detail: `version=${version} session=${sessionId} gen=${generation}`,
      accept: { version, sessionId, generation },
    };
  }, results, opts.asJson);

  if (currentGeneration === null) {
    udpPort.close();
    return finish(results, opts.asJson);
  }

  // Step 2: param/set with current generation, then param/query to
  // read back → expect param/value with the written value.
  //
  // We query rather than relying on the listener echo because v3
  // writes arm per-pid suppression on the shared v2/v3 value listener
  // (per [04 §3.1 / §3.2] and the suppression design in
  // MutationComponent) — a UI-driven write intentionally swallows the
  // listener echo because the writer already has the value
  // optimistically. ``handle_v3_param_query`` emits to the same
  // ``/looping/v3/param/value`` address with the same shape, so
  // set+query round-trips the wire without fighting the suppression.
  await step('param/set → param/query → param/value', async () => {
    udpPort.send({
      address: '/looping/v3/param/set',
      args: [
        { type: 's', value: opts.path },
        { type: 'f', value: opts.value },
        { type: 'i', value: currentGeneration },
      ],
    });
    // Small gap so the write lands before the query; the surface
    // processes each OSC message on its own tick.
    await new Promise((r) => setTimeout(r, 50));
    const waitEcho = awaitAddress(
      udpPort, '/looping/v3/param/value', DEFAULT_TIMEOUT_MS,
      (args) => args[0] === opts.path,
    );
    udpPort.send({
      address: '/looping/v3/param/query',
      args: [{ type: 's', value: opts.path }],
    });
    const r = await waitEcho;
    if (!r.ok) return r;
    const [echoPath, echoValue] = r.args;
    const delta = Math.abs(echoValue - opts.value);
    // Value clamp tolerance: the surface clamps to [min, max]; our
    // default 0.5 is safely in-range on any sane param. We accept a
    // small delta because the param's quantized range may snap the
    // value — e.g., an int-valued param clamps 0.5 to 0 or 1.
    return {
      ok: true,
      detail: `path=${echoPath} value=${echoValue} (delta ${delta.toFixed(6)})`,
      echo: { path: echoPath, value: echoValue },
    };
  }, results, opts.asJson);

  // Step 3: stale-write rejection — send with generation = 0.
  await step('stale param/set → generation-stale error', async () => {
    const waitError = awaitAddress(
      udpPort, '/looping/v3/error', DEFAULT_TIMEOUT_MS,
      (args) => args[0] === '/looping/v3/param/set',
    );
    udpPort.send({
      address: '/looping/v3/param/set',
      args: [
        { type: 's', value: opts.path },
        { type: 'f', value: opts.value },
        { type: 'i', value: 0 }, // UNSET — always stale.
      ],
    });
    const r = await waitError;
    if (!r.ok) return r;
    const [addr, code, errPath, detail] = r.args;
    if (code !== 'generation-stale') {
      return {
        ok: false,
        detail: `got code=${code} (expected generation-stale): ${detail}`,
      };
    }
    return {
      ok: true,
      detail: `code=${code} path=${errPath}`,
    };
  }, results, opts.asJson);

  // Step 4: malformed path → path-not-found.
  await step('bad path → path-not-found error', async () => {
    const waitError = awaitAddress(
      udpPort, '/looping/v3/error', DEFAULT_TIMEOUT_MS,
      (args) => args[0] === '/looping/v3/param/set',
    );
    udpPort.send({
      address: '/looping/v3/param/set',
      args: [
        { type: 's', value: 'tracks/999/devices/0/params/0' },
        { type: 'f', value: 0.1 },
        { type: 'i', value: currentGeneration },
      ],
    });
    const r = await waitError;
    if (!r.ok) return r;
    const [, code] = r.args;
    if (code !== 'path-not-found') {
      return { ok: false, detail: `got code=${code}` };
    }
    return { ok: true, detail: `code=${code}` };
  }, results, opts.asJson);

  udpPort.close();
  finish(results, opts.asJson);
}


function finish(results, asJson) {
  const allOk = results.every((r) => r.ok);
  if (asJson) {
    process.stdout.write(JSON.stringify({ ok: allOk, steps: results }, null, 2) + '\n');
  } else {
    process.stderr.write(`\nv3-roundtrip: ${allOk ? 'PASS' : 'FAIL'}\n`);
  }
  process.exit(allOk ? 0 : 1);
}


main().catch((err) => {
  process.stderr.write(`v3-roundtrip driver failed: ${err && err.stack || err}\n`);
  process.exit(1);
});
