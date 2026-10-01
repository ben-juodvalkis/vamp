#!/usr/bin/env node
// Generic sequential driver for the surface's LOM probes (issue #489 Phase 0).
//
//   node lom_probe_driver.js '<json array of requests>'
//
// Request kinds (one UDP datagram each; replies come back on the request
// address, last-sender-wins):
//   {"kind":"introspect","path":"tracks/1/devices/0","attrs":"a,b[3].c,parameters.*name","dir":"regex"}
//   {"kind":"invoke","path":"song","method":"start_playing","observe":"is_playing","args":[...]}
//   {"kind":"set","path":"tracks/1/devices/0","sets":[["parameters[4].value",63.5],["view.selected_drum_pad",{"$ref":"drum_pads[36]"}]],"undo":0}
//   {"kind":"songtime","cmd":"start|stats|stop"}
//   {"kind":"py","module":"Live.Browser | app","chain":"FilterType","dir":"regex"}
//   {"kind":"reload"}   arm a fresh surface import; then re-select the surface in Settings
//
// Chain grammar (DebugComponent._walk_chain): dotted attributes, `name[N]`
// indexing, `*name` maps an attribute over a list. Keep a request under
// darwin's 9,216 B UDP datagram cap — split large batches. Prints one JSON
// array of {req, reply} to stdout.
const osc = require(require('path').resolve(__dirname, '..', '..', 'node_modules', 'osc'));
const reqs = JSON.parse(process.argv[2]);
const u = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 0, remoteAddress: '127.0.0.1', remotePort: 11020 });
let i = 0, timer = null;
const results = [];
function sendNext() {
  if (i >= reqs.length) { u.close(); console.log(JSON.stringify(results)); process.exit(0); }
  const r = reqs[i];
  const addr = r.kind === 'invoke' ? '/looping/probe/lom_invoke' : r.kind === 'set' ? '/looping/probe/lom_set' : r.kind === 'songtime' ? '/looping/probe/song_time_probe' : r.kind === 'py' ? '/looping/probe/py_introspect' : r.kind === 'reload' ? '/looping/probe/reload_on_reselect' : '/looping/probe/lom_introspect';
  const args = r.kind === 'reload'
    ? []
    : r.kind === 'py'
    ? [r.module || '', r.chain || '', r.dir || ''].map(v => ({ type: 's', value: v }))
    : r.kind === 'invoke'
    ? [r.path, r.method, r.observe || '', r.args ? JSON.stringify(r.args) : ''].map(v => ({ type: 's', value: v }))
    : r.kind === 'set'
      ? [{ type: 's', value: r.path }, { type: 's', value: JSON.stringify(r.sets || []) }, { type: 'i', value: r.undo ? 1 : 0 }]
      : r.kind === 'songtime'
        ? [{ type: 's', value: r.cmd || 'stats' }]
        : [r.path, r.attrs || '', r.dir || ''].map(v => ({ type: 's', value: v }));
  u.send({ address: addr, args });
  timer = setTimeout(() => { results.push({ req: r, error: 'timeout' }); i++; sendNext(); }, 4000);
}
u.on('message', m => {
  if (!m.address.startsWith('/looping/probe/')) return;
  clearTimeout(timer);
  const a = (m.args || []).map(x => (x && typeof x === 'object' && 'value' in x) ? x.value : x);
  let p; try { p = JSON.parse(a[0]); } catch (e) { p = { raw: a[0] }; }
  results.push({ req: reqs[i], reply: p }); i++; sendNext();
});
u.on('ready', sendNext);
u.open();
