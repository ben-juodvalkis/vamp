// Headless verification harness. Runs on plain Node 22+ (uses the built-in
// global WebSocket client and a raw-socket mock bridge — no npm install).
//
//   node verify/verify.mjs
//
// Proves, without macOS / Xcode / Ableton:
//   1. the envelope encode/decode (shared with the Swift app) round-trips,
//      including /bridge/batch unwrap and argsTypes tagging
//   2. handshake -> the surface's accept re-emit seeds the primary toggles
//   3. a /query reply seeds a toggle
//   4. a toggle write echoes back on the same address (self-sync)
//   5. a write from ANOTHER client echoes to us too (menu-bar <-> web-UI
//      bidirectional sync — the core requirement)
//   6. a batched echo is unwrapped correctly
//
// The Swift app implements this exact choreography (BridgeClient + AppState);
// this harness exercises a faithful JS twin of it against the mock bridge.

import { createHmac } from 'node:crypto';

import { encode, decode } from './envelope.mjs';
import { startMockBridge } from './mock-bridge.mjs';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
  }
}
function section(t) {
  console.log(`\n${t}`);
}

// --- 1. Envelope unit tests ---------------------------------------------------

section('Envelope (shared logic with OSCEnvelope.swift)');
{
  const wire = JSON.parse(encode('/looping/v3/session/auto_arm', [1]));
  check('encode shape { address, args, argsTypes }',
    wire.address === '/looping/v3/session/auto_arm' &&
    wire.args[0] === 1 &&
    wire.argsTypes[0] === 'number');

  const hs = JSON.parse(encode('/looping/v3/handshake/hello', ['3.3.0']));
  check('string args tagged "string"', hs.argsTypes[0] === 'string' && hs.args[0] === '3.3.0');

  const single = decode(JSON.stringify({ address: '/looping/v3/session/loop', args: [1] }));
  check('decode single message', single.length === 1 && single[0].address === '/looping/v3/session/loop');

  const batch = decode(JSON.stringify({
    address: '/bridge/batch',
    messages: [
      { address: '/looping/v3/session/auto_arm', args: [0] },
      { address: '/looping/v3/session/metronome', args: [1] },
    ],
  }));
  check('decode unwraps /bridge/batch into inner messages',
    batch.length === 2 &&
    batch[0].address === '/looping/v3/session/auto_arm' && batch[0].args[0] === 0 &&
    batch[1].address === '/looping/v3/session/metronome' && batch[1].args[0] === 1);

  check('decode ignores garbage', decode('not json').length === 0);
}

// --- Integration against the mock bridge -------------------------------------

// A tiny client that mirrors the Swift BridgeClient: on open it sends the
// handshake hello + the two /query seeds, then folds inbound toggle echoes into
// a `state` map exactly like AppState.handleMessage.
function makeClient(port, { secret = null } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const state = {};
  // Mirrors BridgeClient.sawChallenge / hasSeeded. The guard is the
  // point: the bridge sends server_mode right behind the challenge, so
  // seeding on the first ordinary frame races our own async answer and
  // gets refused. That bug shipped in the Swift client.
  let sawChallenge = false;
  let hasSeeded = false;

  function seed() {
    if (hasSeeded) return;
    hasSeeded = true;
    ws.send(encode('/looping/v3/handshake/hello', ['3.3.0']));
    ws.send(encode('/looping/v3/session/auto_arm/query', []));
    ws.send(encode('/looping/v3/session/move_volume_knob/query', []));
    ws.send(encode('/looping/v3/session/auto_capture/query', []));
  }
  const meta = { mode: undefined }; // non-toggle state (e.g. launch mode)
  const waiters = [];

  function notify() {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred()) {
        waiters[i].resolve();
        waiters.splice(i, 1);
      }
    }
  }

  // A bridge with auth disabled never challenges, so seed on open in
  // that case; an authenticating one seeds from the auth result.
  ws.addEventListener('open', () => {
    if (!secret) seed();
  });

  ws.addEventListener('message', (ev) => {
    for (const m of decode(typeof ev.data === 'string' ? ev.data : ev.data.toString())) {
      if (m.address === '/bridge/ping') continue; // liveness only
      if (m.address === '/bridge/auth/challenge') {
        sawChallenge = true;
        const proof = createHmac('sha256', secret ?? '')
          .update(String(m.args[0] ?? ''))
          .digest('hex');
        ws.send(encode('/bridge/auth', [proof]));
        continue;
      }
      if (m.address === '/bridge/auth/result') {
        if (Number(m.args[0]) === 1) seed();
        continue;
      }
      if (!sawChallenge) seed();
      if (m.address === '/bridge/server_mode') {
        if (m.args.length >= 1) meta.mode = String(m.args[0]);
        notify();
        continue;
      }
      // /query replies land on `<base>/query`; normalise to the base key.
      const key = m.address.endsWith('/query') ? m.address.slice(0, -'/query'.length) : m.address;
      if (m.args.length >= 1) state[key] = Number(m.args[0]);
      notify();
    }
  });

  return {
    ws,
    state,
    meta,
    /** Current state, for asserting that nothing arrived. */
    snapshot: () => ({ ...state }),
    send: (address, args) => ws.send(encode(address, args)),
    // Resolve once `pred(state, meta)` holds, or reject after `ms`.
    until: (pred, ms = 2000) =>
      new Promise((resolve, reject) => {
        const p = () => pred(state, meta);
        if (p()) return resolve();
        const w = { pred: p, resolve };
        waiters.push(w);
        setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error('timeout waiting for state: ' + JSON.stringify(state)));
        }, ms);
      }),
    close: () => ws.close(),
  };
}

