#!/usr/bin/env node
// 05a PR-1 diagnostic: one-shot /looping/v2/registry/dump.
//
// Asks the live HandleRegistry for its current state plus a fresh
// LOM walk. Divergence between the two answers the question:
//
//   - stored == fresh, both > 0   → registry is healthy
//   - stored == fresh, both 0     → song genuinely empty (or LOM
//                                    can't see it; UI shouldn't have
//                                    IDs either — if it does, the
//                                    bug is upstream of the registry)
//   - stored == 0, fresh > 0      → the smoke-test pattern: registry
//                                    listeners didn't fire / initial
//                                    build ran too early. THIS is
//                                    what we expect to see.
//   - stored > 0, fresh > stored  → partial visibility (rebuild
//                                    succeeded for some tracks but
//                                    not others)
const path = require('path');
const osc = require(path.resolve(__dirname, '..', '..', 'node_modules', 'osc'));
const u = new osc.UDPPort({
  localAddress: '0.0.0.0',
  localPort: 0,
  remoteAddress: '127.0.0.1',
  remotePort: 11020,
});
const timeout = setTimeout(() => {
  console.error('timeout waiting for dump_reply');
  process.exit(1);
}, 2000);
u.on('ready', () => {
  u.on('message', m => {
    if (m.address !== '/looping/v2/registry/dump_reply') return;
    clearTimeout(timeout);
    const args = (m.args || []).map(a =>
      typeof a === 'object' && a !== null && 'value' in a ? a.value : a
    );
    const [tracks, devices, params, freshTracks, freshDevices, freshParams] = args;
    const verdict =
      tracks === freshTracks && devices === freshDevices && params === freshParams
        ? (devices === 0 ? 'empty-song-or-lom-blind' : 'healthy')
        : (tracks === 0 && devices === 0
            ? 'initial-build-or-listener-bug'
            : 'partial-visibility');
    console.log(JSON.stringify({
      stored: { tracks, devices, params },
      fresh: { tracks: freshTracks, devices: freshDevices, params: freshParams },
      verdict,
    }, null, 2));
    u.close();
    process.exit(0);
  });
  u.send({ address: '/looping/v2/registry/dump', args: [] });
});
u.open();
