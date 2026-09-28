#!/usr/bin/env node
// One-shot diagnostic: dump id-like attrs on the first two tracks so
// we can figure out which attribute on a v3 Track wrapper returns
// the same integer as M4L's `LiveAPI.id`. The current
// `_safe_int_id` uses `_live_ptr`, which is a Python-wrapper
// pointer, not a LOM id — so UI-sent device IDs (sourced from M4L)
// never match registry keys. Runs once and prints the introspection
// blob as JSON.
const path = require('path');
const osc = require(path.resolve(__dirname, '..', '..', 'node_modules', 'osc'));
const u = new osc.UDPPort({
  localAddress: '0.0.0.0', localPort: 0,
  remoteAddress: '127.0.0.1', remotePort: 11020,
});
const timeout = setTimeout(() => { console.error('timeout'); process.exit(1); }, 2000);
u.on('ready', () => {
  u.on('message', m => {
    if (m.address !== '/looping/v2/registry/introspect_reply') return;
    clearTimeout(timeout);
    const args = (m.args || []).map(a =>
      typeof a === 'object' && a !== null && 'value' in a ? a.value : a);
    try { console.log(JSON.stringify(JSON.parse(args[0]), null, 2)); }
    catch (_) { console.log(args[0]); }
    u.close(); process.exit(0);
  });
  u.send({ address: '/looping/v2/registry/introspect_track', args: [] });
});
u.open();
