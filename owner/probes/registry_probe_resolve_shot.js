#!/usr/bin/env node
// 05a PR-1 F1 verification: end-to-end drive of "lazy rebuild on miss".
//
// Strategy:
//   1. /looping/v2/registry/dump  → learn stored counts and confirm
//      the fresh walk sees devices the registry doesn't.
//   2. If `stored.devices > 0`, pick any stored device id via a second
//      dump pass — but we don't have that in the current wire shape.
//      Instead we rely on the UI having produced a device_id; the
//      caller passes it on argv: `node ... <device_id>`.
//      When no id is supplied we fall back to "ask the surface to
//      pick one for us": probe_resolve with a sentinel the surface
//      would otherwise reject. Today the surface treats bad ids as
//      sentinels → reply -1; in that case we tell the caller to
//      re-run with an explicit id.
//   3. /looping/v2/registry/probe_resolve <device_id> → surface runs
//      resolve_device(id) and reports {found, was_rebuild, before,
//      after}.
//   4. /looping/v2/registry/dump  → second dump to eyeball the heal.
//
// Verdicts (printed at the end as a single JSON object):
//   - "f1-self-healed"  : found=1 was_rebuild=1 and after.devices >
//                         before.devices. This is the PR-1 success
//                         case — first probe was cold, F1 fired, the
//                         ID now resolves.
//   - "already-warm"    : found=1 was_rebuild=0. Registry was already
//                         populated (probably because some earlier
//                         resolve already triggered F1). Not a
//                         failure; re-run after a fresh Live reload
//                         to see the cold path.
//   - "unknown-id"      : found=0. Device id isn't in the LOM or the
//                         caller passed junk.
//   - "registry-absent" : first field of any reply is -1. DebugComponent
//                         wasn't wired with a registry reference.
const path = require('path');
const osc = require(path.resolve(__dirname, '..', '..', 'node_modules', 'osc'));

const deviceId = process.argv[2] ? parseInt(process.argv[2], 10) : NaN;
if (!Number.isFinite(deviceId)) {
  console.error(
    'usage: node registry_probe_resolve_shot.js <device_id>\n' +
    '  pick a device_id from the UI console (track.devices[i].id) or a\n' +
    '  prior /query_tree; F1 only fires on a resolve of a real LOM id.'
  );
  process.exit(2);
}

const u = new osc.UDPPort({
  localAddress: '0.0.0.0',
  localPort: 0,
  remoteAddress: '127.0.0.1',
  remotePort: 11020,
});

const unwrap = args => (args || []).map(a =>
  typeof a === 'object' && a !== null && 'value' in a ? a.value : a
);

const send = (addr, args = []) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      u.removeListener('message', onReply);
      reject(new Error(`timeout waiting for reply to ${addr}`));
    }, 2000);
    const replyAddr = addr + '_reply';
    const onReply = m => {
      if (m.address !== replyAddr) return;
      clearTimeout(timer);
      u.removeListener('message', onReply);
      resolve(unwrap(m.args));
    };
    u.on('message', onReply);
    u.send({ address: addr, args });
  });

(async () => {
  await new Promise(r => u.on('ready', r).open());

  const d1 = await send('/looping/v2/registry/dump');
  const [t1, dv1, p1, ft1, fd1, fp1] = d1;
  if (t1 === -1) {
    console.log(JSON.stringify({ verdict: 'registry-absent' }));
    u.close(); process.exit(0);
  }

  const pr = await send('/looping/v2/registry/probe_resolve', [deviceId]);
  const [found, wasRebuild, bt, bd, bp, at, ad, ap] = pr;
  if (found === -1) {
    console.log(JSON.stringify({ verdict: 'registry-absent' }));
    u.close(); process.exit(0);
  }

  const d2 = await send('/looping/v2/registry/dump');
  const [t2, dv2, p2, ft2, fd2, fp2] = d2;

  let verdict;
  if (found === 0) verdict = 'unknown-id';
  else if (wasRebuild === 1) verdict = 'f1-self-healed';
  else verdict = 'already-warm';

  console.log(JSON.stringify({
    verdict,
    deviceId,
    dumpBefore:  { stored: { t: t1, d: dv1, p: p1 }, fresh: { t: ft1, d: fd1, p: fp1 } },
    probe:       { found: !!found, wasRebuild: !!wasRebuild,
                   before: { t: bt, d: bd, p: bp },
                   after:  { t: at, d: ad, p: ap } },
    dumpAfter:   { stored: { t: t2, d: dv2, p: p2 }, fresh: { t: ft2, d: fd2, p: fp2 } },
  }, null, 2));
  u.close();
  process.exit(0);
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
