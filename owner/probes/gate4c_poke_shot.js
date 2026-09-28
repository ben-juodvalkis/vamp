#!/usr/bin/env node
// One-shot /looping/probe/lifecycle_poke, waits the LOM settle delay,
// then queries again. Prints the before/after snapshots and fireDelta.
// Companion to ``gate4c_songid_shot.js`` for manual phase-2 probing.
const path = require('path');
const osc = require(path.resolve(__dirname, '..', '..', 'node_modules', 'osc'));
const SETTLE_MS = 300;

function awaitSnapshot(u, address, args = []) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 2000);
    const handler = m => {
      if (m.address !== '/looping/probe/lifecycle_snapshot') return;
      clearTimeout(timer);
      u.off('message', handler);
      const vals = (m.args || []).map(a =>
        typeof a === 'object' && a !== null && 'value' in a ? a.value : a
      );
      const [phase, fires, songId, disconnectCount, decoratorBound] = vals;
      resolve({ phase, fires, songId, disconnectCount, decoratorBound });
    };
    u.on('message', handler);
    u.send({ address, args });
  });
}

const u = new osc.UDPPort({
  localAddress: '0.0.0.0',
  localPort: 0,
  remoteAddress: '127.0.0.1',
  remotePort: 11020,
});
u.on('ready', async () => {
  try {
    const before = await awaitSnapshot(u, '/looping/probe/lifecycle_query');
    await awaitSnapshot(u, '/looping/probe/lifecycle_poke');
    await new Promise(r => setTimeout(r, SETTLE_MS));
    const after = await awaitSnapshot(u, '/looping/probe/lifecycle_query');
    console.log(JSON.stringify({
      before, after, fireDelta: after.fires - before.fires,
    }, null, 2));
  } catch (e) {
    console.error('failed:', e.message);
    process.exitCode = 1;
  }
  u.close();
});
u.open();
