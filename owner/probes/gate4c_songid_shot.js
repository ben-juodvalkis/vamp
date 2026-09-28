#!/usr/bin/env node
// One-shot /looping/probe/lifecycle_query, prints the snapshot as JSON.
// Used during Gate 4c phase 2 where the driver's readline-based prompt
// tangled with the VSCode Claude Code session — taking manual snapshots
// before/after a File→Open sidesteps that while still proving the
// song-change rebind behaviour.
const path = require('path');
const osc = require(path.resolve(__dirname, '..', '..', 'node_modules', 'osc'));
const u = new osc.UDPPort({
  localAddress: '0.0.0.0',
  localPort: 0,
  remoteAddress: '127.0.0.1',
  remotePort: 11020,
});
const timeout = setTimeout(() => {
  console.error('timeout waiting for snapshot');
  process.exit(1);
}, 2000);
u.on('ready', () => {
  u.on('message', m => {
    if (m.address !== '/looping/probe/lifecycle_snapshot') return;
    clearTimeout(timeout);
    const args = (m.args || []).map(a =>
      typeof a === 'object' && a !== null && 'value' in a ? a.value : a
    );
    const [phase, fires, songId, disconnectCount, decoratorBound] = args;
    console.log(JSON.stringify({ phase, fires, songId, disconnectCount, decoratorBound }));
    u.close();
    process.exit(0);
  });
  u.send({ address: '/looping/probe/lifecycle_query', args: [] });
});
u.open();