const AUTO_ARM = '/looping/v3/session/auto_arm';
const AUTO_CAPTURE = '/looping/v3/session/auto_capture';
const LOOP = '/looping/v3/session/loop';

const bridge = await startMockBridge({ mode: 'ipad' });
let exitCode = 0;
try {
  section(`Live choreography against mock bridge (port ${bridge.port}, mode=ipad)`);

  const menubar = makeClient(bridge.port);
  const webui = makeClient(bridge.port);

  // 0: the launch-mode beacon reaches the client on connect.
  await menubar.until((_s, m) => m.mode === 'ipad');
  check('bridge announces launch mode on connect (/bridge/server_mode = ipad)', true);

  // 2 + 3: handshake accept re-emit + /query seed the primary toggles.
  await menubar.until((s) => s[AUTO_ARM] === 1 && s['/looping/v3/session/move_volume_knob'] === 1);
  check('handshake + query seed primary toggles (auto_arm=1, move_volume_knob=1)', true);

  // auto_capture's mode-derived default: ipad → seeded ON.
  await menubar.until((s) => s[AUTO_CAPTURE] === 1);
  check('auto_capture seeds ON under mode=ipad (mode-derived default)', true);

  await webui.until((s) => s[AUTO_ARM] === 1);

  // 4: menu-bar writes auto_arm -> 0, sees its own echo.
  menubar.send(AUTO_ARM, [0]);
  await menubar.until((s) => s[AUTO_ARM] === 0);
  check('menu-bar write echoes back on same address (auto_arm=0)', true);

  // 5: the OTHER client (web UI) observes the menu-bar's change.
  await webui.until((s) => s[AUTO_ARM] === 0);
  check('web-UI client observes menu-bar write (menu-bar -> web-UI sync)', true);

  // 5 (reverse): web UI writes auto_arm -> 1, menu-bar observes it.
  webui.send(AUTO_ARM, [1]);
  await menubar.until((s) => s[AUTO_ARM] === 1);
  check('menu-bar observes web-UI write (web-UI -> menu-bar sync)', true);

  // 5 (auto_capture): menu-bar forces it OFF during an ipad set; web UI sees it.
  menubar.send(AUTO_CAPTURE, [0]);
  await menubar.until((s) => s[AUTO_CAPTURE] === 0);
  check('menu-bar can override auto_capture off (echoes back auto_capture=0)', true);
  await webui.until((s) => s[AUTO_CAPTURE] === 0);
  check('web-UI observes auto_capture override (menu-bar -> web-UI sync)', true);

  // 6: loop echo comes wrapped in a /bridge/batch envelope; must unwrap.
  menubar.send(LOOP, [1]);
  await menubar.until((s) => s[LOOP] === 1);
  check('batched echo (/bridge/batch) unwrapped and applied (loop=1)', true);

  check('bridge saw both clients connect', bridge.clientCount() === 2);

  menubar.close();
  webui.close();
} catch (err) {
  failed++;
  console.log(`  ✗ ${err.message}`);
} finally {
  await bridge.close();
}

// ---------------------------------------------------------------------------
// Auth choreography (2026-08-31)
//
// The bridge now challenges on connect and refuses everything from an
// unauthenticated client. The ordering hazard is the whole point: the
// challenge is followed immediately by server_mode, and answering is
// async — so a client that seeds on the first ordinary frame races its
// own answer and gets refused. That bug shipped in the Swift client and
// this harness did not catch it, because the mock never challenged.
// ---------------------------------------------------------------------------

const authBridge = await startMockBridge({ mode: 'dev', auth: true });
section(`Auth choreography against mock bridge (port ${authBridge.port})`);

try {
  const client = makeClient(authBridge.port, { secret: authBridge.secret });
  await client.until((s) => s['/looping/v3/session/auto_arm'] !== undefined);
  check('client authenticates, then seeds and receives state', true);
  client.close();

  // A client with the wrong secret must get nothing at all: refusing
  // only its writes would still hand it the whole Set.
  const impostor = makeClient(authBridge.port, { secret: 'wrong-secret' });
  await new Promise((r) => setTimeout(r, 400));
  check(
    'a client with the wrong secret is never seeded',
    impostor.snapshot()['/looping/v3/session/auto_arm'] === undefined
  );
  impostor.close();

  // The gate itself: a client that seeds before authenticating gets its
  // frames refused and stays empty. This is what makes "wait for the
  // auth result before seeding" a requirement rather than a style
  // choice — the Swift client got this wrong and sat connected-but-blank.
  const before = authBridge.refusals.length;
  const eager = makeClient(authBridge.port, { secret: null });
  // `secret: null` makes the twin seed on open, which against an
  // authenticating bridge is exactly the premature-seed case.
  await new Promise((r) => setTimeout(r, 400));
  check(
    'a client that seeds before authenticating is refused',
    authBridge.refusals.length > before
  );
  check(
    'and receives no state for having tried',
    eager.snapshot()['/looping/v3/session/auto_arm'] === undefined
  );
  eager.close();
} catch (err) {
  failed++;
  console.log(`  ✗ ${err.message}`);
} finally {
  await authBridge.close();
}

section(`Result: ${passed} passed, ${failed} failed`);
exitCode = failed === 0 ? 0 : 1;
process.exit(exitCode);
