// watch pad 36's device name + chain count over one socket; print every change with a timestamp; exit after N ms
const osc = require(require('path').resolve(__dirname, '../../../../node_modules/osc'));
const ms = Number(process.argv[2] || 30000);
const u = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 0, remoteAddress: '127.0.0.1', remotePort: 11020 });
const s = v => ({ type: 's', value: v }); let last = null; const t0 = Date.now();
u.on('message', m => { if (m.address !== '/looping/probe/lom_introspect') return; const p = JSON.parse(m.args[0].value ?? m.args[0]); const v = p.attrs.map(a => a.value_repr || a.error).join(' ; '); if (v !== last) { console.log(JSON.stringify({ t_ms: Date.now() - t0, v })); last = v; } });
u.on('ready', () => { setInterval(() => u.send({ address: '/looping/probe/lom_introspect', args: [s('tracks/1/devices/0'), s('drum_pads[36].chains[0].devices.*name,drum_pads[36].chains[0].devices[0]._live_ptr,drum_pads[36].chains[0].devices[0].parameters[14].value'), s('')] }), 10); setTimeout(() => process.exit(0), ms); });
u.open();
