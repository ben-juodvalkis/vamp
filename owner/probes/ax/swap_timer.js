// fire device/load at pad 36 and poll the pad's device name on the same socket until it changes
const osc = require(require('path').resolve(__dirname, '../../../../node_modules/osc'));
const sample = process.argv[2], want = process.argv[3];
const u = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 0, remoteAddress: '127.0.0.1', remotePort: 11020 });
const s = v => ({ type: 's', value: v });
let t0, polls = 0, done = false;
const poll = () => u.send({ address: '/looping/probe/lom_introspect', args: [s('tracks/1/devices/0'), s('drum_pads[36].chains[0].devices.*name'), s('')] });
u.on('message', m => {
  if (m.address !== '/looping/probe/lom_introspect') return;
  const p = JSON.parse(m.args[0].value ?? m.args[0]); const v = p.attrs[0].value_repr;
  if (!done && v.includes(want)) { done = true; console.log(JSON.stringify({ flipped_ms: Date.now() - t0, polls, name: v })); u.close(); process.exit(0); }
});
u.on('ready', () => {
  t0 = Date.now();
  u.send({ address: '/looping/v3/device/load', args: [s('tracks/1'), s('tracks/1/devices/0/pads/36'), s(sample)] });
  const iv = setInterval(() => { if (done) return clearInterval(iv); polls++; poll(); }, 5);
  setTimeout(() => { console.log(JSON.stringify({ flipped_ms: null, polls })); process.exit(1); }, 5000);
});
u.open();
